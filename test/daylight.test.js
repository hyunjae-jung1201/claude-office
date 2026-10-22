import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayState, hourKST } from '../public/js/daylight.js';

const HEX = /^#[0-9a-f]{6}$/;

test('hourKST: UTC 시각에 9시간을 더한 한국 시간(소수 시)', () => {
  assert.equal(hourKST(new Date('2026-10-22T00:00:00Z')), 9);
  assert.equal(hourKST(new Date('2026-10-22T15:30:00Z')), 0.5); // 자정 넘김
  assert.equal(hourKST(new Date('2026-10-22T08:45:00Z')), 17.75);
});

test('낮 / 노을 / 밤의 해·조명·별이 상식에 맞게 달라진다', () => {
  const noon = dayState(12);
  const golden = dayState(18.2);
  const night = dayState(23);
  assert.ok(noon.sun.intensity > golden.sun.intensity && golden.sun.intensity > night.sun.intensity);
  assert.ok(night.lamps > noon.lamps); // 밤엔 실내 조명이 더 중요
  assert.ok(night.stars > 0.7 && noon.stars === 0);
  assert.ok(night.litWindows > noon.litWindows); // 건물 창문 불빛
  assert.ok(night.exposure <= 1.2 && noon.exposure >= 0.9);
});

test('모든 값이 유효하고, 시간이 자정을 넘나들어도(24→0) 끊기지 않는다', () => {
  for (let h = 0; h < 24.01; h += 0.25) {
    const d = dayState(h);
    for (const c of [d.sky.top, d.sky.mid, d.sky.low, d.sun.color, d.hemi.sky, d.hemi.ground]) assert.match(c, HEX, `${h}`);
    for (const n of [d.sun.intensity, d.hemi.intensity, d.lamps, d.stars, d.litWindows, d.exposure]) assert.ok(Number.isFinite(n) && n >= 0, `${h}`);
  }
  const a = dayState(23.99);
  const b = dayState(0.01);
  assert.ok(Math.abs(a.sun.intensity - b.sun.intensity) < 0.05);
  assert.deepEqual(dayState(24).sky, dayState(0).sky);
  assert.deepEqual(dayState(-1).sky, dayState(23).sky);
});

test('시간이 흐르면 값이 연속적으로 변한다(두 정각 사이 보간)', () => {
  const a = dayState(17.5).sun.intensity;
  const b = dayState(18).sun.intensity;
  const c = dayState(18.5).sun.intensity;
  assert.ok(a >= b && b >= c);
  assert.ok(a - c > 0.02);
});
