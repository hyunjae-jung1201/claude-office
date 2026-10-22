import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoles, rolesFor, validateRoleIds } from '../src/roles/loader.js';

function dir(files) {
  const d = mkdtempSync(join(tmpdir(), 'roles-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
  return d;
}
const role = (fm, body = '당신은 검토자다.') => `---\n${fm}\n---\n${body}\n`;

test('정상 파싱: 기본값을 채우고, 주석·따옴표·tools 목록을 처리한다', () => {
  const roles = loadRoles(dir({ 'sec.md': role('name: 보안  # 화면 이름\ncolor: "#e5484d"\ntools: [Read, "Grep"]') }));
  const r = roles.get('sec');
  assert.deepEqual(
    { id: r.id, name: r.name, color: r.color, model: r.model, when: r.when, tools: r.tools },
    { id: 'sec', name: '보안', color: '#e5484d', model: 'sonnet', when: 'always', tools: ['Read', 'Grep'] },
  );
  assert.equal(r.prompt, '당신은 검토자다.');
  assert.deepEqual(loadRoles(dir({ 'a.md': role('name: A') })).get('a').tools, ['Read', 'Grep', 'Glob']);
});

test('tools에 읽기 전용이 아닌 도구가 있으면 거부한다', () => {
  assert.throws(() => loadRoles(dir({ 'x.md': role('name: X\ntools: [Read, Bash]') })), /x.*Bash/);
  assert.throws(() => loadRoles(dir({ 'x.md': role('name: X\ntools: [Edit]') })), /Edit/);
  assert.throws(() => loadRoles(dir({ 'x.md': role('name: X\ntools: ["Bash(git diff:*)"]') })), /Bash/);
});

test('알 수 없는 키, name 없음, when/color 오류, 너무 긴 프롬프트, frontmatter 없음은 거부', () => {
  assert.throws(() => loadRoles(dir({ 'x.md': role('name: X\nfoo: bar') })), /x.*foo/);
  assert.throws(() => loadRoles(dir({ 'x.md': role('color: "#aabbcc"') })), /x.*name/);
  assert.throws(() => loadRoles(dir({ 'x.md': role('name: X\nwhen: never') })), /when/);
  assert.throws(() => loadRoles(dir({ 'x.md': role('name: X\ncolor: red') })), /color/);
  assert.throws(() => loadRoles(dir({ 'x.md': role('name: X', 'a'.repeat(21 * 1024)) })), /20KB|길/);
  assert.throws(() => loadRoles(dir({ 'x.md': '그냥 문서' })), /frontmatter|머리/);
  assert.throws(() => loadRoles(dir({ 'Bad Name.md': role('name: X') })), /id/);
});

test('md가 아닌 파일은 무시하고, 폴더가 없으면 빈 목록', () => {
  assert.equal(loadRoles(dir({ 'notes.txt': 'x', 'a.md': role('name: A') })).size, 1);
  assert.equal(loadRoles(join(tmpdir(), 'no-roles-dir-xyz')).size, 0);
});

test('저장소의 roles/ 9개가 모두 로드된다', () => {
  const roles = loadRoles(fileURLToPath(new URL('../roles', import.meta.url)));
  assert.deepEqual([...roles.keys()].sort(), ['accessibility', 'architect', 'copy', 'database', 'dependency', 'developer', 'devops', 'docs', 'embedded', 'mlreview', 'performance', 'pm', 'qa', 'release', 'security', 'ux']);
  assert.deepEqual(['pm', 'developer', 'qa', 'security', 'docs', 'performance', 'accessibility', 'embedded', 'copy'].map((id) => roles.get(id).when), ['always', 'code', 'always', 'code', 'docs', 'code', 'ui', 'code', 'docs']);
  for (const r of roles.values()) {
    assert.match(r.color, /^#[0-9a-f]{6}$/i);
    assert.ok(r.prompt.length > 30, r.id);
    assert.deepEqual(r.tools, ['Read', 'Grep', 'Glob']);
  }
});

const cfg = (roles = {}, projects = []) => ({
  roles: { default: ['pm', 'developer', 'qa'], projects: {}, ...roles },
  projects,
});

test('rolesFor: 팀 항목 → roles.projects 가장 긴 경로 → 기본', () => {
  const c = cfg({ projects: { '/a': { roles: ['pm'] }, '/a/b': { roles: ['qa'] } } }, [{ name: 'T', path: '/a/b/c', roles: ['docs'] }]);
  assert.deepEqual(rolesFor(c, '/a/b/c', 'T'), ['docs']);
  assert.deepEqual(rolesFor(c, '/a/b/x'), ['qa']);
  assert.deepEqual(rolesFor(c, '/a/z'), ['pm']);
  assert.deepEqual(rolesFor(c, '/ab'), ['pm', 'developer', 'qa']); // /a 와 /ab 는 다른 경로
  assert.deepEqual(rolesFor(c, '/other'), ['pm', 'developer', 'qa']);
  assert.deepEqual(rolesFor(c, '/a/b/x', 'NoSuchTeam'), ['qa']);
});

test('validateRoleIds: 전역·roles.projects·팀 항목의 알 수 없는 id를 모두 잡는다', () => {
  const known = new Map([['pm', {}], ['qa', {}]]);
  assert.doesNotThrow(() => validateRoleIds(cfg({ default: ['pm', 'qa'] }), known));
  assert.throws(() => validateRoleIds(cfg({ default: ['pm', 'ghost'] }), known), /ghost/);
  assert.throws(() => validateRoleIds(cfg({ default: ['pm'], projects: { '/a': { roles: ['nope'] } } }), known), /nope/);
  assert.throws(() => validateRoleIds(cfg({ default: ['pm'] }, [{ name: 'T', path: '/t', roles: ['zzz'] }]), known), /zzz/);
});

test('when: ui 를 받아들이고, 동봉된 역할 파일이 모두 읽힌다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roles-ui-'));
  writeFileSync(join(dir, 'a11y.md'), '---\nname: 접근성\nwhen: ui\n---\n프롬프트');
  assert.equal(loadRoles(dir).get('a11y').when, 'ui');
  const shipped = loadRoles(new URL('../roles/', import.meta.url).pathname);
  for (const id of ['pm', 'developer', 'qa', 'security', 'docs', 'performance', 'accessibility', 'embedded', 'copy', 'architect', 'database', 'devops', 'ux', 'dependency', 'release', 'mlreview']) assert.ok(shipped.has(id), id);
});
