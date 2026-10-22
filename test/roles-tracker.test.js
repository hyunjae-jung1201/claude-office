import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewTracker } from '../src/roles/tracker.js';

const MIN = 60_000;
const baseConfig = (roles = {}) => ({ roles: { enabled: true, default: ['pm'], cooldownMinutes: 5, minWrites: 1, projects: {}, ...roles }, projects: [] });
// 가짜 저장소 판별: /r1/..., /r2/... 는 저장소, /plain/... 은 저장소가 아님
const groupFiles = async (files) => {
  const m = new Map();
  for (const f of files) {
    const root = /^\/(r\d)\//.exec(f)?.[1];
    if (!root) continue;
    if (!m.has(`/${root}`)) m.set(`/${root}`, []);
    m.get(`/${root}`).push(f);
  }
  return m;
};

function setup(config = baseConfig(), extra = {}) {
  let t = 1_000_000;
  const due = [];
  const tracker = createReviewTracker({ config, now: () => t, groupFiles, onDue: (j) => due.push(j), ...extra });
  const ev = (type, o = {}) => ({ sessionId: 's1', cwd: '/home/x', ts: t, type, ...o });
  return { tracker, due, ev, advance: (ms) => { t += ms; }, now: () => t };
}
const edit = (path, o = {}) => ({ category: 'write', toolName: 'Edit', filePath: path, ...o });

test('편집 없이 stop → 검토 없음', async () => {
  const { tracker, due, ev } = setup();
  await tracker.onEvent(ev('prompt', { promptText: '질문' }));
  await tracker.onEvent(ev('stop', { assistantText: '답' }));
  assert.equal(due.length, 0);
});

test('편집 후 stop → 파일·요청·응답이 담긴 due 1회', async () => {
  const { tracker, due, ev } = setup();
  await tracker.onEvent(ev('prompt', { promptText: '로그인 고쳐줘' }));
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('tool', edit('/r1/b.js')));
  await tracker.onEvent(ev('stop', { assistantText: '고쳤습니다' }));
  assert.equal(due.length, 1);
  assert.deepEqual({ repoRoot: due[0].repoRoot, sessionId: due[0].sessionId, reason: due[0].reason, requests: due[0].requests, lastResponse: due[0].lastResponse }, { repoRoot: '/r1', sessionId: 's1', reason: 'stop', requests: ['로그인 고쳐줘'], lastResponse: '고쳤습니다' });
  assert.deepEqual(due[0].files.sort(), ['/r1/a.js', '/r1/b.js']);
});

test('읽기 도구, 저장소 밖 파일만 있으면 검토 없음', async () => {
  const { tracker, due, ev } = setup();
  await tracker.onEvent(ev('tool', { category: 'read', toolName: 'Read', filePath: undefined }));
  await tracker.onEvent(ev('tool', edit('/plain/x.txt')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 0);
});

test('한 세션이 홈 폴더에서 두 저장소를 편집하면 저장소별로 due 2개 (Review Focus 1)', async () => {
  const { tracker, due, ev } = setup();
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('tool', edit('/r2/b.js')));
  await tracker.onEvent(ev('stop'));
  assert.deepEqual(due.map((j) => j.repoRoot).sort(), ['/r1', '/r2']);
  assert.deepEqual(due.find((j) => j.repoRoot === '/r1').files, ['/r1/a.js']);
});

test('쿨다운 안의 두 번째 stop은 보류, 쿨다운 후 세션이 조용하면 tick이 deferred로 1회', async () => {
  const { tracker, due, ev, advance } = setup();
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 1);
  advance(1 * MIN);
  await tracker.onEvent(ev('tool', edit('/r1/b.js')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 1);
  assert.equal(tracker.pendingCount(), 1);
  advance(2 * MIN);
  await tracker.tick();
  assert.equal(due.length, 1); // 쿨다운(5분)이 아직 안 끝남
  advance(3 * MIN);
  await tracker.tick();
  assert.equal(due.length, 2);
  assert.equal(due[1].reason, 'deferred');
  assert.deepEqual(due[1].files, ['/r1/b.js']);
  await tracker.tick();
  assert.equal(due.length, 2);
  assert.equal(tracker.pendingCount(), 0);
});

test('쿨다운이 끝났어도 세션이 아직 조용하지 않으면(30초 이내 활동) 기다린다', async () => {
  const { tracker, due, ev, advance } = setup();
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('stop'));
  advance(1 * MIN);
  await tracker.onEvent(ev('tool', edit('/r1/b.js')));
  await tracker.onEvent(ev('stop'));
  advance(5 * MIN - 10_000);
  await tracker.onEvent(ev('prompt', { promptText: '계속' })); // 활동
  advance(10_000);
  await tracker.tick();
  assert.equal(due.length, 1);
  advance(30_000);
  await tracker.tick();
  assert.equal(due.length, 2);
});

test('팀원(하위 에이전트)이 남아 있는 stop은 검토하지 않고, 모두 퇴근한 뒤의 stop에서 검토', async () => {
  const { tracker, due, ev } = setup();
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('agentStart', { agentId: 'x' }));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 0);
  await tracker.onEvent(ev('agentStop', { agentId: 'x' }));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 1);
});

test('roles.projects의 minWrites 덮어쓰기', async () => {
  const cfg = baseConfig({ projects: { '/r1': { minWrites: 3 } } });
  const { tracker, due, ev } = setup(cfg);
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('tool', edit('/r1/b.js')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 0);
  await tracker.onEvent(ev('tool', edit('/r1/c.js')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 1);
});

test('세션별로 파일이 분리되고 쿨다운은 저장소를 공유한다', async () => {
  const { tracker, due, ev } = setup();
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent({ ...ev('tool', edit('/r1/b.js')), sessionId: 's2' });
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 1);
  assert.deepEqual(due[0].files, ['/r1/a.js']);
  await tracker.onEvent({ ...ev('stop'), sessionId: 's2' });
  assert.equal(due.length, 1); // 같은 저장소 쿨다운 중
  assert.equal(tracker.pendingCount(), 1);
});

test('end는 보류 중인 변경을 즉시 내보내고 세션 상태를 지운다', async () => {
  const { tracker, due, ev, advance } = setup();
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('stop'));
  advance(MIN);
  await tracker.onEvent(ev('tool', edit('/r1/b.js')));
  await tracker.onEvent(ev('stop'));
  await tracker.onEvent(ev('end'));
  assert.equal(due.length, 2);
  assert.equal(due[1].reason, 'deferred');
  assert.equal(tracker.pendingCount(), 0);
});

test('요청은 최근 5개만, 원격(host) 이벤트와 비활성 설정은 무시, 이상한 입력에도 예외 없음', async () => {
  const { tracker, due, ev } = setup();
  for (let i = 0; i < 7; i++) await tracker.onEvent(ev('prompt', { promptText: `요청${i}` }));
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('stop'));
  assert.deepEqual(due[0].requests, ['요청2', '요청3', '요청4', '요청5', '요청6']);

  const remote = setup();
  await remote.tracker.onEvent({ ...remote.ev('tool', edit('/r1/a.js')), host: 'PC2' });
  await remote.tracker.onEvent({ ...remote.ev('stop'), host: 'PC2' });
  assert.equal(remote.due.length, 0);

  const off = setup(baseConfig({ enabled: false }));
  await off.tracker.onEvent(off.ev('tool', edit('/r1/a.js')));
  await off.tracker.onEvent(off.ev('stop'));
  assert.equal(off.due.length, 0);

  for (const bad of [null, undefined, {}, { type: 'stop' }, { sessionId: 's', type: 'mystery' }]) await tracker.onEvent(bad);
});

test('roles.excludePaths 아래 저장소는 검토 대상에서 제외된다 (접두사 경계 기준)', async () => {
  const { tracker, due, ev } = setup(baseConfig({ excludePaths: ['/r2'] }));
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('tool', edit('/r2/b.js')));
  await tracker.onEvent(ev('stop'));
  assert.deepEqual(due.map((j) => j.repoRoot), ['/r1']);
  const ex = setup(baseConfig({ excludePaths: ['/r'] })); // /r 는 /r1 의 접두사 문자열이지만 경로 경계가 다르다
  await ex.tracker.onEvent(ex.ev('tool', edit('/r1/a.js')));
  await ex.tracker.onEvent(ex.ev('stop'));
  assert.equal(ex.due.length, 1);
});

// ---- 최종 검토 반영
test('live 하트비트가 사이사이 와도 쿨다운 후 지연 검토가 시작된다 (spec §5.1-2)', async () => {
  const { tracker, due, ev, advance } = setup();
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('stop'));
  advance(1 * MIN);
  await tracker.onEvent(ev('tool', edit('/r1/b.js')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 1);
  for (let i = 0; i < 12 && due.length < 2; i++) { // 30초마다 하트비트 + tick
    advance(30_000);
    await tracker.onEvent(ev('live', { liveStatus: 'idle' }));
    await tracker.tick();
  }
  assert.equal(due.length, 2);
  assert.equal(due[1].reason, 'deferred');
});

test('live 이벤트는 추적 상태를 만들지 않는다', async () => {
  const { tracker, ev } = setup();
  await tracker.onEvent(ev('live', { liveStatus: 'idle' }));
  assert.equal(tracker.stats().sessions, 0);
});

test('오래 조용한 세션은 tick에서 정리되고, 저장소 밖 파일은 stop 뒤에 버려진다', async () => {
  const { tracker, ev, advance } = setup();
  await tracker.onEvent(ev('tool', edit('/plain/x.txt')));
  await tracker.onEvent(ev('stop'));
  assert.deepEqual([tracker.stats().sessions, tracker.stats().files], [1, 0]);
  advance(7 * 60 * MIN);
  await tracker.tick();
  assert.equal(tracker.stats().sessions, 0);
});

test('첫 편집 시점의 HEAD를 baseSha로 job에 담고, 검토 뒤 다음 편집에서 새로 잡는다', async () => {
  const heads = ['aaa111', 'bbb222'];
  const { tracker, due, ev, advance } = setup(baseConfig(), { headOf: async () => heads.shift() });
  await tracker.onEvent(ev('tool', edit('/r1/a.js')));
  await tracker.onEvent(ev('tool', edit('/r1/b.js'))); // 같은 턴의 두 번째 편집은 baseSha를 바꾸지 않는다
  await tracker.onEvent(ev('stop'));
  assert.equal(due[0].baseSha, 'aaa111');
  advance(6 * MIN);
  await tracker.onEvent(ev('tool', edit('/r1/c.js')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due[1].baseSha, 'bbb222');
});

// ---- git 없는 검토: 화면에 올린 팀 폴더 안의 수정은 수정 전·후 내용으로 검토한다
const teamCfg = (extra = {}) => ({ roles: { enabled: true, default: ['pm'], cooldownMinutes: 5, minWrites: 1, projects: {}, ...extra }, projects: [{ name: 'T', path: '/plain/proj' }, { name: 'R', path: '/remote/p', host: 'PC2' }] });
const edited = (path, o = 'a', n = 'b') => ({ category: 'write', toolName: 'Edit', filePath: path, edit: { kind: 'edit', file: path, old: o, new: n } });

test('git이 아닌 팀 폴더의 수정: 팀 폴더가 검토 단위이고 수정 내용(edits)이 job에 담긴다', async () => {
  const { tracker, due, ev } = setup(teamCfg());
  await tracker.onEvent(ev('prompt', { promptText: '값 바꿔줘' }));
  await tracker.onEvent(ev('tool', edited('/plain/proj/src/a.js', '1', '2')));
  await tracker.onEvent(ev('tool', edited('/plain/proj/b.md', 'x', 'y')));
  await tracker.onEvent(ev('stop', { assistantText: '바꿨습니다' }));
  assert.equal(due.length, 1);
  assert.equal(due[0].repoRoot, '/plain/proj');
  assert.deepEqual(due[0].files.sort(), ['/plain/proj/b.md', '/plain/proj/src/a.js']);
  assert.deepEqual(due[0].edits.map((e) => [e.file, e.old, e.new]), [['/plain/proj/src/a.js', '1', '2'], ['/plain/proj/b.md', 'x', 'y']]);
  assert.deepEqual([due[0].requests, due[0].lastResponse], [['값 바꿔줘'], '바꿨습니다']);
});

test('팀 폴더도 저장소도 아닌 파일, 원격 팀의 폴더는 검토하지 않는다', async () => {
  const { tracker, due, ev } = setup(teamCfg());
  await tracker.onEvent(ev('tool', edited('/elsewhere/x.js')));
  await tracker.onEvent(ev('tool', edited('/remote/p/y.js')));
  await tracker.onEvent(ev('stop'));
  assert.equal(due.length, 0);
  assert.deepEqual([tracker.stats().sessions, tracker.stats().files], [1, 0]); // 쌓이지 않고 버려진다
});

test('같은 턴에 git 저장소와 git 아닌 팀 폴더를 모두 고치면 각각 따로 검토한다', async () => {
  const { tracker, due, ev } = setup(teamCfg());
  await tracker.onEvent(ev('tool', edited('/r1/a.js')));
  await tracker.onEvent(ev('tool', edited('/plain/proj/p.py')));
  await tracker.onEvent(ev('stop'));
  const byRoot = Object.fromEntries(due.map((j) => [j.repoRoot, j]));
  assert.deepEqual(Object.keys(byRoot).sort(), ['/plain/proj', '/r1']);
  assert.equal(byRoot['/r1'].edits, undefined);
  assert.equal(byRoot['/plain/proj'].edits.length, 1);
});

test('git 아닌 폴더도 쿨다운·minWrites·excludePaths·검토 후 초기화가 똑같이 적용된다', async () => {
  const a = setup(teamCfg({ minWrites: 2 }));
  await a.tracker.onEvent(a.ev('tool', edited('/plain/proj/a.js')));
  await a.tracker.onEvent(a.ev('stop'));
  assert.equal(a.due.length, 0);
  await a.tracker.onEvent(a.ev('tool', edited('/plain/proj/b.js')));
  await a.tracker.onEvent(a.ev('stop'));
  assert.equal(a.due.length, 1);
  assert.equal(a.due[0].edits.length, 2);
  a.advance(MIN);
  await a.tracker.onEvent(a.ev('tool', edited('/plain/proj/c.js')));
  await a.tracker.onEvent(a.ev('tool', edited('/plain/proj/d.js')));
  await a.tracker.onEvent(a.ev('stop'));
  assert.equal(a.due.length, 1); // 쿨다운 중
  a.advance(6 * MIN);
  await a.tracker.tick();
  assert.equal(a.due.length, 2);
  assert.deepEqual(a.due[1].edits.map((e) => e.file).sort(), ['/plain/proj/c.js', '/plain/proj/d.js']); // 이전 검토의 수정은 다시 담기지 않는다

  const x = setup(teamCfg({ excludePaths: ['/plain/proj'] }));
  await x.tracker.onEvent(x.ev('tool', edited('/plain/proj/a.js')));
  await x.tracker.onEvent(x.ev('stop'));
  assert.equal(x.due.length, 0);
});

test('수정 내용이 세션당 100개를 넘으면 오래된 것부터 버린다', async () => {
  const { tracker, due, ev } = setup(teamCfg());
  for (let i = 0; i < 130; i++) await tracker.onEvent(ev('tool', edited(`/plain/proj/f${i % 5}.js`, `o${i}`, `n${i}`)));
  await tracker.onEvent(ev('stop'));
  assert.equal(due[0].edits.length, 100);
  assert.equal(due[0].edits.at(-1).new, 'n129');
});

// ---- 원격 PC 팀 검토(remotes[].review)
const remoteCfg = (review = true, extra = {}) => ({ ...teamCfg(extra), remotes: [{ name: 'PC2', ssh: 'u@h', review }] });
const rev = (setupRes, type, o = {}) => setupRes.ev(type, { host: 'PC2', cwd: '/remote/p', ...o });

test('review 를 켠 원격의 팀 폴더 수정은 host 와 수정 기록이 담긴 job 이 된다 (이 PC의 파일 시스템은 보지 않는다)', async () => {
  let called = 0;
  const r = setup(remoteCfg(), { groupFiles: async () => { called++; return new Map(); } });
  await r.tracker.onEvent(rev(r, 'prompt', { promptText: '값 바꿔줘' }));
  await r.tracker.onEvent(rev(r, 'tool', edited('/remote/p/src/a.py', '1', '2')));
  await r.tracker.onEvent(rev(r, 'stop', { assistantText: '바꿨습니다' }));
  assert.equal(called, 0);
  assert.equal(r.due.length, 1);
  assert.deepEqual([r.due[0].host, r.due[0].repoRoot, r.due[0].files], ['PC2', '/remote/p', ['/remote/p/src/a.py']]);
  assert.deepEqual(r.due[0].edits.map((e) => [e.old, e.new]), [['1', '2']]);
  assert.deepEqual([r.due[0].requests, r.due[0].lastResponse], [['값 바꿔줘'], '바꿨습니다']);
});

test('review 를 끄면(기본) 원격 이벤트는 무시하고, 원격은 host 가 같은 팀 폴더만 인정한다', async () => {
  const off = setup(remoteCfg(false));
  await off.tracker.onEvent(rev(off, 'tool', edited('/remote/p/a.py')));
  await off.tracker.onEvent(rev(off, 'stop'));
  assert.equal(off.due.length, 0);
  const on = setup(remoteCfg(true));
  await on.tracker.onEvent(rev(on, 'tool', edited('/plain/proj/a.py'))); // 이 PC 팀 폴더 경로: 원격 파일이므로 해당 없음
  await on.tracker.onEvent(rev(on, 'tool', edited('/else/b.py')));
  await on.tracker.onEvent(rev(on, 'stop'));
  assert.equal(on.due.length, 0);
});

test('원격과 이 PC 의 같은 경로는 쿨다운·검토를 따로 센다', async () => {
  const cfg = { ...remoteCfg(), projects: [{ name: 'L', path: '/shared/p' }, { name: 'R', path: '/shared/p', host: 'PC2' }] };
  const t = setup(cfg);
  await t.tracker.onEvent({ ...t.ev('tool', edited('/shared/p/a.py')) });
  await t.tracker.onEvent(t.ev('stop'));
  await t.tracker.onEvent({ ...t.ev('tool', edited('/shared/p/a.py')), sessionId: 's2', host: 'PC2' });
  await t.tracker.onEvent({ ...t.ev('stop'), sessionId: 's2', host: 'PC2' });
  assert.deepEqual(t.due.map((j) => [j.host ?? null, j.repoRoot]), [[null, '/shared/p'], ['PC2', '/shared/p']]);
});

// ---- 지금 검토(reviewNow): 쿨다운·최소 수정 수를 무시하고 그 팀 폴더의 모인 변경을 바로 검토한다
test('reviewNow: 쿨다운으로 보류된 변경을 바로 검토하고, 다른 폴더·다른 host 는 건드리지 않는다', async () => {
  const t = setup(teamCfg({ minWrites: 3 }));
  await t.tracker.onEvent(t.ev('tool', edited('/plain/proj/a.js', '1', '2')));
  await t.tracker.onEvent(t.ev('stop'));
  assert.equal(t.due.length, 0); // minWrites 3 이라 아직
  assert.equal(await t.tracker.reviewNow('/elsewhere'), 0);
  assert.equal(t.due.length, 0);
  assert.equal(await t.tracker.reviewNow('/plain/proj', 'PC2'), 0); // host 가 다르다
  assert.equal(await t.tracker.reviewNow('/plain/proj'), 1);
  assert.deepEqual([t.due[0].reason, t.due[0].files], ['manual', ['/plain/proj/a.js']]);
  assert.equal(await t.tracker.reviewNow('/plain/proj'), 0); // 이미 검토했다
});

test('reviewNow: 쿨다운 중이어도 실행하고, 하위 폴더 경계를 지킨다(/plain/proj vs /plain/proj2)', async () => {
  const t = setup(teamCfg());
  await t.tracker.onEvent(t.ev('tool', edited('/plain/proj/a.js')));
  await t.tracker.onEvent(t.ev('stop'));
  assert.equal(t.due.length, 1);
  await t.tracker.onEvent(t.ev('tool', edited('/plain/proj/b.js')));
  await t.tracker.onEvent(t.ev('stop')); // 쿨다운이라 보류
  assert.equal(t.due.length, 1);
  assert.equal(await t.tracker.reviewNow('/plain/proj2'), 0);
  assert.equal(await t.tracker.reviewNow('/plain/proj'), 1);
  assert.equal(t.due.length, 2);
});
