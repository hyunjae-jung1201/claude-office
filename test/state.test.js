import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyEvent, tick, snapshot, setLabel } from '../src/state.js';

const config = {
  port: 9410, offAfterMinutes: 10, maxMembers: 4, celebrateAfterSeconds: 30,
  projects: [
    { name: 'A', path: '/w/a', color: '#e8637a' },
    { name: 'B', path: '/w/b', color: '#2a7f8f' },
  ],
};
const SEC = 1000;
const MIN = 60 * SEC;
const ev = (type, ts, extra = {}) => ({ sessionId: 's1', cwd: '/w/a', type, ts, ...extra });
const teamA = (st, now) => snapshot(st, now).teams.find((t) => t.name === 'A');

function feed(st, ...events) {
  for (const e of events) applyEvent(st, e, e.ts);
}

test('이벤트가 없으면 모든 프로젝트가 off이고 설정 순서대로 나온다', () => {
  const snap = snapshot(createState(config), 0);
  assert.deepEqual(snap.teams.map((t) => [t.name, t.status, t.members.length, t.overflow, t.finishedAt]),
    [['A', 'off', 0, 0, null], ['B', 'off', 0, 0, null]]);
  assert.equal(snap.teams[0].color, '#e8637a');
});

test('start → idle, end → off', () => {
  const st = createState(config);
  feed(st, ev('start', 1000));
  assert.equal(teamA(st, 1000).status, 'idle');
  feed(st, ev('end', 2000));
  assert.equal(teamA(st, 2000).status, 'off');
});

test('prompt → read(요청 파악 중), tool → category, toolDone은 상태 유지, stop → idle', () => {
  const st = createState(config);
  feed(st, ev('start', 0), ev('prompt', 1000));
  assert.deepEqual([teamA(st, 1000).status, teamA(st, 1000).label], ['read', '요청 파악 중']);
  feed(st, ev('tool', 2000, { category: 'run', detail: 'npm test' }));
  assert.equal(teamA(st, 2000).status, 'run');
  feed(st, ev('toolDone', 3000, { category: 'run' }));
  assert.equal(teamA(st, 3000).status, 'run');
  feed(st, ev('stop', 4000));
  assert.deepEqual([teamA(st, 4000).status, teamA(st, 4000).label], ['idle', '응답 기다리는 중']); // 턴이 끝나면 사용자의 응답을 기다린다
});

test('wait → wait, 승인 후 toolDone이 오면 그 도구 상태로 돌아간다', () => {
  const st = createState(config);
  feed(st, ev('start', 0), ev('tool', 1000, { category: 'run' }), ev('wait', 2000));
  assert.equal(teamA(st, 2000).status, 'wait');
  feed(st, ev('toolDone', 3000, { category: 'run' }));
  assert.equal(teamA(st, 3000).status, 'run');
});

test('지정하지 않은 cwd는 무시된다', () => {
  const st = createState(config);
  feed(st, { sessionId: 'h', cwd: '/home/hyeanjae', type: 'tool', category: 'run', ts: 1 });
  assert.ok(snapshot(st, 1).teams.every((t) => t.status === 'off'));
});

test('같은 프로젝트의 세션 2개: 최신 이벤트 세션이 표시되고, 한쪽 end 후에도 다른 쪽이 살아 있으면 off가 아니다', () => {
  const st = createState(config);
  feed(st, ev('tool', 1000, { category: 'read' }));
  feed(st, { ...ev('tool', 2000, { category: 'run' }), sessionId: 's2' });
  assert.equal(teamA(st, 2000).status, 'run');
  feed(st, { ...ev('end', 3000), sessionId: 's2' });
  assert.equal(teamA(st, 3000).status, 'read');
  feed(st, ev('end', 4000));
  assert.equal(teamA(st, 4000).status, 'off');
});

test('agentStart는 팀원을 만들고, 팀원의 도구 호출은 팀장 상태를 바꾸지 않는다, agentStop은 퇴근', () => {
  const st = createState(config);
  feed(st, ev('start', 0), ev('tool', 500, { category: 'write' }));
  feed(st, ev('agentStart', 1000, { agentId: 'x1', agentType: 'Explore' }));
  let t = teamA(st, 1000);
  assert.equal(t.members.length, 1);
  assert.equal(t.members[0].type, 'Explore');
  feed(st, ev('tool', 2000, { category: 'read', detail: '/w/a/f.txt', agentId: 'x1', agentType: 'Explore' }));
  t = teamA(st, 2000);
  assert.equal(t.status, 'write');
  assert.equal(t.members[0].status, 'read');
  feed(st, ev('agentStop', 3000, { agentId: 'x1' }));
  assert.equal(teamA(st, 3000).members.length, 0);
});

test('팀원 6명이면 4명만 나오고 overflow는 2', () => {
  const st = createState(config);
  for (let i = 0; i < 6; i++) feed(st, ev('agentStart', 1000 + i, { agentId: `m${i}`, agentType: 'general-purpose' }));
  const t = teamA(st, 2000);
  assert.equal(t.members.length, 4);
  assert.equal(t.overflow, 2);
  assert.deepEqual(t.members.map((m) => m.id), ['m0', 'm1', 'm2', 'm3']);
});

test('tick: 10분 조용하면 off, 진행 중 도구가 있으면 더 오래 버틴다(60분)', () => {
  const st = createState(config);
  feed(st, ev('start', 0));
  tick(st, 9 * MIN);
  assert.equal(teamA(st, 9 * MIN).status, 'idle');
  tick(st, 11 * MIN);
  assert.equal(teamA(st, 11 * MIN).status, 'off');

  const st2 = createState(config);
  feed(st2, ev('tool', 0, { category: 'run' }));
  tick(st2, 30 * MIN);
  assert.equal(teamA(st2, 30 * MIN).status, 'run');
  tick(st2, 61 * MIN);
  assert.equal(teamA(st2, 61 * MIN).status, 'off');
});

test('finishedAt: 30초 이상 일한 뒤 stop이면 설정, 짧으면 null, 새 prompt가 오면 null', () => {
  const st = createState(config);
  feed(st, ev('prompt', 0), ev('tool', 5 * SEC, { category: 'run' }), ev('stop', 40 * SEC));
  assert.equal(teamA(st, 40 * SEC).finishedAt, 40 * SEC);
  feed(st, ev('prompt', 50 * SEC));
  assert.equal(teamA(st, 50 * SEC).finishedAt, null);
  feed(st, ev('stop', 60 * SEC));
  assert.equal(teamA(st, 60 * SEC).finishedAt, null); // 10초만 일함
});

test('prompt 없이 온 stop은 완료 연출이 없다', () => {
  const st = createState(config);
  feed(st, ev('start', 0), ev('stop', 60 * SEC));
  assert.equal(teamA(st, 60 * SEC).finishedAt, null);
});

test('팀원이 남아 있는 동안의 stop은 완료가 아니다. 모두 퇴근한 뒤의 stop에서 완료', () => {
  const st = createState(config);
  feed(st, ev('prompt', 0), ev('agentStart', 5 * SEC, { agentId: 'x', agentType: 'Explore' }), ev('stop', 40 * SEC));
  let t = teamA(st, 40 * SEC);
  assert.equal(t.finishedAt, null);
  assert.equal(t.status, 'idle');
  assert.equal(t.label, '하위 에이전트 기다리는 중');
  feed(st, ev('agentStop', 50 * SEC, { agentId: 'x' }), ev('stop', 55 * SEC));
  t = teamA(st, 55 * SEC);
  assert.equal(t.finishedAt, 55 * SEC);
  assert.equal(t.label, '응답 기다리는 중');
});

test('setLabel은 팀장/팀원의 말풍선 문구를 바꾼다', () => {
  const st = createState(config);
  feed(st, ev('tool', 1000, { category: 'run' }), ev('agentStart', 1500, { agentId: 'x', agentType: 'Explore' }));
  setLabel(st, 's1', null, '학습에 필요한 데이터 다운 중');
  setLabel(st, 's1', 'x', '모델 후보 조사 중');
  const t = teamA(st, 2000);
  assert.equal(t.label, '학습에 필요한 데이터 다운 중');
  assert.equal(t.members[0].label, '모델 후보 조사 중');
  assert.doesNotThrow(() => setLabel(st, 'nope', null, 'x'));
});

// ---- 세션 등록 정보(live): 응답은 끝났지만 백그라운드 명령이 도는 중, 살아 있는 세션
const aliasConfig = { ...config, projects: [{ name: 'A', path: '/w/a', color: '#e8637a', aliases: ['에이 세션'] }, config.projects[1]] };
const live = (liveStatus, o = {}) => ({ sessionId: 's1', cwd: '/home/x', sessionName: '에이 세션', type: 'live', liveStatus, ts: 0, ...o });

test('live: 세션 이름이 맞으면 세션을 만들고, idle이면 꺼짐이 아니라 대기', () => {
  const st = createState(aliasConfig);
  feed(st, live('idle', { ts: 1000 }));
  const t = teamA(st, 1000);
  assert.deepEqual([t.status, t.label], ['idle', '다음 지시 기다리는 중']);
});

test('live shell + 응답 끝남(idle) → 서버실에서 "백그라운드 작업 중", live idle이면 다시 대기', () => {
  const st = createState(aliasConfig);
  feed(st, live('idle', { ts: 0 }), ev('start', 1), ev('stop', 2));
  feed(st, live('shell', { ts: 3000 }));
  assert.deepEqual([teamA(st, 3000).status, teamA(st, 3000).label], ['run', '백그라운드 작업 중']);
  feed(st, live('idle', { ts: 4000 }));
  assert.equal(teamA(st, 4000).status, 'idle');
});

test('live shell이어도 팀장이 직접 도구를 쓰는 중이면 그 상태가 우선', () => {
  const st = createState(aliasConfig);
  feed(st, ev('tool', 1000, { category: 'read', detail: '/w/a/x' }), live('shell', { cwd: '/w/a', ts: 2000 }));
  assert.equal(teamA(st, 2000).status, 'read');
});

test('live gone → 세션 삭제(꺼짐), 지정되지 않은 세션은 무시', () => {
  const st = createState(aliasConfig);
  feed(st, live('idle', { ts: 0 }));
  feed(st, live('gone', { ts: 1000 }));
  assert.equal(teamA(st, 1000).status, 'off');
  feed(st, live('shell', { sessionId: 'x', sessionName: '모르는 이름', ts: 2000 }));
  assert.ok(snapshot(st, 2000).teams.every((t) => t.status === 'off'));
});

test('live 신호가 계속 오면 10분 넘게 조용해도 꺼지지 않는다', () => {
  const st = createState(aliasConfig);
  feed(st, live('idle', { ts: 0 }));
  for (let t = 30_000; t <= 20 * MIN; t += 30_000) { feed(st, live('idle', { ts: t })); tick(st, t); }
  assert.equal(teamA(st, 20 * MIN).status, 'idle');
});

// ---- 역할자 검토 상태
import { applyReviewEvent, setReviewHistory, teamOfSession, ROLE_LINGER_MS } from '../src/state.js';

const ROLES3 = [{ id: 'pm', name: 'PM', color: '#e8637a' }, { id: 'developer', name: '개발자', color: '#2a7f8f' }, { id: 'qa', name: 'QA', color: '#8fb339' }];
const rev = (o = {}) => ({ id: 'r1', repoRoot: '/w/a', repoName: 'a', team: 'A', startedAt: 1000, finishedAt: 9000, verdict: 'concern', concerns: 2, results: [{ roleId: 'pm', verdict: 'ok', summary: '충족', findings: [] }, { roleId: 'qa', verdict: 'concern', summary: '빈 값 미처리', findings: [] }], files: [], ...o });

test('검토 시작: 팀에 역할자 3명이 running으로 나타난다', () => {
  const st = createState(config);
  applyReviewEvent(st, { type: 'start', repoRoot: '/w/a', repoName: 'a', team: 'A', roles: ROLES3 }, 1000);
  const t = teamA(st, 1000);
  assert.deepEqual(t.roles.map((r) => [r.id, r.name, r.color, r.status, r.label]), ROLES3.map((r) => [r.id, r.name, r.color, 'running', '검토 중']));
  assert.equal(t.badge, null);
});

test('역할 결과가 오면 상태·문구가 바뀌고, 완료 후 일정 시간이 지나면 사라지며 배지가 남는다', () => {
  const st = createState(config);
  applyReviewEvent(st, { type: 'start', repoRoot: '/w/a', repoName: 'a', team: 'A', roles: ROLES3 }, 1000);
  applyReviewEvent(st, { type: 'role', repoRoot: '/w/a', team: 'A', roleId: 'pm', status: 'done', summary: '요구사항 충족' }, 2000);
  applyReviewEvent(st, { type: 'role', repoRoot: '/w/a', team: 'A', roleId: 'qa', status: 'failed' }, 2500);
  let t = teamA(st, 3000);
  assert.deepEqual(t.roles.map((r) => [r.id, r.status, r.label]), [['pm', 'done', '요구사항 충족'], ['developer', 'running', '검토 중'], ['qa', 'failed', '검토 실패']]);
  applyReviewEvent(st, { type: 'done', repoRoot: '/w/a', team: 'A', review: rev() }, 9000);
  t = teamA(st, 9000);
  assert.deepEqual(t.badge, { verdict: 'concern', concerns: 2, at: 9000 });
  assert.ok(t.roles.every((r) => r.status !== 'running')); // 남아 있던 running은 끝난 것으로 정리
  t = teamA(st, 9000 + ROLE_LINGER_MS + 1);
  assert.deepEqual(t.roles, []);
  assert.equal(t.badge.verdict, 'concern'); // 배지는 다음 검토 때까지 유지
});

test('팀이 없는 저장소의 검토는 최근 검토 목록에만 반영된다', () => {
  const st = createState(config);
  applyReviewEvent(st, { type: 'start', repoRoot: '/x/free', repoName: 'free', roles: ROLES3 }, 1000);
  applyReviewEvent(st, { type: 'done', repoRoot: '/x/free', review: rev({ repoRoot: '/x/free', repoName: 'free', team: undefined }) }, 9000);
  const snap = snapshot(st, 9000);
  assert.ok(snap.teams.every((t) => t.badge === null && t.roles.length === 0));
  assert.deepEqual(snap.reviews.map((r) => [r.repoName, r.team, r.verdict, r.concerns, r.summary]), [['free', undefined, 'concern', 2, '빈 값 미처리']]);
});

test('최근 검토 목록은 최근순 20건, 한도 도달 알림은 이후 검토 완료 때 사라진다', () => {
  const st = createState(config);
  for (let i = 0; i < 25; i++) applyReviewEvent(st, { type: 'done', repoRoot: '/w/a', team: 'A', review: rev({ id: `r${i}`, finishedAt: 1000 + i }) }, 1000 + i);
  const snap = snapshot(st, 5000);
  assert.equal(snap.reviews.length, 20);
  assert.equal(snap.reviews[0].id, 'r24');
  applyReviewEvent(st, { type: 'skipped', repoRoot: '/w/a', team: 'A', reason: 'limit' }, 6000);
  assert.equal(snapshot(st, 6000).reviewNotice, '오늘 검토 한도에 도달했습니다');
  applyReviewEvent(st, { type: 'skipped', repoRoot: '/w/a', reason: 'no-roles' }, 6100);
  assert.equal(snapshot(st, 6100).reviewNotice, '오늘 검토 한도에 도달했습니다'); // 다른 사유는 알림을 바꾸지 않는다
  applyReviewEvent(st, { type: 'done', repoRoot: '/w/a', team: 'A', review: rev({ id: 'later' }) }, 7000);
  assert.equal(snapshot(st, 7000).reviewNotice, undefined);
});

test('setReviewHistory: 서버 재시작 때 저장된 검토에서 목록과 팀 배지를 복원한다', () => {
  const st = createState(config);
  setReviewHistory(st, [rev({ id: 'new', finishedAt: 5000, verdict: 'ok', concerns: 0 }), rev({ id: 'old', finishedAt: 1000 })]);
  const snap = snapshot(st, 6000);
  assert.deepEqual(snap.reviews.map((r) => r.id), ['new', 'old']);
  assert.deepEqual(teamA(st, 6000).badge, { verdict: 'ok', concerns: 0, at: 5000 });
});

test('teamOfSession: 세션이 속한 팀 이름, 없으면 undefined', () => {
  const st = createState(config);
  feed(st, ev('start', 0));
  assert.equal(teamOfSession(st, 's1'), 'A');
  assert.equal(teamOfSession(st, 'nope'), undefined);
});

test('검토 정보가 없는 스냅샷에도 새 필드가 기본값으로 있다', () => {
  const snap = snapshot(createState(config), 0);
  assert.ok(snap.teams.every((t) => Array.isArray(t.roles) && t.roles.length === 0 && t.badge === null));
  assert.deepEqual(snap.reviews, []);
  assert.equal(snap.reviewNotice, undefined);
});

test('setReviewHistory: results가 없거나 이상한 검토가 섞여 있어도 예외 없이 건너뛴다', () => {
  const st = createState(config);
  assert.doesNotThrow(() => setReviewHistory(st, [{ id: 'bad' }, null, rev({ id: 'ok1', finishedAt: 3000 }), { id: 'bad2', results: 'x' }]));
  assert.deepEqual(snapshot(st, 5000).reviews.map((r) => r.id), ['ok1']);
});

// ---- 방(room): 상태 + 작업 종류로 아바타가 갈 곳
import { RESPONSE_WAIT_MS } from '../src/state.js';
const roomA = (st, now) => teamA(st, now).room;

test('room: 도구의 activity가 팀장의 방이 되고, 없으면 상태별 기본 방', () => {
  const st = createState(aliasConfig);
  feed(st, ev('start', 0));
  assert.equal(roomA(st, 0), 'lounge'); // 막 시작한 세션은 휴게실
  feed(st, ev('prompt', 1000));
  assert.equal(roomA(st, 1000), 'work'); // 요청 파악은 읽기가 아니라 팀 책상에서
  feed(st, ev('tool', 2000, { category: 'run', activity: 'lab', detail: 'npm test' }));
  assert.equal(roomA(st, 2000), 'lab');
  feed(st, ev('tool', 3000, { category: 'write', activity: 'docs' }));
  assert.equal(roomA(st, 3000), 'docs');
  feed(st, ev('tool', 4000, { category: 'run' })); // activity 없음(예: 이전 형식 이벤트)
  assert.equal(roomA(st, 4000), 'server');
  feed(st, ev('tool', 5000, { category: 'write' }));
  assert.equal(roomA(st, 5000), 'work');
  feed(st, ev('tool', 6000, { category: 'read' }));
  assert.equal(roomA(st, 6000), 'library');
});

test('room: 하위 에이전트를 맡기는 중은 브리핑룸, 승인·질문·계획 승인 대기는 모두 응답 대기실', () => {
  const st = createState(aliasConfig);
  feed(st, ev('tool', 1000, { category: 'write', activity: 'briefing' }));
  assert.equal(roomA(st, 1000), 'briefing');
  feed(st, ev('wait', 2000, { waitKind: 'approval', activity: 'response' }));
  assert.equal(roomA(st, 2000), 'response');
  feed(st, ev('wait', 3000, { waitKind: 'answer', activity: 'response' }));
  assert.equal(roomA(st, 3000), 'response');
  feed(st, ev('wait', 4000, { waitKind: 'approval' }));
  assert.equal(roomA(st, 4000), 'response'); // activity 없어도 대기 상태는 응답 대기실
});

test('room: 응답이 필요한 동안(턴이 끝난 뒤)은 응답 대기실, 5분이 지나면 휴게실, 다시 일하면 처음부터', () => {
  const st = createState(aliasConfig);
  feed(st, ev('tool', 0, { category: 'run', activity: 'build' }), ev('stop', 1000));
  const t = teamA(st, 1000);
  assert.deepEqual([t.room, t.status, t.label], ['response', 'idle', '응답 기다리는 중']);
  assert.equal(roomA(st, 1000 + RESPONSE_WAIT_MS - 1), 'response');
  const later = teamA(st, 1000 + RESPONSE_WAIT_MS + 1);
  assert.deepEqual([later.room, later.label], ['lounge', '다음 지시 기다리는 중']);
  feed(st, ev('prompt', 2_000_000));
  assert.equal(roomA(st, 2_000_000), 'work');
  feed(st, ev('stop', 2_001_000));
  assert.equal(roomA(st, 2_001_000), 'response');
});

test('room: 지시를 기다리기만 하는 세션(시작 직후·등록 정보만 있는 세션)은 휴게실, 꺼짐도 휴게실(침대), 백그라운드 작업은 서버실', () => {
  const st = createState(aliasConfig);
  feed(st, live('idle', { ts: 0 }));
  assert.equal(roomA(st, 10), 'lounge');
  assert.equal(snapshot(createState(aliasConfig), 0).teams[0].room, 'lounge'); // off → 휴게실에서 수면
  const bg = createState(aliasConfig);
  feed(bg, ev('start', 0), ev('stop', 1));
  feed(bg, { sessionId: 's1', cwd: '/w/a', type: 'live', liveStatus: 'shell', ts: 5 });
  assert.equal(roomA(bg, 10), 'server');
});

test('room: 하위 에이전트가 남아 있는 동안의 stop은 응답을 기다리는 것이 아니다', () => {
  const st = createState(aliasConfig);
  feed(st, ev('prompt', 0), ev('agentStart', 100, { agentId: 'x', agentType: 'Explore' }), ev('stop', 1000));
  assert.equal(roomA(st, 1000), 'lounge');
  feed(st, ev('agentStop', 2000, { agentId: 'x' }), ev('stop', 2500));
  assert.equal(roomA(st, 2500), 'response');
});

test('room: 팀원은 자기 도구의 activity, 없으면 책상(작업실)', () => {
  const st = createState(aliasConfig);
  feed(st, ev('agentStart', 0, { agentId: 'x', agentType: 'Explore' }));
  assert.equal(teamA(st, 0).members[0].room, 'work');
  feed(st, ev('tool', 1000, { category: 'read', activity: 'research', agentId: 'x' }));
  assert.equal(teamA(st, 1000).members[0].room, 'research');
  feed(st, ev('tool', 2000, { category: 'run', activity: 'lab', agentId: 'x' }));
  assert.equal(teamA(st, 2000).members[0].room, 'lab');
});

test('responseWaitMinutes 설정으로 응답 대기실에 머무는 시간을 바꾼다(기본 5분)', () => {
  const st = createState({ ...aliasConfig, responseWaitMinutes: 0.5 });
  feed(st, ev('prompt', 0), ev('stop', 1000));
  assert.equal(roomA(st, 1000 + 29_000), 'response');
  assert.equal(roomA(st, 1000 + 31_000), 'lounge');
});
