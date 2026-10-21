import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, FLOOR, targetFor, memberSeat, deskZone } from '../public/js/layout.js';

const STATUSES = ['read', 'write', 'run', 'wait', 'idle', 'off'];
const TEAMS = [0, 1, 2, 3, 4];
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.d;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;

test('방 영역은 바닥 안에 있다', () => {
  for (const r of Object.values(ROOMS)) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= FLOOR.w && r.y + r.d <= FLOOR.d);
  }
});

test('상태별 목표는 해당 방 안에 있다 (6상태 × 5팀)', () => {
  const room = { read: ROOMS.library, run: ROOMS.server, wait: ROOMS.meeting, idle: ROOMS.hall, off: ROOMS.lounge };
  for (const t of TEAMS) {
    for (const s of STATUSES) {
      const p = targetFor(s, t);
      assert.ok(inside(p, s === 'write' ? deskZone(t) : room[s]), `${s}/${t} ${JSON.stringify(p)}`);
    }
    assert.ok(inside(targetFor('write', t), ROOMS.work));
  }
});

test('포즈: write=type, off=sleep, 나머지=stand', () => {
  for (const t of TEAMS) {
    assert.equal(targetFor('write', t).pose, 'type');
    assert.equal(targetFor('off', t).pose, 'sleep');
    for (const s of ['read', 'run', 'wait', 'idle']) assert.equal(targetFor(s, t).pose, 'stand');
  }
});

test('같은 입력은 같은 좌표를 돌려준다', () => {
  assert.deepEqual(targetFor('run', 3), targetFor('run', 3));
  assert.deepEqual(memberSeat(2, 1), memberSeat(2, 1));
});

test('같은 상태에서 팀끼리 자리가 겹치지 않는다 (off는 휴게실 소파에 서로 다른 자리)', () => {
  for (const s of STATUSES) {
    for (const a of TEAMS) for (const b of TEAMS) {
      if (a < b) assert.ok(dist(targetFor(s, a), targetFor(s, b)) >= 0.6, `${s} ${a}/${b}`);
    }
  }
});

test('책상 구역은 작업실 안에 있고 서로 겹치지 않는다', () => {
  for (const a of TEAMS) {
    assert.ok(inside({ x: deskZone(a).x, y: deskZone(a).y }, ROOMS.work));
    assert.ok(inside({ x: deskZone(a).x + deskZone(a).w, y: deskZone(a).y + deskZone(a).d }, ROOMS.work));
    for (const b of TEAMS) if (a < b) assert.ok(!overlap(deskZone(a), deskZone(b)), `${a}/${b}`);
  }
});

test('팀원 4명의 자리는 팀 책상 구역 안이고 서로, 팀장석과도 다르다', () => {
  const all = [];
  for (const t of TEAMS) {
    const seats = [0, 1, 2, 3].map((m) => memberSeat(t, m));
    for (const s of seats) {
      assert.ok(inside(s, deskZone(t)), `team ${t}`);
      assert.ok(dist(s, targetFor('write', t)) >= 0.5);
      all.push(s);
    }
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(dist(all[i], all[j]) >= 0.5, `${i}/${j}`);
});

test('잘못된 입력은 오류', () => {
  assert.throws(() => targetFor('dancing', 0));
  assert.throws(() => targetFor('run', 5), RangeError);
  assert.throws(() => memberSeat(0, 4), RangeError);
});
