import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, ROOM_NAMES, FLOOR, ENTRANCE, targetFor, memberSeat, memberTarget, deskZone, roomFor, freeSpotFor, pickMemberSpot, researchSeats, docsSeats, RESEARCH_TABLES, DOCS_TABLE } from '../public/js/layout.js';

const TEAMS = [0, 1, 2, 3, 4, 5, 6];
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

test('팀장의 목표: 방마다 7팀 모두 방 안(가장자리에서 0.3 이상)이고 서로 다른 자리', () => {
  for (const room of ROOM_IDS) {
    const spots = TEAMS.map((t) => targetFor('read', t, room));
    spots.forEach((p, t) => assert.ok(inside(p, ROOMS[room], 0.3), `${room}/${t} ${JSON.stringify(p)}`));
    for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) assert.ok(dist(spots[a], spots[b]) >= 0.45, `${room} ${a}/${b}`);
  }
});

test('포즈: 방마다 그 방의 일을 한다(책상에 앉아 타자 sitType, 서서 타자 type, 책 꺼내기 browse, 보드 쓰기 write, 시약 mix, 장비 tinker, 가리키기 point, 발표 present), 앉는 곳은 sit', () => {
  const want = { work: 'sitType', docs: 'sitType', research: 'sitType', response: 'sit', lounge: 'sit', library: 'browse', data: 'browse', planning: 'write', server: 'type', lab: 'mix', build: 'tinker', git: 'point', briefing: 'present' };
  for (const room of ROOM_IDS) for (const t of TEAMS) assert.equal(targetFor('read', t, room).pose, want[room] ?? 'stand', room);
});

test('꺼짐은 휴게실 침대에서 자고, 쉬는 중은 휴게실 소파에 앉는다 (자리가 겹치지 않는다)', () => {
  const sleep = TEAMS.map((t) => targetFor('off', t));
  const sit = TEAMS.map((t) => targetFor('idle', t));
  assert.ok(sleep.every((p) => p.pose === 'sleep' && inside(p, ROOMS.lounge, 0.3)));
  assert.ok(sit.every((p) => p.pose === 'sit' && inside(p, ROOMS.lounge, 0.3)));
  for (const a of sleep) for (const b of sit) assert.ok(dist(a, b) >= 0.8);
  for (let i = 0; i < sleep.length; i++) for (let j = i + 1; j < sleep.length; j++) assert.ok(dist(sleep[i], sleep[j]) >= 0.9 - 1e-9);
});

test('방을 주지 않으면 상태별 기본 방', () => {
  assert.deepEqual(['read', 'write', 'run', 'wait', 'idle', 'off'].map(roomFor), ['library', 'work', 'work', 'response', 'lounge', 'lounge']);
  for (const [status, room] of [['read', 'library'], ['write', 'work'], ['run', 'work'], ['wait', 'response'], ['idle', 'lounge'], ['off', 'lounge']]) {
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

test('일하는 방은 일하는 대상 쪽(face)을 바라본다: 서버 랙은 왼쪽, 나머지는 뒷벽, 팀원도 같은 방향', () => {
  assert.equal(targetFor('read', 0, 'server').face, -Math.PI / 2);
  for (const room of ['library', 'data', 'planning', 'lab', 'build', 'git', 'briefing']) assert.equal(targetFor('read', 1, room).face, Math.PI, room);
  assert.deepEqual([0, 1, 2].map((t) => targetFor('read', t, 'research').face), [Math.PI / 2, -Math.PI / 2, Math.PI]); // 둥근 탁자: 마주 보고 둘러앉는다
  assert.deepEqual([0, 3].map((t) => targetFor('read', t, 'docs').face), [0, Math.PI]); // 긴 탁자: 양쪽에서 마주 본다
  assert.equal(targetFor('read', 1, 'lounge').face, undefined);
  assert.equal(memberTarget('read', 1, 2, 'library').face, Math.PI);
});

test('팀원 목표: 작업실이면 책상 자리, 그 밖의 방에서는 해당 방 안에서 팀장·다른 팀원과 겹치지 않는다', () => {
  for (const t of TEAMS) {
    for (let m = 0; m < 4; m++) assert.deepEqual(memberTarget('write', t, m), { ...memberSeat(t, m), pose: 'sitType' });
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
  assert.throws(() => targetFor('run', 7), RangeError);
  assert.throws(() => memberSeat(0, 4), RangeError);
  assert.throws(() => memberTarget('read', 0, 4, 'lab'), RangeError);
});

// ---- 칸막이 벽과 출입구: 벽을 뚫고 지나가지 않고 문(틈)으로 돌아서 간다
import { DOOR_LINES, DOOR_W, route } from '../public/js/layout.js';

const inGap = (x, y) => DOOR_LINES.find((l) => l.y === y).doors.some((d) => Math.abs(x - d) <= DOOR_W / 2 + 1e-9);
// 경로의 모든 선분이 칸막이 선(y)을 문 안에서만 건너는지
function crossesOnlyThroughDoors(from, to, via) {
  const pts = [from, ...via, to];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    for (const { y } of DOOR_LINES) {
      if ((a.y < y) === (b.y < y)) continue;
      const x = a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
      if (!inGap(x, y)) return false;
    }
  }
  return true;
}

test('같은 구역 안(벽을 안 건너는 이동)은 경유점이 없다', () => {
  assert.deepEqual(route({ x: 2, y: 1 }, { x: 15, y: 3 }), []);
  assert.deepEqual(route({ x: 1, y: 6 }, { x: 3, y: 8 }), []);
  assert.deepEqual(route({ x: 9, y: 10 }, { x: 18, y: 12 }), []);
});

test('문 틈으로 곧장 건너는 이동은 경유점이 없고, 벽 쪽으로 건너면 문을 거쳐 돌아간다', () => {
  const door = DOOR_LINES.find((l) => l.y === 5.2).doors[2];
  assert.deepEqual(route({ x: door, y: 3 }, { x: door, y: 7 }), []);
  const from = { x: 2, y: 3 };
  const to = { x: 3.2, y: 7 }; // 곧장 가면 문이 아닌 벽을 지난다
  const via = route(from, to);
  assert.ok(via.length >= 2);
  assert.ok(crossesOnlyThroughDoors(from, to, via));
});

test('여러 칸막이를 건너는 먼 이동(작업실 → 휴게실, 휴게실 → 입구)도 모두 문으로 지난다', () => {
  for (const [from, to] of [
    [{ x: 9.5, y: 2.0 }, { x: 10.2, y: 12.2 }], [{ x: 18, y: 12.4 }, { x: 20, y: 4.6 }], [{ x: 0.9, y: 10.5 }, { x: 19, y: 1 }],
    [{ x: 7.1, y: 6.6 }, { x: 3.0, y: 11.5 }], [{ x: 5.5, y: 3 }, { x: 18.5, y: 7.4 }], [{ x: 20, y: 4.6 }, { x: 2.5, y: 8.65 }],
  ]) {
    const via = route(from, to);
    assert.ok(crossesOnlyThroughDoors(from, to, via), JSON.stringify([from, to, via]));
    for (const p of via) assert.ok(p.x >= -0.01 && p.x <= 20.01 && p.y >= -0.01 && p.y <= 13.01);
  }
});

test('방마다 문이 하나씩 있고 방 안쪽 가장자리에서 떨어져 있다', () => {
  const m = DOOR_LINES.find((l) => l.y === 5.2);
  assert.equal(m.doors.length, 6);
  m.doors.forEach((d, i) => assert.ok(d - DOOR_W / 2 >= ROOMS[['server', 'data', 'lab', 'build', 'git', 'briefing'][i]].x - 1e-9));
  assert.equal(DOOR_LINES.find((l) => l.y === 9.4).doors.length, 2);
});

// ---- 검토자 회의: 검토를 끝낸 역할자는 기획실 낮은 탁자 둘레에 모인다
import { meetingSpot } from '../public/js/layout.js';

test('meetingSpot: 기획실 안, 탁자(17.3~19.2 × 1.0~1.7)를 피한 자리이고, 같은 팀 4자리는 서로 떨어져 있다', () => {
  for (let team = 0; team < 7; team++) {
    const spots = [0, 1, 2, 3].map((s) => meetingSpot(team, s));
    for (const p of spots) {
      assert.ok(inside(p, ROOMS.planning, 0.3), JSON.stringify(p));
      assert.ok(!(p.x > 17.3 && p.x < 19.2 && p.y > 1.0 && p.y < 1.7), `탁자 위 ${JSON.stringify(p)}`);
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(dist(spots[a], spots[b]) >= 0.6);
  }
  assert.deepEqual(meetingSpot(0, 5), meetingSpot(0, 1)); // 5번째 이상은 자리를 돌려 쓴다
  assert.throws(() => meetingSpot(9, 0), RangeError);
});

test('앉는 방의 자리는 가구(탁자)와 짝: 팀장 자리 = 의자 자리, 모든 자리는 탁자 쪽을 본다', () => {
  const dirTo = (from, to) => [Math.sin(Math.atan2(to.x - from.x, to.y - from.y)), Math.cos(Math.atan2(to.x - from.x, to.y - from.y))];
  researchSeats().forEach((seat, i) => {
    if (i < TEAMS.length) assert.deepEqual({ x: targetFor('read', i, 'research').x, y: targetFor('read', i, 'research').y }, { x: seat.x, y: seat.y });
    const [fx, fy] = dirTo(seat, seat.table);
    assert.ok(Math.abs(Math.sin(seat.face) - fx) < 1e-9 && Math.abs(Math.cos(seat.face) - fy) < 1e-9, `research ${i} 방향`);
  });
  assert.equal(researchSeats().length, RESEARCH_TABLES.length * 3);
  const mid = DOCS_TABLE.y + DOCS_TABLE.d / 2;
  docsSeats().forEach((seat, i) => {
    assert.equal(targetFor('read', i, 'docs').y, seat.y);
    assert.equal(Math.cos(seat.face) > 0, seat.y < mid, `docs ${i}: 탁자 쪽을 본다`); // 탁자보다 위(작은 y)에 앉으면 남쪽(+y)을 본다
  });
});

test('freeSpotFor: 비어 있는 자리 중 팀장 자리에서 가장 가까운 곳, 모두 차면 null', () => {
  assert.equal(freeSpotFor('docs', 0, new Set()), 0); // 팀장이 다른 곳에 있으면 자기 자리도 쓸 수 있다
  assert.equal(freeSpotFor('docs', 0, new Set([0])), 1);
  assert.equal(freeSpotFor('docs', 0, new Set([0, 1])), 2);
  assert.equal(freeSpotFor('docs', 0, new Set([0, 1, 2])), 3); // 같은 줄이 차면 건너편
  assert.equal(freeSpotFor('research', 0, new Set([0])), 2); // 같은 탁자에서 가장 가까운 의자(남쪽)
  assert.equal(freeSpotFor('lab', 2, new Set([0, 1, 2, 3, 4, 5, 6])), null);
  assert.throws(() => freeSpotFor('moon', 0, new Set()));
});

test('pickMemberSpot: 이번 스냅샷의 팀장 자리·다른 팀원 자리를 피하고, 비어 있으면 잡은 자리를 유지하며, 다른 방의 옛 예약은 무시한다', () => {
  const leaderRooms = ['docs', null, 'docs', 'lounge', null, null]; // 팀 0·2 의 팀장이 문서실
  assert.equal(pickMemberSpot('docs', 0, { leaderRooms }), 1); // 0·2 는 팀장 자리 → 가장 가까운 빈 자리 1
  assert.equal(pickMemberSpot('docs', 0, { leaderRooms, othersTaken: new Set([1]) }), 3); // 1 도 찼으면 건너편
  assert.equal(pickMemberSpot('docs', 0, { leaderRooms, current: { room: 'docs', idx: 4 } }), 4); // 비어 있는 잡은 자리는 유지
  assert.equal(pickMemberSpot('docs', 0, { leaderRooms, current: { room: 'docs', idx: 2 } }), 1); // 그 자리를 팀장이 차지했으면 새로 고른다
  assert.equal(pickMemberSpot('docs', 0, { leaderRooms, current: { room: 'research', idx: 4 } }), 1); // 다른 방의 옛 예약은 무시
  assert.equal(pickMemberSpot('lab', 1, { leaderRooms: ['lab', 'lab', 'lab', 'lab', 'lab', 'lab', 'lab'] }), null); // 모두 팀장 자리면 없음
});
