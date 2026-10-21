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
