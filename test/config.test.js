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
  assert.equal(c.port, 9410);
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

// ---- /office add
import { addProject } from '../src/config.js';
import { readFileSync as readJson } from 'node:fs';

test('addProject: 폴더를 추가하고 이름은 폴더 이름, 색은 다음 팔레트 색', () => {
  const file = cfgFile({ projects: [P('A', '/work/a')] });
  const p = addProject(file, '/work/new-proj');
  assert.equal(p.name, 'new-proj');
  assert.equal(p.path, '/work/new-proj');
  assert.match(p.color, /^#[0-9a-f]{6}$/i);
  const saved = JSON.parse(readJson(file, 'utf8'));
  assert.deepEqual(saved.projects.map((x) => x.name), ['A', 'new-proj']);
});

test('addProject: 이름을 직접 줄 수 있고, 다른 설정은 유지된다', () => {
  const file = cfgFile({ port: 7777, projects: [] });
  addProject(file, '/work/x', '내 프로젝트');
  const saved = JSON.parse(readJson(file, 'utf8'));
  assert.equal(saved.port, 7777);
  assert.equal(saved.projects[0].name, '내 프로젝트');
});

test('addProject: 6번째와 중복은 거절하고 파일을 바꾸지 않는다', () => {
  const projects = Array.from({ length: 5 }, (_, i) => P(`P${i}`, `/work/p${i}`));
  const file = cfgFile({ projects });
  const before = readJson(file, 'utf8');
  assert.throws(() => addProject(file, '/work/sixth'), /5/);
  assert.equal(readJson(file, 'utf8'), before);
  const file2 = cfgFile({ projects: [P('A', '/work/a')] });
  assert.throws(() => addProject(file2, '/work/a/'), /중복/);
});

// ---- 최종 검토: 화면은 팀원 4명까지만 배치할 수 있다
test('maxMembers는 1~4만 허용한다', () => {
  assert.throws(() => loadConfig(cfgFile({ maxMembers: 5, projects: [] })), /maxMembers/);
  assert.throws(() => loadConfig(cfgFile({ maxMembers: 0, projects: [] })), /maxMembers/);
  assert.equal(loadConfig(cfgFile({ maxMembers: 2, projects: [] })).maxMembers, 2);
});
