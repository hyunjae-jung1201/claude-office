import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDailyLog } from '../src/daily.js';

const KST = 9 * 3600_000;
const at = (iso) => Date.parse(iso) - KST; // KST 시각 문자열 → epoch (2026-10-22T10:12:00 KST)
const T = { name: '팅크웨어', path: '/w/tw' };
const mk = (over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'daily-data-'));
  const events = [];
  let t = at('2026-10-22T10:00:00Z');
  const log = createDailyLog({ dir, dataDir, now: () => t, emit: (e) => events.push(e), intervalMs: 1e9, ...over });
  return { log, dir, dataDir, events, set: (iso) => { t = at(iso); }, file: (d = '2026-10-22') => join(dir, d, '자동기록.md') };
};
const ev = (type, o = {}) => ({ type, sessionId: 's1', cwd: '/w/tw', ...o });

test('요청·수정 파일·도구·검토를 팀별로 모아 날짜 폴더의 자동기록.md 로 쓴다', () => {
  const d = mk();
  d.set('2026-10-22T10:12:00Z');
  d.log.record(T, ev('prompt', { promptText: 'IMU 코드 고쳐줘' }));
  d.log.record(T, ev('tool', { toolName: 'Read', detail: '/w/tw/a.c' }));
  d.set('2026-10-22T10:30:00Z');
  d.log.record(T, ev('tool', { toolName: 'Edit', filePath: '/w/tw/src/imu.c' }));
  d.log.record(T, ev('tool', { toolName: 'Edit', filePath: '/w/tw/src/imu.c' }));
  d.log.record(T, ev('tool', { toolName: 'Write', filePath: '/w/tw/docs/note.md' }));
  d.set('2026-10-22T11:40:00Z');
  d.log.recordReview(T.name, { finishedAt: at('2026-10-22T11:40:00Z'), verdict: 'concern', concerns: 2, results: [{ verdict: 'concern', summary: '버퍼 크기 확인 필요' }], tests: { command: 'make test', ok: false, exitCode: 2 } });
  d.log.flush();
  const md = readFileSync(d.file(), 'utf8');
  assert.match(md, /^# 2026-10-22 자동 기록/);
  assert.match(md, /## 팅크웨어/);
  assert.match(md, /작업 시간: 10:12 ~ 11:40/);
  assert.match(md, /1\. IMU 코드 고쳐줘/);
  assert.match(md, /src\/imu\.c ×2/);
  assert.match(md, /docs\/note\.md ×1/);
  assert.match(md, /Edit 2, Read 1, Write 1/);
  assert.match(md, /11:40 우려 2 — 버퍼 크기 확인 필요/);
  assert.match(md, /테스트 실패 \(make test, 종료 코드 2\)/);
});

test('flush 는 바뀐 팀마다 기록원 job 을 running → done 으로 알리고, 바뀐 게 없으면 쓰지도 알리지도 않는다', () => {
  const d = mk();
  d.log.record(T, ev('prompt', { promptText: '요청' }));
  d.log.flush();
  assert.deepEqual(d.events.map((e) => [e.type, e.team, e.id, e.room, e.status]), [['job', '팅크웨어', 'recorder', 'docs', 'running'], ['job', '팅크웨어', 'recorder', undefined, 'done']]);
  assert.match(d.events[0].name + d.events[1].label, /기록원.*일지/);
  d.events.length = 0;
  d.log.flush();
  assert.deepEqual(d.events, []);
});

test('같은 날 서버를 다시 켜면 모은 내용을 이어받고, 한국 시간 자정이 지나면 새 파일로 나뉜다', () => {
  const d = mk();
  d.set('2026-10-22T23:58:00Z');
  d.log.record(T, ev('prompt', { promptText: '밤 요청' }));
  d.log.flush();
  const again = createDailyLog({ dir: d.dir, dataDir: d.dataDir, now: () => at('2026-10-22T23:59:00Z'), emit: () => {}, intervalMs: 1e9 });
  again.record(T, ev('prompt', { promptText: '두 번째' }));
  again.flush();
  assert.match(readFileSync(d.file(), 'utf8'), /1\. 밤 요청\n\s*2\. 두 번째/);
  const t2 = createDailyLog({ dir: d.dir, dataDir: d.dataDir, now: () => at('2026-10-23T00:01:00Z'), emit: () => {}, intervalMs: 1e9 });
  t2.record(T, ev('prompt', { promptText: '자정 넘어' }));
  t2.flush();
  assert.ok(existsSync(d.file('2026-10-23')));
  assert.ok(!readFileSync(d.file('2026-10-23'), 'utf8').includes('밤 요청'));
});

test('프롬프트는 한 줄로 정리·마스킹하고, 요청 15건·파일 30개 상한을 둔다', () => {
  const d = mk();
  d.log.record(T, ev('prompt', { promptText: '줄바꿈\n## 가짜 제목\n`코드` token=abcd1234efghijkl' }));
  for (let i = 0; i < 20; i++) d.log.record(T, ev('prompt', { promptText: `요청${i}` }));
  for (let i = 0; i < 40; i++) d.log.record(T, ev('tool', { toolName: 'Edit', filePath: `/w/tw/f${i}.c` }));
  d.log.flush();
  const md = readFileSync(d.file(), 'utf8');
  assert.ok(!md.includes('abcd1234efghijkl'));
  assert.ok(!/^## 가짜 제목/m.test(md));
  assert.equal((md.match(/^\s+\d+\. /gm) ?? []).length, 15);
  assert.match(md, /수정한 파일 \(40개\)/);
  assert.match(md, /외 10개/);
});

test('경로가 팀 폴더 밖이면 전체 경로로, 쓸 수 없는 폴더여도 예외 없이 다음에 다시 시도한다', () => {
  const d = mk();
  d.log.record(T, ev('tool', { toolName: 'Edit', filePath: '/etc/other/x.conf' }));
  d.log.flush();
  assert.match(readFileSync(d.file(), 'utf8'), /\/etc\/other\/x\.conf ×1/);
  const blocker = join(mkdtempSync(join(tmpdir(), 'daily-blk-')), 'file');
  writeFileSync(blocker, 'x');
  const bad = mk({ dir: join(blocker, 'sub') }); // 상위가 파일이라 폴더를 만들 수 없다
  bad.log.record(T, ev('prompt', { promptText: 'x' }));
  assert.doesNotThrow(() => bad.log.flush());
  assert.deepEqual(bad.events.filter((e) => e.status === 'failed').length, 1);
});

test('도구·파일이 없는 이벤트(live/stop 등)는 기록하지 않고, 아무것도 없으면 파일을 만들지 않는다', () => {
  const d = mk();
  d.log.record(T, ev('live'));
  d.log.record(T, ev('stop'));
  d.log.record(T, ev('toolDone'));
  d.log.flush();
  assert.ok(!existsSync(join(d.dir, '2026-10-22')));
});
