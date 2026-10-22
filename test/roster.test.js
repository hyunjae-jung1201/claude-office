import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterRows } from '../public/js/roster-model.js';

const snap = (teams) => ({ teams });
const team = (o = {}) => ({ name: '팅크웨어', color: '#e8637a', status: 'write', label: 'IMU 코드 수정 중', room: 'work', members: [], roles: [], badge: null, finishedAt: null, ...o });

test('팀마다 한 줄, 그 아래에 팀원과 역할자가 들여쓴 줄로 나온다', () => {
  const rows = rosterRows(snap([team({
    members: [{ id: 'a1', type: 'Explore', status: 'read', label: '자료 찾는 중', room: 'library' }],
    roles: [{ id: 'pm', name: 'PM', color: '#7c6cf0', status: 'running', label: '검토 중' }, { id: 'qa', name: 'QA', color: '#8fb339', status: 'done', label: '문제 없음' }],
  })]));
  assert.deepEqual(rows.map((r) => [r.kind, r.name, r.text]), [['team', '팅크웨어', 'IMU 코드 수정 중'], ['member', 'Explore', '자료 찾는 중'], ['role', 'PM', '검토 중'], ['role', 'QA', '문제 없음']]);
  assert.deepEqual(rows.map((r) => r.key), ['t0', 't0:m:a1', 't0:r:pm', 't0:r:qa']);
  assert.equal(rows[0].place, '작업실');
  assert.equal(rows[1].place, '자료실');
  assert.equal(rows[2].status, 'write'); // 검토 중인 역할자는 일하는 중
  assert.equal(rows[3].status, 'idle');
  assert.equal(rows[2].color, '#7c6cf0');
});

test('응답이 필요한 팀(응답 대기실)은 wait 표시가 된다', () => {
  const [r] = rosterRows(snap([team({ room: 'response', status: 'idle', label: '응답을 기다리는 중' })]));
  assert.equal(r.wait, true);
  assert.equal(r.status, 'wait');
});

test('판정 배지와 팀 5개 제한, 꺼진 팀', () => {
  const rows = rosterRows(snap(Array.from({ length: 7 }, (_, i) => team({ name: `T${i}`, status: i === 1 ? 'off' : 'write', room: i === 1 ? 'lounge' : 'work', label: i === 1 ? '꺼짐' : '일함', badge: i === 0 ? { verdict: 'concern', concerns: 2 } : null }))));
  assert.equal(rows.filter((r) => r.kind === 'team').length, 5);
  assert.deepEqual(rows[0].badge, { verdict: 'concern', concerns: 2 });
  assert.equal(rows[1].status, 'off');
  assert.equal(rows[1].text, '꺼짐');
});

test('라벨이 비면 상태별 기본 문구를 쓰고, 이상한 값은 걸러낸다', () => {
  const rows = rosterRows(snap([team({ label: '', status: 'idle', room: 'lounge' }), null, { name: 5 }]));
  assert.equal(rows[0].text, '쉬는 중');
  assert.equal(rows.length, 1);
  assert.deepEqual(rosterRows(null), []);
  assert.deepEqual(rosterRows({}), []);
});

test('parseRosterKey: 목록 줄의 key 를 팀·종류·id 로 푼다', async () => {
  const { parseRosterKey } = await import('../public/js/roster-model.js');
  assert.deepEqual(parseRosterKey('t0'), { team: 0, kind: 'team' });
  assert.deepEqual(parseRosterKey('t3:m:agent-1'), { team: 3, kind: 'member', id: 'agent-1' });
  assert.deepEqual(parseRosterKey('t2:r:pm'), { team: 2, kind: 'role', id: 'pm' });
  assert.deepEqual(parseRosterKey('t1:m:a:b'), { team: 1, kind: 'member', id: 'a:b' });
  for (const bad of ['', 'x1', 't', 't1:x:y', null, undefined, 5]) assert.equal(parseRosterKey(bad), null);
});
