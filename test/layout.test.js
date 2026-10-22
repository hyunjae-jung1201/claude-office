import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, ROOM_NAMES, FLOOR, ENTRANCE, targetFor, memberSeat, memberTarget, deskZone, roomFor } from '../public/js/layout.js';

const TEAMS = [0, 1, 2, 3, 4];
const ROOM_IDS = ['library', 'research', 'work', 'docs', 'planning', 'server', 'data', 'lab', 'build', 'git', 'briefing', 'response', 'lounge'];
const inside = (p, r, m = 0) => p.x >= r.x + m && p.x <= r.x + r.w - m && p.y >= r.y + m && p.y <= r.y + r.d - m;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const E = 1e-9; // 맞닿은 방의 부동소수점 오차는 겹침으로 보지 않는다
const overlap = (a, b) => a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.d - E && b.y < a.y + a.d - E;
const within = (g) => (a, b) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.d + g && b.y < a.y + a.d + g;
const near = within(0.5); // 맞닿아 있다
const acrossCorridor = within(1.3); // 복도(1.2칸) 하나 건너 바로 맞은편이다

test('방 13개가 모두 있고 이름이 있다 (지시 대기 구역·회의실·상담실·수면실은 없다)', () => {
  assert.deepEqual(Object.keys(ROOMS).sort(), [...ROOM_IDS].sort());
  for (const id of ROOM_IDS) assert.ok(ROOM_NAMES[id] && typeof ROOM_NAMES[id] === 'string', id);
  assert.equal(ROOM_NAMES.response, '응답 대기실');
  assert.equal(ROOM_NAMES.lounge, '휴게실');
  for (const gone of ['hall', 'meeting', 'consult', 'sleep']) assert.equal(ROOMS[gone], undefined, gone);
});

test('모든 방은 바닥 안에 있고 서로 겹치지 않는다', () => {
  for (const r of Object.values(ROOMS)) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= FLOOR.w + 1e-9 && r.y + r.d <= FLOOR.d + 1e-9);
  for (let i = 0; i < ROOM_IDS.length; i++) for (let j = i + 1; j < ROOM_IDS.length; j++) {
    assert.ok(!overlap(ROOMS[ROOM_IDS[i]], ROOMS[ROOM_IDS[j]]), `${ROOM_IDS[i]} / ${ROOM_IDS[j]}`);
  }
});

test('관련 있는 방은 서로 붙어 있다 (동선)', () => {
  const adjacent = [
    ['library', 'research'],   // 읽기
    ['work', 'research'], ['work', 'docs'], ['docs', 'planning'], // 만들기
    ['lab', 'build'], ['build', 'git'], // 검증 → 빌드 → 커밋
    ['server', 'data'], ['data', 'lab'], // 인프라·데이터 → 테스트
    ['response', 'lounge'], // 응답 대기와 휴식
  ];
  for (const [a, b] of adjacent) assert.ok(near(ROOMS[a], ROOMS[b]), `${a} ↔ ${b}`);
  const facing = [['work', 'lab'], ['work', 'build'], ['planning', 'briefing'], ['library', 'server'], ['research', 'data']]; // 복도 맞은편
  for (const [a, b] of facing) assert.ok(acrossCorridor(ROOMS[a], ROOMS[b]), `${a} ↔ ${b}`);
  // 작업실에서 나머지 일터로 가는 길: 복도(y 4~5.2)로 모두 이어진다
  for (const id of ['server', 'data', 'lab', 'build', 'git', 'briefing']) assert.ok(ROOMS[id].y >= 4 && ROOMS[id].y <= 5.4, id);
});

test('팀장의 목표: 방마다 5팀 모두 방 안(가장자리에서 0.3 이상)이고 서로 다른 자리', () => {
  for (const room of ROOM_IDS) {
    const spots = TEAMS.map((t) => targetFor('read', t, room));
    spots.forEach((p, t) => assert.ok(inside(p, ROOMS[room], 0.3), `${room}/${t} ${JSON.stringify(p)}`));
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) assert.ok(dist(spots[a], spots[b]) >= 0.55, `${room} ${a}/${b}`);
  }
});

test('포즈: 책상 일은 type, 앉는 곳(응답 대기실·휴게실)은 sit, 꺼짐은 sleep, 나머지는 stand', () => {
  const want = { work: 'type', docs: 'type', research: 'type', response: 'sit', lounge: 'sit' };
  for (const room of ROOM_IDS) for (const t of TEAMS) assert.equal(targetFor('read', t, room).pose, want[room] ?? 'stand', room);
});

test('꺼짐은 휴게실 침대에서 자고, 쉬는 중은 휴게실 소파에 앉는다 (자리가 겹치지 않는다)', () => {
  const sleep = TEAMS.map((t) => targetFor('off', t));
  const sit = TEAMS.map((t) => targetFor('idle', t));
  assert.ok(sleep.every((p) => p.pose === 'sleep' && inside(p, ROOMS.lounge, 0.3)));
  assert.ok(sit.every((p) => p.pose === 'sit' && inside(p, ROOMS.lounge, 0.3)));
  for (const a of sleep) for (const b of sit) assert.ok(dist(a, b) >= 0.8);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) assert.ok(dist(sleep[i], sleep[j]) >= 0.9);
});

test('방을 주지 않으면 상태별 기본 방', () => {
  assert.deepEqual(['read', 'write', 'run', 'wait', 'idle', 'off'].map(roomFor), ['library', 'work', 'server', 'response', 'lounge', 'lounge']);
  for (const [status, room] of [['read', 'library'], ['write', 'work'], ['run', 'server'], ['wait', 'response'], ['idle', 'lounge'], ['off', 'lounge']]) {
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

test('입구는 바닥 오른쪽 가장자리 복도에 있고, 어느 방 안도 아니다', () => {
  assert.equal(ENTRANCE.x, FLOOR.w);
  assert.ok(ENTRANCE.y > 4 && ENTRANCE.y < 5.2);
  for (const r of Object.values(ROOMS)) assert.ok(!inside(ENTRANCE, r), 'entrance inside a room');
});

test('잘못된 입력은 오류', () => {
  assert.throws(() => targetFor('dancing', 0));
  assert.throws(() => targetFor('run', 0, 'moon'));
  assert.throws(() => targetFor('run', 5), RangeError);
  assert.throws(() => memberSeat(0, 4), RangeError);
  assert.throws(() => memberTarget('read', 0, 4, 'lab'), RangeError);
});
