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
  assert.deepEqual([teamA(st, 4000).status, teamA(st, 4000).label], ['idle', '다음 지시 기다리는 중']);
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
  assert.equal(t.label, '다음 지시 기다리는 중');
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
