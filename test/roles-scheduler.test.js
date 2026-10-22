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
  assert.equal(store.counter.used(), 3); // 이미 시작한 역할자 프로세스는 시작 시점에 한도에서 차감된다
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

test('job에 edits가 있으면 git 없이 수정 기록으로 만든 변경 내용이 역할자 프롬프트에 들어간다', async () => {
  const prompts = [];
  const events = [];
  const sched = createScheduler({ config: cfg(), roles: ROLES, store: fakeStore(), run: async ({ prompt }) => { prompts.push(prompt); return OK; }, emit: (e) => events.push(e) });
  sched.submit({ repoRoot: '/nonexistent/plain/proj', sessionId: 's1', files: ['/nonexistent/plain/proj/a.js'], requests: ['바꿔줘'], lastResponse: '완료', reason: 'stop',
    edits: [{ kind: 'edit', file: '/nonexistent/plain/proj/a.js', old: 'const a = 1;', new: 'const a = 2;' }] });
  await sched.idle();
  assert.deepEqual(events.filter((e) => e.type !== 'role').map((e) => e.type), ['start', 'done']);
  assert.equal(prompts.length, 3);
  assert.match(prompts[0], /-const a = 1;/);
  assert.match(prompts[0], /\+const a = 2;/);
});

test('when: ui 역할은 화면 파일(html/css/jsx/vue 등)이 있을 때만 실행되고, done 에 세션 id 가 실린다', async () => {
  const mk = (ext) => async () => {
    const events = [];
    const roles = new Map([['ui', { id: 'ui', name: 'UI', color: '#112233', when: 'ui', model: 'sonnet', tools: [], prompt: 'p' }]]);
    const sched = createScheduler({ config: cfg({ default: ['ui'] }), roles, store: fakeStore(), run: async () => OK, emit: (e) => events.push(e),
      buildBundle: async (job) => ({ repoRoot: job.repoRoot, repoName: 'r', requests: [], lastResponse: '', files: job.files, diff: '+x', truncated: false, stats: ' f', excluded: [] }) });
    sched.submit({ repoRoot: '/r', sessionId: 'S9', files: [`/r/a${ext}`], requests: [], lastResponse: '', reason: 'stop' });
    await sched.idle();
    return events;
  };
  const ui = await mk('.vue')();
  assert.equal(ui.find((e) => e.type === 'done').sessionId, 'S9');
  assert.equal((await mk('.py')()).find((e) => e.type === 'skipped').reason, 'no-roles');
});

test('일일 한도는 역할자 실행을 시작할 때 차감한다(끝나길 기다리지 않는다)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { sched, store } = setup({ run: async () => { await gate; return OK; } });
  sched.submit(job());
  await new Promise((r) => setImmediate(r));
  assert.equal(store.counter.used(), 3);
  release();
  await sched.idle();
  assert.equal(store.counter.used(), 3); // 두 번 세지 않는다
});

test('close 하면 실행 중인 역할자에게 중단 신호(signal)가 간다', async () => {
  const signals = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const { sched } = setup({ run: async ({ signal }) => { signals.push(signal); await gate; return OK; } });
  sched.submit(job());
  await new Promise((r) => setImmediate(r));
  assert.equal(signals.length, 3);
  assert.ok(signals.every((s) => s && !s.aborted));
  sched.close();
  assert.ok(signals.every((s) => s.aborted));
  release();
  await sched.idle();
});

test('원격(host) job: 역할자는 이 PC 의 빈 임시 폴더에서 실행되고(원격 파일 없음), 보고서에 host 가 남는다', async () => {
  const calls = [];
  const events = [];
  const store = fakeStore();
  const sched = createScheduler({ config: cfg(), roles: ROLES, store, run: async ({ prompt, repoRoot }) => { calls.push({ prompt, repoRoot }); return OK; }, emit: (e) => events.push(e) });
  sched.submit({ repoRoot: '/home/hyeanjae/accident', host: 'PC2', sessionId: 's1', files: ['/home/hyeanjae/accident/a.py'], requests: ['고쳐줘'], lastResponse: '완료', reason: 'stop',
    edits: [{ kind: 'edit', file: '/home/hyeanjae/accident/a.py', old: 'x = 1', new: 'x = 2' }] });
  await sched.idle();
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.repoRoot !== '/home/hyeanjae/accident' && c.repoRoot.includes('claude-office-remote')));
  assert.match(calls[0].prompt, /다른 PC\(PC2\)/);
  assert.match(calls[0].prompt, /\+x = 2/);
  assert.equal(store.saved[0].host, 'PC2');
  assert.equal(events.find((e) => e.type === 'done').review.host, 'PC2');
  sched.close();
});

// ---- 테스트 실행(testCommand): 서버가 테스트를 돌린 결과를 역할자에게 주고, 테스터 아바타가 테스트 랩에서 일한다
const withTests = (over = {}) => ({ ...cfg(), projects: [{ name: 'T', path: '/r/app', testCommand: ['npm', 'test'], ...over }] });
const TESTS_OK = { command: 'npm test', ok: true, exitCode: 0, timedOut: false, durationMs: 1200, output: '3 passing' };

test('testCommand 가 있는 팀: 역할자 전에 테스트를 한 번 실행하고, 결과가 프롬프트·보고서·job 이벤트에 반영된다', async () => {
  const calls = [];
  const prompts = [];
  const events = [];
  const store = fakeStore();
  const sched = createScheduler({ config: withTests(), roles: ROLES, store, run: async ({ prompt }) => { prompts.push(prompt); return OK; }, buildBundle: async (j) => bundleOf(j), resolveTeam: () => 'T', emit: (e) => events.push(e),
    runTests: async (o) => { calls.push(o); return TESTS_OK; } });
  sched.submit(job());
  await sched.idle();
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].command, calls[0].cwd], [['npm', 'test'], '/r/app']);
  assert.ok(prompts.every((p) => /## 테스트 실행 결과/.test(p) && /3 passing/.test(p)));
  assert.deepEqual(store.saved[0].tests, TESTS_OK);
  const jobs = events.filter((e) => e.type === 'job');
  assert.deepEqual(jobs.map((e) => [e.status, e.id, e.room]), [['running', 'tests', 'lab'], ['done', 'tests', undefined]]);
  assert.match(jobs[1].label, /통과/);
  assert.ok(events.findIndex((e) => e.type === 'job') < events.findIndex((e) => e.type === 'start'));
});

test('테스트 실패: 보고서 판정이 최소 concern 이 되고 건수가 늘며, 테스터 아바타는 failed', async () => {
  const events = [];
  const store = fakeStore();
  const sched = createScheduler({ config: withTests({ testTimeoutSeconds: 45 }), roles: ROLES, store, run: async () => OK, buildBundle: async (j) => bundleOf(j), resolveTeam: () => 'T', emit: (e) => events.push(e),
    runTests: async (o) => ({ ...TESTS_OK, ok: false, exitCode: 2, _timeout: o.timeoutMs }) });
  sched.submit(job());
  await sched.idle();
  const review = events.find((e) => e.type === 'done').review;
  assert.deepEqual([review.verdict, review.concerns], ['concern', 1]);
  assert.equal(review.tests.ok, false);
  const last = events.filter((e) => e.type === 'job').at(-1);
  assert.deepEqual([last.status], ['failed']);
  assert.match(last.label, /실패/);
  assert.equal(review.tests._timeout, 45_000);
});

test('원격 job·팀 폴더 밖 저장소·testCommand 없는 팀은 테스트를 실행하지 않는다', async () => {
  for (const [config, j] of [[withTests(), job({ host: 'PC2', edits: [{ kind: 'edit', file: '/r/app/a.js', old: 'a', new: 'b' }] })], [withTests(), job({ repoRoot: '/other/repo', files: ['/other/repo/a.js'] })], [cfg(), job()]]) {
    let called = 0;
    const sched = createScheduler({ config, roles: ROLES, store: fakeStore(), run: async () => OK, buildBundle: async (x) => bundleOf(x), resolveTeam: () => 'T', emit: () => {}, runTests: async () => { called++; return TESTS_OK; } });
    sched.submit(j);
    await sched.idle();
    assert.equal(called, 0);
  }
});

test('원격 팀(host)에 testCommand 가 있으면 ssh 로 원격에서 실행하고, 이 PC 의 테스트는 돌리지 않는다', async () => {
  const remoteCalls = [];
  let localCalls = 0;
  const events = [];
  const store = fakeStore();
  const config = { ...cfg(), remotes: [{ name: 'PC2', ssh: 'me@h', review: true }], projects: [{ name: 'R', path: '/home/u/acc', host: 'PC2', testCommand: ['pytest', '-q'], testTimeoutSeconds: 90 }] };
  const sched = createScheduler({ config, roles: ROLES, store, run: async () => OK, resolveTeam: () => 'R', emit: (e) => events.push(e),
    runTests: async () => { localCalls++; return TESTS_OK; }, runRemoteTests: async (o) => { remoteCalls.push(o); return { ...TESTS_OK, command: 'PC2: pytest -q' }; } });
  sched.submit({ repoRoot: '/home/u/acc', host: 'PC2', sessionId: 's1', files: ['/home/u/acc/a.py'], requests: [], lastResponse: '', reason: 'stop', edits: [{ kind: 'edit', file: '/home/u/acc/a.py', old: 'a', new: 'b' }] });
  await sched.idle();
  assert.equal(localCalls, 0);
  assert.equal(remoteCalls.length, 1);
  assert.deepEqual([remoteCalls[0].remote.name, remoteCalls[0].cwd, remoteCalls[0].command, remoteCalls[0].timeoutMs], ['PC2', '/home/u/acc', ['pytest', '-q'], 90_000]);
  assert.equal(store.saved[0].tests.command, 'PC2: pytest -q');
  assert.deepEqual(events.filter((e) => e.type === 'job').map((e) => e.status), ['running', 'done']);
});

test('원격 팀이라도 host 가 다른 팀 설정·팀 폴더 밖 변경·testCommand 없음은 실행하지 않는다', async () => {
  const mkCfg = (p) => ({ ...cfg(), remotes: [{ name: 'PC2', ssh: 'me@h', review: true }, { name: 'PC3', ssh: 'me@h3', review: true }], projects: [p] });
  for (const [p, host, repoRoot] of [[{ name: 'R', path: '/home/u/acc', host: 'PC3', testCommand: ['x'] }, 'PC2', '/home/u/acc'], [{ name: 'R', path: '/home/u/acc', host: 'PC2', testCommand: ['x'] }, 'PC2', '/home/u/other'], [{ name: 'R', path: '/home/u/acc', host: 'PC2' }, 'PC2', '/home/u/acc']]) {
    let n = 0;
    const sched = createScheduler({ config: mkCfg(p), roles: ROLES, store: fakeStore(), run: async () => OK, resolveTeam: () => 'R', emit: () => {}, runTests: async () => { n++; return TESTS_OK; }, runRemoteTests: async () => { n++; return TESTS_OK; } });
    sched.submit({ repoRoot, host, sessionId: 's1', files: [`${repoRoot}/a.py`], requests: [], lastResponse: '', reason: 'stop', edits: [{ kind: 'edit', file: `${repoRoot}/a.py`, old: 'a', new: 'b' }] });
    await sched.idle();
    assert.equal(n, 0);
  }
});
