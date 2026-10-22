import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, ROOM_NAMES, FLOOR, ENTRANCE, targetFor, memberSeat, memberTarget, deskZone, roomFor } from '../public/js/layout.js';

const TEAMS = [0, 1, 2, 3, 4];
const ROOM_IDS = ['library', 'work', 'docs', 'planning', 'research', 'hall', 'server', 'lab', 'build', 'git', 'data', 'meeting', 'briefing', 'consult', 'lounge', 'sleep'];
const inside = (p, r, m = 0) => p.x >= r.x + m && p.x <= r.x + r.w - m && p.y >= r.y + m && p.y <= r.y + r.d - m;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const E = 1e-9; // 맞닿은 방의 부동소수점 오차는 겹침으로 보지 않는다
const overlap = (a, b) => a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.d - E && b.y < a.y + a.d - E;

test('방 16개가 모두 있고 이름이 있다', () => {
  assert.deepEqual(Object.keys(ROOMS).sort(), [...ROOM_IDS].sort());
  for (const id of ROOM_IDS) assert.ok(ROOM_NAMES[id] && typeof ROOM_NAMES[id] === 'string', id);
});

test('모든 방은 바닥 안에 있고 서로 겹치지 않는다', () => {
  for (const r of Object.values(ROOMS)) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= FLOOR.w + 1e-9 && r.y + r.d <= FLOOR.d + 1e-9);
  for (let i = 0; i < ROOM_IDS.length; i++) for (let j = i + 1; j < ROOM_IDS.length; j++) {
    assert.ok(!overlap(ROOMS[ROOM_IDS[i]], ROOMS[ROOM_IDS[j]]), `${ROOM_IDS[i]} / ${ROOM_IDS[j]}`);
  }
});

test('팀장의 목표: 방마다 5팀 모두 방 안(가장자리에서 0.3 이상)이고 서로 다른 자리', () => {
  for (const room of ROOM_IDS) {
    const spots = TEAMS.map((t) => targetFor('read', t, room));
    spots.forEach((p, t) => assert.ok(inside(p, ROOMS[room], 0.3), `${room}/${t} ${JSON.stringify(p)}`));
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) assert.ok(dist(spots[a], spots[b]) >= 0.55, `${room} ${a}/${b}`);
  }
});

test('포즈: 책상 일은 type, 쉬는 곳은 sit, 수면실은 sleep, 나머지는 stand', () => {
  const want = { work: 'type', docs: 'type', research: 'type', hall: 'sit', lounge: 'sit', sleep: 'sleep' };
  for (const room of ROOM_IDS) for (const t of TEAMS) assert.equal(targetFor('read', t, room).pose, want[room] ?? 'stand', room);
});

test('방을 주지 않으면 상태별 기본 방', () => {
  assert.deepEqual(['read', 'write', 'run', 'wait', 'idle', 'off'].map(roomFor), ['library', 'work', 'server', 'meeting', 'hall', 'sleep']);
  for (const [status, room] of [['read', 'library'], ['write', 'work'], ['run', 'server'], ['wait', 'meeting'], ['idle', 'hall'], ['off', 'sleep']]) {
    assert.deepEqual(targetFor(status, 2), targetFor(status, 2, room));
  }
});

test('같은 입력은 같은 좌표', () => {
  assert.deepEqual(targetFor('run', 3, 'lab'), targetFor('run', 3, 'lab'));
  assert.deepEqual(memberSeat(2, 1), memberSeat(2, 1));
});

test('책상 구역은 작업실 안에 있고 서로 겹치지 않는다', () => {
  for (const a of TEAMS) {
    const z = deskZone(a);
    assert.ok(inside({ x: z.x, y: z.y }, ROOMS.work) && inside({ x: z.x + z.w, y: z.y + z.d }, ROOMS.work));
    for (const b of TEAMS) if (a < b) assert.ok(!overlap(deskZone(a), deskZone(b)), `${a}/${b}`);
  }
});

test('팀장 책상 자리는 팀 책상 구역 안이고, 팀원 4명의 자리는 구역 안에서 서로·팀장석과 다르다', () => {
  const all = [];
  for (const t of TEAMS) {
    const leader = targetFor('write', t);
    assert.ok(inside(leader, deskZone(t)));
    const seats = [0, 1, 2, 3].map((m) => memberSeat(t, m));
    for (const s of seats) {
      assert.ok(inside(s, deskZone(t)), `team ${t}`);
      assert.ok(dist(s, leader) >= 0.5);
      all.push(s);
    }
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(dist(all[i], all[j]) >= 0.5, `${i}/${j}`);
});

test('팀원 목표: 작업실이면 책상 자리, 그 밖의 방에서는 해당 방 안에서 팀장·다른 팀원과 겹치지 않는다', () => {
  for (const t of TEAMS) {
    for (let m = 0; m < 4; m++) assert.deepEqual(memberTarget('write', t, m), { ...memberSeat(t, m), pose: 'type' });
    for (const room of ROOM_IDS.filter((r) => r !== 'work')) {
      const lead = targetFor('read', t, room);
      const pts = [0, 1, 2, 3].map((m) => memberTarget('read', t, m, room));
      pts.forEach((p) => {
        assert.ok(inside(p, ROOMS[room]), `${room}/${t} ${JSON.stringify(p)}`);
        assert.ok(dist(p, lead) >= 0.25, `${room}/${t} leader`);
      });
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(dist(pts[i], pts[j]) >= 0.25, `${room}/${t} ${i}/${j}`);
    }
  }
});

test('입구는 바닥 오른쪽 가장자리 복도에 있다', () => {
  assert.equal(ENTRANCE.x, FLOOR.w);
  assert.ok(ENTRANCE.y >= ROOMS.hall.y && ENTRANCE.y <= ROOMS.hall.y + ROOMS.hall.d);
});

test('잘못된 입력은 오류', () => {
  assert.throws(() => targetFor('dancing', 0));
  assert.throws(() => targetFor('run', 0, 'moon'));
  assert.throws(() => targetFor('run', 5), RangeError);
  assert.throws(() => memberSeat(0, 4), RangeError);
  assert.throws(() => memberTarget('read', 0, 4, 'lab'), RangeError);
});
