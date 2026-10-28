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

test('8번째 프로젝트는 Error', () => {
  const projects = Array.from({ length: 8 }, (_, i) => P(`P${i}`, `/work/p${i}`));
  assert.throws(() => loadConfig(cfgFile({ projects })), /7/);
  assert.equal(loadConfig(cfgFile({ projects: projects.slice(0, 7) })).projects.length, 7);
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

test('addProject: 8번째와 중복은 거절하고 파일을 바꾸지 않는다', () => {
  const projects = Array.from({ length: 7 }, (_, i) => P(`P${i}`, `/work/p${i}`));
  const file = cfgFile({ projects });
  const before = readJson(file, 'utf8');
  assert.throws(() => addProject(file, '/work/eighth'), /7/);
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

// ---- 원격 PC
const REMOTE = { name: 'PC2', ssh: 'me@192.168.0.20', key: '~/.ssh/k' };
const PH = (name, path) => ({ name, path, host: 'PC2' });

test('remotes: 이름·ssh가 필요하고, 프로젝트의 host는 정의된 remote여야 한다', () => {
  assert.throws(() => loadConfig(cfgFile({ remotes: [{ name: 'PC2' }], projects: [] })), /ssh/);
  assert.throws(() => loadConfig(cfgFile({ projects: [PH('R', '/r')] })), /PC2/);
  const c = loadConfig(cfgFile({ remotes: [REMOTE], projects: [PH('R', '/r')] }));
  assert.equal(c.remotes[0].name, 'PC2');
  assert.deepEqual(loadConfig(cfgFile({ projects: [] })).remotes, []);
});

test('같은 경로라도 host가 다르면 다른 팀이고, 이름은 전체에서 유일해야 한다', () => {
  const c = loadConfig(cfgFile({ remotes: [REMOTE], projects: [P('Local', '/work/a'), PH('Remote', '/work/a')] }));
  assert.equal(matchProject(c, '/work/a/x').name, 'Local');
  assert.equal(matchProject(c, '/work/a/x', 'PC2').name, 'Remote');
  assert.equal(matchProject(c, '/work/a/x', 'other'), null);
  assert.throws(() => loadConfig(cfgFile({ remotes: [REMOTE], projects: [P('X', '/a'), PH('X', '/b')] })), /중복/);
  assert.throws(() => loadConfig(cfgFile({ remotes: [REMOTE], projects: [PH('A', '/r'), PH('B', '/r/')] })), /중복/);
});

// ---- 세션 이름(aliases)으로도 팀을 찾는다 (세션이 모두 홈 폴더에서 열려 있어도 이름으로 구분)
test('aliases: cwd가 지정되지 않은 폴더여도 세션 이름이 별칭과 같으면 그 팀', () => {
  const c = loadConfig(cfgFile({ projects: [{ name: 'Standup', path: '/w/standup', aliases: ['standup 봇'] }, P('B', '/w/b')] }));
  assert.equal(matchProject(c, '/home/me', null, 'standup 봇').name, 'Standup');
  assert.equal(matchProject(c, '/home/me', null, 'STANDUP 봇').name, 'Standup'); // 대소문자 무시
  assert.equal(matchProject(c, '/home/me', null, '다른 이름'), null);
  assert.equal(matchProject(c, '/home/me'), null);
});

test('aliases: 폴더가 맞으면 폴더가 우선이고, 팀 이름 자체도 별칭으로 쓰인다', () => {
  const c = loadConfig(cfgFile({ projects: [{ name: 'Standup', path: '/w/standup', aliases: ['x'] }, P('B', '/w/b')] }));
  assert.equal(matchProject(c, '/w/b/sub', null, 'x').name, 'B');
  assert.equal(matchProject(c, '/home/me', null, 'B').name, 'B');
});

test('aliases: 다른 host의 프로젝트와는 섞이지 않고, 중복 별칭은 거절', () => {
  const rc = { remotes: [{ name: 'PC2', ssh: 'a@b' }] };
  const c = loadConfig(cfgFile({ ...rc, projects: [P('L', '/l'), { name: 'R', path: '/r', host: 'PC2', aliases: ['공용'] }] }));
  assert.equal(matchProject(c, '/home', null, '공용'), null);
  assert.equal(matchProject(c, '/home', 'PC2', '공용').name, 'R');
  assert.throws(() => loadConfig(cfgFile({ projects: [{ name: 'A', path: '/a', aliases: ['z'] }, { name: 'B', path: '/b', aliases: ['Z'] }] })), /별칭|중복/);
});

// ---- roles 설정
test('roles 기본값', () => {
  const c = loadConfig(cfgFile({ projects: [] }));
  assert.deepEqual(c.roles, { enabled: true, default: ['pm', 'developer', 'qa'], cooldownMinutes: 5, minWrites: 1, dailyLimit: 120, deliver: 'report', deliverMinSeverity: 'major', excludePaths: [], projects: {} });
});

test('roles: 값을 덮어쓸 수 있고, 형식 오류·deliver 값은 거부한다', () => {
  const c = loadConfig(cfgFile({ roles: { cooldownMinutes: 10, default: ['pm'], projects: { '/r': { roles: ['qa'], minWrites: 3 } } }, projects: [] }));
  assert.equal(c.roles.cooldownMinutes, 10);
  assert.equal(c.roles.dailyLimit, 120);
  assert.deepEqual(c.roles.projects['/r'], { roles: ['qa'], minWrites: 3 });
  assert.throws(() => loadConfig(cfgFile({ roles: { deliver: 'email' }, projects: [] })), /deliver/);
  assert.throws(() => loadConfig(cfgFile({ roles: { default: 'pm' }, projects: [] })), /default/);
  assert.throws(() => loadConfig(cfgFile({ roles: { cooldownMinutes: -1 }, projects: [] })), /cooldownMinutes/);
  assert.throws(() => loadConfig(cfgFile({ roles: { projects: { '/r': { roles: 'qa' } } }, projects: [] })), /roles/);
});

test('팀 항목의 roles는 목록이어야 하고 보존된다', () => {
  const c = loadConfig(cfgFile({ projects: [{ name: 'A', path: '/a', roles: ['pm', 'qa'] }] }));
  assert.deepEqual(c.projects[0].roles, ['pm', 'qa']);
  assert.throws(() => loadConfig(cfgFile({ projects: [{ name: 'A', path: '/a', roles: 'pm' }] })), /roles/);
});

test('roles.excludePaths: 기본은 빈 목록, 문자열 목록이어야 한다', () => {
  assert.deepEqual(loadConfig(cfgFile({ projects: [] })).roles.excludePaths, []);
  assert.deepEqual(loadConfig(cfgFile({ roles: { excludePaths: ['/secret/repo'] }, projects: [] })).roles.excludePaths, ['/secret/repo']);
  assert.throws(() => loadConfig(cfgFile({ roles: { excludePaths: '/x' }, projects: [] })), /excludePaths/);
});

test('responseWaitMinutes: 기본 5, 0 이상의 숫자여야 한다', () => {
  assert.equal(loadConfig(cfgFile({ projects: [] })).responseWaitMinutes, 5);
  assert.equal(loadConfig(cfgFile({ responseWaitMinutes: 0.5, projects: [] })).responseWaitMinutes, 0.5);
  assert.throws(() => loadConfig(cfgFile({ responseWaitMinutes: -1, projects: [] })), /responseWaitMinutes/);
  assert.throws(() => loadConfig(cfgFile({ responseWaitMinutes: 'x', projects: [] })), /responseWaitMinutes/);
});

test('roles.deliver: session 을 받아들이고 deliverMinSeverity 를 검증한다', () => {
  const c = loadConfig(cfgFile({ roles: { deliver: 'session', deliverMinSeverity: 'minor' }, projects: [] }));
  assert.deepEqual([c.roles.deliver, c.roles.deliverMinSeverity], ['session', 'minor']);
  assert.throws(() => loadConfig(cfgFile({ roles: { deliverMinSeverity: 'info' }, projects: [] })), /deliverMinSeverity/);
});

test('remotes[].review: 불리언만 받고, 기본은 끔', () => {
  const base = { projects: [] };
  const a = loadConfig(cfgFile({ ...base, remotes: [{ name: 'PC2', ssh: 'u@h' }, { name: 'PC3', ssh: 'u@h3', review: true }] }));
  assert.deepEqual(a.remotes.map((r) => r.review), [false, true]);
  assert.throws(() => loadConfig(cfgFile({ ...base, remotes: [{ name: 'PC2', ssh: 'u@h', review: 'yes' }] })), /review/);
});

test('projects[].testCommand / testTimeoutSeconds: 문자열 배열과 범위만 받는다', () => {
  const ok = loadConfig(cfgFile({ projects: [{ name: 'A', path: '/a', testCommand: ['npm', 'test'], testTimeoutSeconds: 300 }] }));
  assert.deepEqual([ok.projects[0].testCommand, ok.projects[0].testTimeoutSeconds], [['npm', 'test'], 300]);
  assert.equal(loadConfig(cfgFile({ projects: [{ name: 'A', path: '/a' }] })).projects[0].testCommand, undefined);
  for (const bad of ['npm test', [], ['npm', ''], [1]]) assert.throws(() => loadConfig(cfgFile({ projects: [{ name: 'A', path: '/a', testCommand: bad }] })), /testCommand/);
  for (const bad of [1, 99999, 'x']) assert.throws(() => loadConfig(cfgFile({ projects: [{ name: 'A', path: '/a', testCommand: ['npm', 'test'], testTimeoutSeconds: bad }] })), /testTimeoutSeconds/);
});

test('dailyLog: 절대 경로 dir 과 주기(초)를 검증하고, 없으면 꺼짐', () => {
  assert.equal(loadConfig(cfgFile({ projects: [] })).dailyLog, undefined);
  const c = loadConfig(cfgFile({ projects: [], dailyLog: { dir: '/mnt/c/logs' } }));
  assert.deepEqual(c.dailyLog, { dir: '/mnt/c/logs', intervalSeconds: 120 });
  assert.equal(loadConfig(cfgFile({ projects: [], dailyLog: { dir: '/x', intervalSeconds: 30 } })).dailyLog.intervalSeconds, 30);
  for (const bad of ['/x', { dir: 'relative' }, { dir: '/x', intervalSeconds: 1 }, { dir: '/x', intervalSeconds: 'a' }, { }]) assert.throws(() => loadConfig(cfgFile({ projects: [], dailyLog: bad })), /dailyLog/);
});

test('remotes[].push: 다른 PC 가 밀어 넣는 원격은 ssh 없이도 받고, ssh 도 push 도 없으면 거부', () => {
  const c = loadConfig(cfgFile({ projects: [{ name: 'T', path: '/t', host: 'PC1' }], remotes: [{ name: 'PC1', push: true }] }));
  assert.deepEqual([c.remotes[0].push, c.remotes[0].ssh], [true, undefined]);
  assert.equal(loadConfig(cfgFile({ projects: [], remotes: [{ name: 'PC2', ssh: 'u@h' }] })).remotes[0].push, false);
  assert.throws(() => loadConfig(cfgFile({ projects: [], remotes: [{ name: 'PC9' }] })), /ssh|push/);
  assert.throws(() => loadConfig(cfgFile({ projects: [], remotes: [{ name: 'PC9', push: 'yes' }] })), /push/);
});

test('projects[].ai: 다른 AI 도구 전용 팀은 path 없이 만들 수 있고, 그 도구의 신호는 폴더와 상관없이 이 팀으로 간다', () => {
  const load = (projects) => {
    const dir = mkdtempSync(join(tmpdir(), 'co-cfg-'));
    const f = join(dir, 'config.json');
    writeFileSync(f, JSON.stringify({ projects }));
    return loadConfig(f);
  };
  const config = load([{ name: 'A', path: '/w/a' }, { name: 'Codex', ai: 'codex', color: '#8fdcae' }]);
  assert.deepEqual([config.projects[1].ai, config.projects[1].path], ['codex', 'ai:codex']);
  assert.equal(matchProject(config, '/w/a/src', null, undefined, 'codex').name, 'Codex'); // ai 신호는 폴더와 상관없이
  assert.equal(matchProject(config, '/w/a/src').name, 'A'); // 일반 신호는 폴더로
  assert.equal(matchProject(config, '/anything', null, undefined, 'codex').name, 'Codex');
  assert.equal(matchProject(load([{ name: 'A', path: '/w/a' }]), '/w/a', null, undefined, 'codex').name, 'A'); // ai 팀이 없으면 폴더 팀의 외계인 팀원
  assert.throws(() => load([{ name: 'X', ai: 'nope' }]), /ai는/);
  assert.throws(() => load([{ name: 'X' }]), /path/);
});

test('ai 팀은 PC 마다 따로 있다: 이 PC 신호는 이 PC 의 팀, 다른 PC 신호는 그 PC 의 팀으로 간다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-cfg-'));
  const f = join(dir, 'config.json');
  writeFileSync(f, JSON.stringify({ remotes: [{ name: 'PC1', push: true }], projects: [{ name: 'Codex', ai: 'codex' }, { name: 'Codex(PC1)', ai: 'codex', host: 'PC1' }] }));
  const config = loadConfig(f);
  assert.equal(matchProject(config, '/x', null, undefined, 'codex').name, 'Codex');
  assert.equal(matchProject(config, '/x', 'PC1', undefined, 'codex').name, 'Codex(PC1)');
});

test('같은 PC 에 같은 AI 도구의 팀은 하나만 둘 수 있다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-cfg-'));
  const f = join(dir, 'config.json');
  writeFileSync(f, JSON.stringify({ projects: [{ name: 'Codex', ai: 'codex' }, { name: 'Codex2', ai: 'codex' }] }));
  assert.throws(() => loadConfig(f), /중복|PC 마다 도구당 하나/); // 같은 가짜 경로(ai:codex)라 중복으로 먼저 걸린다
});
