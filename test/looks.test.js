import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAIR, SKIN, variantFor } from '../public/js/looks.js';

test('variantFor: 팀장은 팀 번호, 역할자는 role:<id> 글자 합(3D 아바타와 목록 얼굴이 같은 사람)', () => {
  assert.equal(variantFor({ team: 3, kind: 'team' }), 3);
  const sum = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
  assert.equal(variantFor({ team: 0, kind: 'role', id: 'pm' }), sum('role:pm'));
  assert.equal(variantFor({ team: 0, kind: 'member', id: 'agent1' }), sum('agent1'));
  assert.equal(HAIR.length, 6);
  assert.equal(SKIN.length, 6);
});
