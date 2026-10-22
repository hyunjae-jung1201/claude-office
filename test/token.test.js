import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateToken, readToken, tokenMatches } from '../src/token.js';

test('토큰 파일이 없으면 0600 으로 만들고, 다시 불러오면 같은 값이다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-token-'));
  const p = join(dir, 'sub', 'token');
  assert.equal(readToken(p), null);
  const t = loadOrCreateToken(p);
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'sub')).mode & 0o777, 0o700);
  assert.equal(loadOrCreateToken(p), t);
  assert.equal(readToken(p), readFileSync(p, 'utf8').trim());
});

test('tokenMatches: 같을 때만 참, 길이가 달라도 던지지 않는다', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abc', 'abd'), false);
  assert.equal(tokenMatches('abc', 'abcd'), false);
  assert.equal(tokenMatches('abc', undefined), false);
  assert.equal(tokenMatches('abc', ['abc']), false);
});
