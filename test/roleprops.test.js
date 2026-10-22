import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { propsFor, ROLE_PROPS } from '../public/js/roleprops.js';

const ROLES_DIR = new URL('../roles/', import.meta.url);

test('동봉된 역할(roles/*.md)과 작업 아바타(tests·recorder)는 모두 소품이 있다', () => {
  const ids = readdirSync(ROLES_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  assert.ok(ids.length >= 9);
  for (const id of [...ids, 'tests', 'recorder']) assert.ok(propsFor(id).length > 0, `${id} 에 소품이 없다`);
});

test('역할마다 소품 조합이 달라 구분된다(같은 조합이 둘 이상이면 안 됨)', () => {
  const seen = new Map();
  for (const [id, props] of Object.entries(ROLE_PROPS)) {
    const key = [...props].sort().join('+');
    assert.ok(!seen.has(key), `${id} 와 ${seen.get(key)} 의 소품이 같다`);
    seen.set(key, id);
  }
});

test('모르는 역할·이상한 값은 소품 없음(예외 없음)', () => {
  for (const v of ['nope', '', undefined, null, 5, '__proto__', 'constructor', 'toString']) assert.deepEqual(propsFor(v), []);
});
