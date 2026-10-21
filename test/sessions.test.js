import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionRegistry } from '../src/sessions.js';

function dirWith(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-'));
  for (const [file, obj] of Object.entries(entries)) writeFileSync(join(dir, file), typeof obj === 'string' ? obj : JSON.stringify(obj));
  return dir;
}

test('sessionId로 세션 이름을 찾는다', () => {
  const dir = dirWith({ '1.json': { pid: 1, sessionId: 'S1', name: '팅크웨어' }, '2.json': { pid: 2, sessionId: 'S2', name: 'Pin-It' } });
  const reg = createSessionRegistry({ dir });
  assert.equal(reg.nameOf('S1'), '팅크웨어');
  assert.equal(reg.nameOf('S2'), 'Pin-It');
  assert.equal(reg.nameOf('nope'), undefined);
});

test('깨진 파일, 이름 없는 항목, .key 파일은 무시한다', () => {
  const dir = dirWith({ 'bad.json': '{not json', '3.json': { pid: 3, sessionId: 'S3' }, '4.abc.key': 'secret', '5.json': { pid: 5, sessionId: 'S5', name: 'ok' } });
  const reg = createSessionRegistry({ dir });
  assert.equal(reg.nameOf('S3'), undefined);
  assert.equal(reg.nameOf('S5'), 'ok');
});

test('폴더가 없어도 오류 없이 undefined', () => {
  assert.equal(createSessionRegistry({ dir: join(tmpdir(), 'no-such-dir-xyz') }).nameOf('S'), undefined);
});

test('ttl 동안은 캐시하고, 지나면 다시 읽는다', () => {
  const dir = dirWith({ '1.json': { pid: 1, sessionId: 'S1', name: 'A' } });
  let t = 0;
  const reg = createSessionRegistry({ dir, ttlMs: 1000, now: () => t });
  assert.equal(reg.nameOf('S1'), 'A');
  writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 'S1', name: 'B' }));
  t = 500;
  assert.equal(reg.nameOf('S1'), 'A');
  t = 1500;
  assert.equal(reg.nameOf('S1'), 'B');
});

test('아직 없는 세션이면 ttl 안이어도 한 번 더 읽어 본다 (막 시작한 세션)', () => {
  const dir = dirWith({});
  let t = 0;
  const reg = createSessionRegistry({ dir, ttlMs: 60_000, now: () => t });
  assert.equal(reg.nameOf('S9'), undefined);
  writeFileSync(join(dir, '9.json'), JSON.stringify({ pid: 9, sessionId: 'S9', name: 'new' }));
  t = 100;
  assert.equal(reg.nameOf('S9'), 'new');
});

// ---- 살아 있는 세션 목록 (백그라운드 작업 표시용)
import { spawnSync } from 'node:child_process';

test('liveSessions: 살아 있는 프로세스의 세션만 이름·폴더·상태와 함께 돌려준다', () => {
  const dead = spawnSync(process.execPath, ['-e', '0']).pid; // 이미 끝난 프로세스의 pid
  const dir = dirWith({
    'a.json': { pid: process.pid, sessionId: 'LIVE', name: '사고 판별 모델', cwd: '/home/x', status: 'shell' },
    'b.json': { pid: dead, sessionId: 'DEAD', name: 'old', cwd: '/home/x', status: 'busy' },
    'c.json': { pid: process.pid, sessionId: 'NONAME', cwd: '/home/y', status: 'idle' },
    'd.json': { sessionId: 'NOPID', name: 'x' },
    'e.abc.key': 'secret',
  });
  const live = createSessionRegistry({ dir }).liveSessions();
  assert.deepEqual(live.map((s) => s.sessionId).sort(), ['LIVE', 'NONAME']);
  assert.deepEqual(live.find((s) => s.sessionId === 'LIVE'), { sessionId: 'LIVE', name: '사고 판별 모델', cwd: '/home/x', status: 'shell' });
  assert.equal(live.find((s) => s.sessionId === 'NONAME').name, undefined);
});

test('liveSessions: 폴더가 없으면 빈 목록', () => {
  assert.deepEqual(createSessionRegistry({ dir: join(tmpdir(), 'no-dir-live-xyz') }).liveSessions(), []);
});

// ---- 최종 검토: 재사용된 PID, 헤드리스 도우미 프로세스
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const startTimeOf = (pid) => readFileSync(`/proc/${pid}/stat`, 'utf8').slice(readFileSync(`/proc/${pid}/stat`, 'utf8').lastIndexOf(')') + 2).split(' ')[19];

test('liveSessions: procStart가 실제 프로세스 시작 시각과 다르면(PID 재사용) 제외한다', () => {
  const start = Number(startTimeOf(process.pid));
  const dir = dirWith({
    'a.json': { pid: process.pid, sessionId: 'SAME', name: 'a', cwd: '/x', status: 'idle', procStart: start },
    'b.json': { pid: process.pid, sessionId: 'REUSED', name: 'b', cwd: '/x', status: 'idle', procStart: start + 1 },
    'c.json': { pid: process.pid, sessionId: 'NOSTAMP', name: 'c', cwd: '/x', status: 'idle' },
  });
  assert.deepEqual(createSessionRegistry({ dir }).liveSessions().map((s) => s.sessionId).sort(), ['NOSTAMP', 'SAME']);
});

test('liveSessions: 역할자·요약기가 띄운 헤드리스 claude(CLAUDE_OFFICE_ROLE/SUMMARIZER 환경)는 제외한다', async () => {
  const mk = (env) => spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  const role = mk({ CLAUDE_OFFICE_ROLE: '1' });
  const summ = mk({ CLAUDE_OFFICE_SUMMARIZER: '1' });
  const plain = mk({});
  try {
    await new Promise((r) => setTimeout(r, 150));
    const dir = dirWith({
      'r.json': { pid: role.pid, sessionId: 'ROLE', cwd: '/repo', status: 'idle' },
      's.json': { pid: summ.pid, sessionId: 'SUMM', cwd: '/tmp', status: 'idle' },
      'p.json': { pid: plain.pid, sessionId: 'PLAIN', cwd: '/repo', status: 'idle' },
    });
    assert.deepEqual(createSessionRegistry({ dir }).liveSessions().map((s) => s.sessionId), ['PLAIN']);
  } finally { role.kill(); summ.kill(); plain.kill(); }
});
