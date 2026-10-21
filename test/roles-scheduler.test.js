import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/roles/scheduler.js';

const mkRole = (id, when = 'always') => ({ id, name: id.toUpperCase(), color: '#112233', model: 'sonnet', when, tools: ['Read', 'Grep', 'Glob'], prompt: `나는 ${id}` });
const ROLES = new Map(['pm', 'developer', 'qa', 'security', 'docs'].map((id) => [id, mkRole(id, id === 'developer' || id === 'security' ? 'code' : id === 'docs' ? 'docs' : 'always')]));
const cfg = (roles = {}) => ({ roles: { enabled: true, default: ['pm', 'developer', 'qa'], cooldownMinutes: 5, minWrites: 1, dailyLimit: 120, deliver: 'report', projects: {}, ...roles }, projects: [] });
const OK = JSON.stringify({ verdict: 'ok', summary: '문제 없음', findings: [] });

function fakeStore(used = 0) {
  const saved = [];
  let n = used;
  return { saved, save: (r) => saved.push(r), counter: { used: () => n, add: (k) => { n += k; } } };
}
const job = (over = {}) => ({ repoRoot: '/r/app', sessionId: 's1', files: ['/r/app/a.js'], requests: ['비밀 요청 원문'], lastResponse: '완료', reason: 'stop', ...over });
const bundleOf = (j) => ({ repoRoot: j.repoRoot, repoName: 'app', requests: j.requests, lastResponse: j.lastResponse, files: j.files, diff: '+x', truncated: false, stats: '', excluded: [] });

function setup({ config = cfg(), store = fakeStore(), run = async () => OK, concurrency } = {}) {
  const events = [];
  const sched = createScheduler({ config, roles: ROLES, store, run, buildBundle: async (j) => bundleOf(j), resolveTeam: () => 'T', emit: (e) => events.push(e), concurrency });
  return { sched, events, store };
}

test('정상 흐름: start → 역할 실행 → done, 보고서 저장과 카운터 증가', async () => {
  const { sched, events, store } = setup();
  sched.submit(job());
  await sched.idle();
  assert.deepEqual(events.map((e) => e.type).filter((t) => t !== 'role'), ['start', 'done']);
  assert.deepEqual(events[0].roles.map((r) => r.id), ['pm', 'developer', 'qa']);
  assert.equal(events[0].team, 'T');
  assert.equal(events.filter((e) => e.type === 'role' && e.status === 'running').length, 3);
  assert.equal(events.filter((e) => e.type === 'role' && e.status === 'done').length, 3);
  assert.equal(store.saved.length, 1);
  const r = store.saved[0];
  assert.equal(r.verdict, 'ok');
  assert.equal(r.results.length, 3);
  assert.deepEqual(r.results.map((x) => x.roleName).sort(), ['DEVELOPER', 'PM', 'QA']);
  assert.equal(store.counter.used(), 3);
  assert.equal(events.at(-1).review, r);
});

test('when 조건: 문서만 바뀌면 code 역할 제외, 문서 역할 포함', async () => {
  const { sched, events } = setup({ config: cfg({ default: ['pm', 'developer', 'security', 'docs'] }) });
  sched.submit(job({ files: ['/r/app/README.md'] }));
  await sched.idle();
  assert.deepEqual(events[0].roles.map((r) => r.id), ['pm', 'docs']);
  const { sched: s2, events: e2 } = setup({ config: cfg({ default: ['pm', 'developer', 'security', 'docs'] }) });
  s2.submit(job({ files: ['/r/app/a.js', '/r/app/b.py'] }));
  await s2.idle();
  assert.deepEqual(e2[0].roles.map((r) => r.id), ['pm', 'developer', 'security']);
});

test('한 역할이 실패해도 나머지는 계속, 실패는 failed로 기록하고 종합은 concern', async () => {
  const run = async ({ role }) => { if (role.id === 'qa') throw new Error('시간 초과'); return OK; };
  const { sched, events, store } = setup({ run });
  sched.submit(job());
  await sched.idle();
  const r = store.saved[0];
  const qa = r.results.find((x) => x.roleId === 'qa');
  assert.deepEqual([qa.verdict, qa.error], ['failed', '시간 초과']);
  assert.equal(r.results.filter((x) => x.verdict === 'ok').length, 2);
  assert.equal(r.verdict, 'concern');
  assert.equal(r.concerns, 1);
  assert.ok(events.some((e) => e.type === 'role' && e.roleId === 'qa' && e.status === 'failed'));
});

test('역할자가 JSON이 아닌 문장을 돌려주면 failed(형식 오류)로 기록 (Review Focus 2)', async () => {
  const { sched, store } = setup({ run: async () => '좋아 보입니다.' });
  sched.submit(job());
  await sched.idle();
  assert.ok(store.saved[0].results.every((x) => x.verdict === 'failed' && x.error === '형식 오류'));
});

test('동시에 실행되는 역할자 프로세스는 3개를 넘지 않는다', async () => {
  let cur = 0;
  let max = 0;
  const run = async () => { cur++; max = Math.max(max, cur); await new Promise((r) => setTimeout(r, 15)); cur--; return OK; };
  const { sched, store } = setup({ config: cfg({ default: ['pm', 'qa', 'developer', 'security', 'docs'] }), run });
  sched.submit(job({ files: ['/r/app/a.js', '/r/app/README.md'] }));
  sched.submit(job({ repoRoot: '/r/other', files: ['/r/other/b.js'] }));
  await sched.idle();
  assert.ok(max <= 3 && max >= 2, `max=${max}`);
  assert.equal(store.saved.length, 2);
});

test('같은 저장소는 병렬로 돌지 않고, 중복 요청은 쿨다운 후 한 번만 다시 실행된다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = async () => { calls++; if (calls <= 3) await gate; return OK; };
  const { sched, store } = setup({ run });
  sched.submit(job());
  await new Promise((r) => setImmediate(r));
  sched.submit(job({ files: ['/r/app/b.js'] }));
  sched.submit(job({ files: ['/r/app/c.js'] }));
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 3); // 첫 검토의 3개 역할만 실행 중
  release();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(store.saved.length, 1);
  t.mock.timers.tick(5 * 60_000 + 1);
  await sched.idle();
  assert.equal(store.saved.length, 2); // 두 번의 중복 요청이 한 번으로 합쳐짐
  assert.deepEqual(store.saved[1].files.sort(), ['/r/app/b.js', '/r/app/c.js']);
  assert.equal(calls, 6);
});

test('일일 한도 도달: skipped(limit), 카운터 불변, 실행·예외 없음 (Review Focus 4)', async () => {
  let calls = 0;
  const { sched, events, store } = setup({ store: fakeStore(118), run: async () => { calls++; return OK; } });
  sched.submit(job()); // 역할 3개 → 118 + 3 > 120
  await sched.idle();
  assert.deepEqual(events.map((e) => [e.type, e.reason]), [['skipped', 'limit']]);
  assert.equal(calls, 0);
  assert.equal(store.counter.used(), 118);
  assert.equal(sched.stats().limitReached, false); // 아직 118 < 120 이지만 이번 검토는 못 한다
  const { sched: s2 } = setup({ store: fakeStore(120) });
  assert.equal(s2.stats().limitReached, true);
});

test('알 수 없는 역할 id는 건너뛰고, 실행할 역할이 없으면 skipped(no-roles)', async () => {
  const { sched, events } = setup({ config: cfg({ default: ['ghost', 'pm'] }) });
  sched.submit(job());
  await sched.idle();
  assert.deepEqual(events[0].roles.map((r) => r.id), ['pm']);
  const { sched: s2, events: e2 } = setup({ config: cfg({ default: ['ghost'] }) });
  s2.submit(job());
  await s2.idle();
  assert.deepEqual(e2.map((e) => [e.type, e.reason]), [['skipped', 'no-roles']]);
});

test('저장된 보고서에는 사용자 요청 원문이 없다', async () => {
  const { sched, store } = setup();
  sched.submit(job());
  await sched.idle();
  assert.ok(!JSON.stringify(store.saved[0]).includes('비밀 요청 원문'));
});

test('close 이후에 끝난 검토는 저장·이벤트 없이 조용히 버려진다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { sched, events, store } = setup({ run: async () => { await gate; return OK; } });
  sched.submit(job());
  await new Promise((r) => setImmediate(r));
  sched.close();
  release();
  await sched.idle();
  assert.equal(store.saved.length, 0);
  assert.ok(!events.some((e) => e.type === 'done'));
  assert.equal(store.counter.used(), 0);
});

test('buildBundle이 실패해도 submit은 예외를 던지지 않고 skipped로 알린다', async () => {
  const events = [];
  const sched = createScheduler({ config: cfg(), roles: ROLES, store: fakeStore(), run: async () => OK, buildBundle: async () => { throw new Error('git 오류'); }, emit: (e) => events.push(e) });
  assert.doesNotThrow(() => sched.submit(job()));
  await sched.idle();
  assert.deepEqual(events.map((e) => [e.type, e.reason]), [['skipped', 'error']]);
});

test('변경 내용이 전혀 없으면(diff·통계·제외 모두 비어 있음) 역할자를 돌리지 않고 skipped(no-changes)', async () => {
  const events = [];
  let calls = 0;
  const empty = { repoRoot: '/r/app', repoName: 'app', requests: [], lastResponse: '', files: ['/r/app/a.js'], diff: '', truncated: false, stats: '', excluded: [] };
  const sched = createScheduler({ config: cfg(), roles: ROLES, store: fakeStore(), run: async () => { calls++; return OK; }, buildBundle: async () => empty, emit: (e) => events.push(e) });
  sched.submit(job());
  await sched.idle();
  assert.deepEqual(events.map((e) => [e.type, e.reason]), [['skipped', 'no-changes']]);
  assert.equal(calls, 0);
});
