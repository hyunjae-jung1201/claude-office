import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectionToEvents, buildSshArgs } from '../src/remote.js';

const NOW = 5_000_000;
const base = { s: 'sess-1', c: '/home/me/accident', t: '2026-10-21T06:00:00Z' };
const fresh = () => ({ tools: new Map(), seen: new Set() });

test('첫 이벤트에는 세션 시작이 앞에 붙는다', () => {
  const evs = projectionToEvents({ ...base, k: 'prompt', p: '로그인 고쳐줘' }, fresh(), NOW);
  assert.deepEqual(evs.map((e) => e.type), ['start', 'prompt']);
  assert.ok(evs.every((e) => e.sessionId === 'sess-1' && e.cwd === '/home/me/accident' && e.ts === NOW));
});

test('같은 세션의 두 번째 이벤트에는 start가 없다', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'prompt', p: 'a' }, ctx, NOW);
  assert.deepEqual(projectionToEvents({ ...base, k: 'prompt', p: 'b' }, ctx, NOW).map((e) => e.type), ['prompt']);
});

test('하위 에이전트 완료 알림과 시스템 문구는 사용자 프롬프트가 아니다', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'stop' }, ctx, NOW);
  assert.deepEqual(projectionToEvents({ ...base, k: 'prompt', p: '<task-notification>\n<task-id>' }, ctx, NOW), []);
});

test('도구 사용은 category와 마스킹된 detail을 가진 tool 이벤트, 결과는 toolDone', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'stop' }, ctx, NOW);
  const evs = projectionToEvents({ ...base, k: 'tool', tools: [
    { i: 't1', n: 'Bash', d: 'curl -H "Authorization: Bearer abc123def456ghi789jkl" x' },
    { i: 't2', n: 'Read', d: '/home/me/accident/a.py' },
  ] }, ctx, NOW);
  assert.deepEqual(evs.map((e) => [e.type, e.category]), [['tool', 'run'], ['tool', 'read']]);
  assert.ok(!evs[0].detail.includes('abc123def456ghi789jkl'));
  const done = projectionToEvents({ ...base, k: 'result', ids: ['t2', 't1', 'unknown'] }, ctx, NOW);
  assert.deepEqual(done.map((e) => [e.type, e.category]), [['toolDone', 'read'], ['toolDone', 'run'], ['toolDone', 'write']]);
});

test('AskUserQuestion/ExitPlanMode는 wait', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'stop' }, ctx, NOW);
  const evs = projectionToEvents({ ...base, k: 'tool', tools: [{ i: 'q', n: 'AskUserQuestion', d: '' }, { i: 'p', n: 'ExitPlanMode', d: '' }] }, ctx, NOW);
  assert.deepEqual(evs.map((e) => [e.type, e.waitKind]), [['wait', 'answer'], ['wait', 'plan']]);
});

test('init: 최근에 일하던 세션은 시작 후 바로 작업 상태, 오래됐으면 대기', () => {
  const working = projectionToEvents({ ...base, k: 'init', last: 'tool', age: 5, tools: [{ i: 't', n: 'Edit', d: '/x/a.py' }] }, fresh(), NOW);
  assert.deepEqual(working.map((e) => [e.type, e.category]), [['start', undefined], ['tool', 'write']]);
  const idle = projectionToEvents({ ...base, k: 'init', last: 'stop', age: 5 }, fresh(), NOW);
  assert.deepEqual(idle.map((e) => e.type), ['start']);
  const stale = projectionToEvents({ ...base, k: 'init', last: 'tool', age: 400, tools: [{ i: 't', n: 'Edit', d: 'x' }] }, fresh(), NOW);
  assert.deepEqual(stale.map((e) => e.type), ['start']);
});

test('필드가 없거나 이상한 입력은 빈 배열', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { k: 'tool' }, { s: 's', c: '/x', k: 'mystery' }]) {
    assert.deepEqual(projectionToEvents(bad, fresh(), NOW), []);
  }
});

test('ssh 인자: 키 전용(BatchMode), 포트 포워딩 없음, 원격에서 node - 실행', () => {
  const args = buildSshArgs({ name: 'PC2', ssh: 'me@192.168.0.20', key: '/home/x/.ssh/k' });
  assert.deepEqual(args.slice(0, 2), ['-i', '/home/x/.ssh/k']);
  assert.ok(args.includes('BatchMode=yes') && args.includes('IdentitiesOnly=yes'));
  assert.deepEqual(args.slice(-3), ['me@192.168.0.20', 'node', '-']);
  assert.ok(!args.some((a) => /password/i.test(a)));
});

test('원격 세션 이름(n)이 이벤트의 sessionName으로 전달된다', () => {
  const evs = projectionToEvents({ ...base, n: '사고 판별 모델', k: 'prompt', p: 'x' }, fresh(), NOW);
  assert.ok(evs.length === 2 && evs.every((e) => e.sessionName === '사고 판별 모델'));
});
