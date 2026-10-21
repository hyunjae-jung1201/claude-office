import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets } from '../src/mask.js';

const gone = (input, secret) => {
  const out = maskSecrets(input);
  assert.ok(!out.includes(secret), `남아 있음: ${out}`);
  return out;
};

test('sk- 키를 가린다', () => gone('export KEY=sk-abcdefghijklmnopqrstuvwx1234', 'sk-abcdefghijklmnopqrstuvwx1234'));
test('GitHub 토큰을 가린다', () => gone('git push https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
test('AWS 키를 가린다', () => gone('AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'));
test('Bearer 토큰이 원문에 남지 않는다', () =>
  gone('curl -H "Authorization: Bearer abc123def456ghi789jkl" x', 'abc123def456ghi789jkl'));
test('password= 값을 가린다', () => {
  const out = gone('mysql --password=hunter2hunter2', 'hunter2hunter2');
  assert.match(out, /password=\*\*\*/);
});
test('token / api_key 값을 가린다', () => {
  gone('token=abcd1234efgh', 'abcd1234efgh');
  gone('api_key: "zzzz9999yyyy"', 'zzzz9999yyyy');
});
test('길이 20 이상의 긴 해시 덩어리를 가린다', () =>
  gone('echo 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'));
test('.env 와 키 파일 경로는 "설정 파일"로 바뀐다', () => {
  assert.equal(maskSecrets('cat .env'), 'cat 설정 파일');
  assert.ok(maskSecrets('cat ~/.ssh/id_rsa').includes('설정 파일'));
  assert.ok(!maskSecrets('openssl x509 -in server.pem').includes('server.pem'));
  assert.ok(!maskSecrets('cat credentials.json').includes('credentials'));
});
test('일반 문장은 그대로 둔다', () => {
  assert.equal(maskSecrets('npm run build 후 테스트 실행'), 'npm run build 후 테스트 실행');
  assert.equal(maskSecrets('/work/a/src/server.js'), '/work/a/src/server.js');
});
