import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../src/remote-tail.cjs', import.meta.url));
const line = (o) => JSON.stringify(o) + '\n';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startTail(root) {
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CLAUDE_PROJECTS_DIR: root, POLL_MS: '50' } });
  const out = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  const stop = () => child.kill();
  process.once('exit', stop);
  return { out, stop };
}
const waitFor = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await sleep(30); } throw new Error('timeout'); };

const assistantTool = (name, input, id = 'tu1') => ({ type: 'assistant', sessionId: 'S1', cwd: '/home/me/accident', timestamp: '2026-10-21T06:00:01Z', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });

test('이미 있던 최근 세션은 init으로 알리고 과거 내용은 되풀이하지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'S1.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: '옛날 요청' } }) + line(assistantTool('Bash', { command: 'make' })));
  const t = startTail(root);
  const init = await waitFor(() => t.out.find((o) => o.k === 'init'));
  assert.equal(init.s, 'S1');
  assert.equal(init.c, '/home/me/accident');
  assert.equal(init.last, 'tool');
  assert.ok(init.age < 30);
  await sleep(200);
  assert.equal(t.out.filter((o) => o.k === 'prompt').length, 0);
  t.stop();
});

test('새로 추가된 줄만 요약해서 내보낸다 (내용 전체가 아니라 필요한 필드만)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'S1.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: '시작' } }));
  const t = startTail(root);
  await waitFor(() => t.out.find((o) => o.k === 'init'));
  appendFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: '로그인 화면을 고쳐줘 그리고 아주 긴 비밀 내용 '.repeat(20) } }));
  appendFileSync(f, line(assistantTool('Read', { file_path: '/home/me/accident/a.py', secret_extra: 'x'.repeat(5000) })));
  appendFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'y'.repeat(100000) }] } }));
  appendFileSync(f, line({ type: 'assistant', sessionId: 'S1', cwd: '/home/me/accident', message: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '...' }] } }));
  appendFileSync(f, line({ type: 'assistant', sessionId: 'S1', cwd: '/home/me/accident', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '끝' }] } }));
  appendFileSync(f, line({ type: 'system', sessionId: 'S1' }));
  await waitFor(() => t.out.find((o) => o.k === 'stop'));
  const kinds = t.out.filter((o) => o.k !== 'init' && o.k !== 'hello').map((o) => o.k);
  assert.deepEqual(kinds, ['prompt', 'tool', 'result', 'stop']); // thinking-only end_turn은 stop이 아님
  const tool = t.out.find((o) => o.k === 'tool');
  assert.deepEqual(tool.tools, [{ i: 'tu1', n: 'Read', d: '/home/me/accident/a.py' }]);
  assert.equal(t.out.find((o) => o.k === 'result').ids[0], 'tu1');
  assert.ok(t.out.find((o) => o.k === 'prompt').p.length <= 40);
  assert.ok(JSON.stringify(t.out).length < 3000, '긴 내용이 전송되면 안 된다');
  t.stop();
});

test('나중에 생긴 새 세션 파일은 처음부터 읽고, 하위 에이전트(sidechain)와 깊은 폴더는 무시한다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'), { recursive: true });
  const t = startTail(root);
  await sleep(200);
  writeFileSync(join(root, '-home-me', 'NEW.jsonl'), line({ type: 'user', sessionId: 'NEW', cwd: '/home/me/datasets', message: { content: '새 세션' } }) + line({ ...assistantTool('Bash', { command: 'ls' }), sessionId: 'NEW', isSidechain: true }));
  mkdirSync(join(root, '-home-me', 'NEW', 'subagents'), { recursive: true });
  writeFileSync(join(root, '-home-me', 'NEW', 'subagents', 'agent-1.jsonl'), line({ type: 'user', sessionId: 'NEW', cwd: '/x', message: { content: 'sub' } }));
  const p = await waitFor(() => t.out.find((o) => o.k === 'prompt'));
  assert.equal(p.s, 'NEW');
  assert.equal(p.c, '/home/me/datasets');
  await sleep(200);
  assert.equal(t.out.filter((o) => o.k === 'tool').length, 0);
  assert.equal(t.out.filter((o) => o.c === '/x').length, 0);
  t.stop();
});

test('오래된 파일(10분 이상 수정 없음)은 init을 내지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'OLD.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'OLD', cwd: '/home/me/x', message: { content: 'old' } }));
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  utimesSync(f, old, old);
  const t = startTail(root);
  await sleep(300);
  assert.equal(t.out.filter((o) => o.k !== 'hello').length, 0);
  t.stop();
});

test('실행 중인 세션 등록 정보(sessions/<pid>.json)의 이름을 n으로 붙인다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  const sess = mkdtempSync(join(tmpdir(), 'tail-sess-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'S1.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me', message: { content: '시작' } }));
  writeFileSync(join(sess, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'S1', name: '사고 판별 모델', status: 'idle' }));
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CLAUDE_PROJECTS_DIR: root, CLAUDE_SESSIONS_DIR: sess, POLL_MS: '50' } });
  const out = [];
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  try {
    const init = await waitFor(() => out.find((o) => o.k === 'init'));
    assert.equal(init.n, '사고 판별 모델');
  } finally { child.kill(); }
});
