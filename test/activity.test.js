import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomActivity } from '../public/js/activity.js';

const team = (o = {}) => ({ name: 'A', status: 'idle', room: 'lounge', members: [], roles: [], ...o });

test('방마다 지금 일하는 아바타가 있으면 level 1, 없으면 0', () => {
  const act = roomActivity({ teams: [team({ status: 'run', room: 'build' }), team({ status: 'write', room: 'work', members: [{ status: 'run', room: 'server' }, { status: 'read', room: 'library' }] }), team()] });
  assert.equal(act.build.level, 1);
  assert.equal(act.server.level, 1);
  assert.equal(act.library.level, 1);
  assert.equal(act.lab.level, 0);
  assert.equal(act.lounge.level, 0); // 쉬는 중은 일이 아님
});

test('꺼진·쉬는 팀은 활동으로 세지 않고, 응답 대기실은 기다리는 팀 수를 센다', () => {
  const act = roomActivity({ teams: [team({ status: 'off', room: 'server' }), team({ status: 'idle', room: 'response' }), team({ status: 'idle', room: 'response' }), team({ status: 'wait', room: 'work' })] });
  assert.equal(act.server.level, 0);
  assert.equal(act.response.waiting, 2);
  assert.equal(act.work.level, 1); // 승인 대기도 그 방의 활동
});

test('테스트 랩: tests 작업 아바타의 상태(running/done/failed)가 모니터 상태가 된다', () => {
  const run = roomActivity({ teams: [team({ roles: [{ id: 'tests', status: 'running', room: 'lab' }] })] });
  assert.deepEqual([run.lab.tests, run.lab.level], ['running', 1]);
  assert.equal(roomActivity({ teams: [team({ roles: [{ id: 'tests', status: 'done', room: 'lab' }] })] }).lab.tests, 'done');
  assert.equal(roomActivity({ teams: [team({ roles: [{ id: 'tests', status: 'failed', room: 'lab' }] })] }).lab.tests, 'failed');
  assert.equal(roomActivity({ teams: [team()] }).lab.tests, null);
  // 한 팀이라도 실패면 실패, 그 다음 실행 중, 통과
  const mix = roomActivity({ teams: [team({ roles: [{ id: 'tests', status: 'done', room: 'lab' }] }), team({ roles: [{ id: 'tests', status: 'failed', room: 'lab' }] })] });
  assert.equal(mix.lab.tests, 'failed');
});

test('이상한 입력에도 예외 없이 모든 방을 돌려준다', () => {
  for (const bad of [null, {}, { teams: null }, { teams: [null, { members: 5, roles: 'x' }] }]) {
    const act = roomActivity(bad);
    assert.equal(act.build.level, 0);
    assert.equal(act.response.waiting, 0);
  }
});
