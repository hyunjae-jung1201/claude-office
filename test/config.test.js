import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, matchProject } from '../src/config.js';

function cfgFile(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'office-cfg-'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
const P = (name, path) => ({ name, path, color: '#e8637a' });

test('기본값을 채운다', () => {
  const c = loadConfig(cfgFile({ projects: [P('A', '/work/a')] }));
  assert.equal(c.port, 7410);
  assert.equal(c.offAfterMinutes, 10);
  assert.equal(c.maxMembers, 4);
  assert.equal(c.celebrateAfterSeconds, 30);
});

test('6번째 프로젝트는 Error', () => {
  const projects = Array.from({ length: 6 }, (_, i) => P(`P${i}`, `/work/p${i}`));
  assert.throws(() => loadConfig(cfgFile({ projects })), /5/);
});

test('이름이나 경로가 중복이면 Error', () => {
  assert.throws(() => loadConfig(cfgFile({ projects: [P('A', '/w/a'), P('A', '/w/b')] })), /중복/);
  assert.throws(() => loadConfig(cfgFile({ projects: [P('A', '/w/a'), P('B', '/w/a/')] })), /중복/);
});

test('name 또는 path가 없으면 Error', () => {
  assert.throws(() => loadConfig(cfgFile({ projects: [{ name: 'A' }] })), /path/);
});

test('정확히 같은 폴더와 하위 폴더는 매칭된다', () => {
  const c = loadConfig(cfgFile({ projects: [P('A', '/work/a')] }));
  assert.equal(matchProject(c, '/work/a').name, 'A');
  assert.equal(matchProject(c, '/work/a/sub/deep').name, 'A');
});

test('/a/b 는 /a/bc 와 매칭되지 않는다 (경로 경계)', () => {
  const c = loadConfig(cfgFile({ projects: [P('B', '/a/b')] }));
  assert.equal(matchProject(c, '/a/bc'), null);
  assert.equal(matchProject(c, '/a/b'), c.projects[0]);
});

test('지정하지 않은 폴더(홈 포함)는 null', () => {
  const c = loadConfig(cfgFile({ projects: [P('A', '/work/a')] }));
  assert.equal(matchProject(c, '/home/hyeanjae'), null);
  assert.equal(matchProject(c, '/'), null);
});

test('접두사가 겹치면 가장 긴 경로의 프로젝트가 이긴다', () => {
  const c = loadConfig(cfgFile({ projects: [P('Outer', '/work'), P('Inner', '/work/inner')] }));
  assert.equal(matchProject(c, '/work/inner/x').name, 'Inner');
  assert.equal(matchProject(c, '/work/other').name, 'Outer');
});

test('경로 끝 슬래시는 무시된다', () => {
  const c = loadConfig(cfgFile({ projects: [P('A', '/work/a/')] }));
  assert.equal(matchProject(c, '/work/a/x').name, 'A');
});
