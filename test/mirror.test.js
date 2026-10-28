import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMirror } from '../src/mirror.js';

const local = { projects: [
  { name: '팅크웨어', path: '/home/u/projects/tw', color: '#d9822b', testCommand: ['npm', 'test'], roles: ['pm'] },
  { name: 'Office 봇', path: '/home/u/projects/office', color: '#e5b83a', aliases: ['Claude 작업 상태'] },
  { name: '사고 판별', path: '/home/u/accident', host: 'PC2', color: '#6c63d9' },
] };
const remote = { port: 9410, projects: [{ name: '사고 판별', path: '/home/u/accident', color: '#6c63d9' }, { name: '옛 팀', path: '/x', host: 'PC1' }], roles: { enabled: false } };

test('이 PC 의 팀(host 없는 것)을 host 이름을 붙여 원격 설정에 맞춘다: 옛 미러 팀은 교체하고 원격 자체 팀은 보존', () => {
  const out = mergeMirror(remote, local, 'PC1');
  assert.deepEqual(out.projects.map((p) => [p.name, p.host ?? null]), [['사고 판별', null], ['팅크웨어', 'PC1'], ['Office 봇', 'PC1']]);
  assert.deepEqual(out.remotes, [{ name: 'PC1', push: true }]);
  assert.equal(out.roles.enabled, false); // 원격의 다른 설정은 그대로
});

test('원격 화면에 필요한 값(name·path·color·aliases)만 옮기고 검토·테스트 설정은 옮기지 않는다', () => {
  const tw = mergeMirror(remote, local, 'PC1').projects.find((p) => p.name === '팅크웨어');
  assert.deepEqual(Object.keys(tw).sort(), ['color', 'host', 'name', 'path']);
  assert.deepEqual(mergeMirror(remote, local, 'PC1').projects.find((p) => p.name === 'Office 봇').aliases, ['Claude 작업 상태']);
});

test('이미 push 원격이 있으면 중복 없이 두고, 같은 입력을 두 번 합쳐도 결과가 같다(멱등)', () => {
  const once = mergeMirror(remote, local, 'PC1');
  assert.deepEqual(mergeMirror(once, local, 'PC1'), once);
  assert.equal(once.remotes.length, 1);
});

test('합친 팀이 7개를 넘으면 오류(어느 팀이 넘는지 알려 준다)', () => {
  const many = { projects: Array.from({ length: 7 }, (_, i) => ({ name: `T${i}`, path: `/p/${i}` })) };
  assert.throws(() => mergeMirror(remote, many, 'PC1'), /7개|넘/);
});

test('이름이 원격의 자체 팀과 같으면 거절한다(화면에 같은 이름이 두 개 생기지 않게)', () => {
  const clash = { projects: [{ name: '사고 판별', path: '/other' }] };
  assert.throws(() => mergeMirror(remote, clash, 'PC1'), /사고 판별/);
});

test('mergeMirror: Codex 같은 AI 도구 팀은 다른 PC 로 미러하지 않는다', () => {
  const out = mergeMirror({ projects: [{ name: 'R', path: '/r' }] }, { projects: [{ name: 'A', path: '/a' }, { name: 'Codex', path: 'ai:codex', ai: 'codex' }] }, 'PC1');
  assert.deepEqual(out.projects.map((p) => p.name), ['R', 'A']);
});
