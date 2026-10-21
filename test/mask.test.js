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

// ---- 보안 리뷰 반영: 접두사 있는 키 이름, 공백/플래그 형태, URL 자격증명, JSON 형태
test('접두사가 붙은 환경변수 이름도 가린다 (GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, my_password)', () => {
  gone('GITHUB_TOKEN=ghx123abc456def', 'ghx123abc456def');
  gone('export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI');
  gone('my_password=hunter2hunter2', 'hunter2hunter2');
});
test('공백으로 값을 주는 플래그 형태를 가린다 (--password x, --token x)', () => {
  gone('mysql --password hunter2x', 'hunter2x');
  gone('tool --token abcdef123456', 'abcdef123456');
});
test('mysql 스타일 -pVALUE 를 가린다, mkdir -p 같은 일반 사용은 그대로', () => {
  gone('mysql -u root -phunter2x', 'hunter2x');
  assert.equal(maskSecrets('mkdir -p build/out'), 'mkdir -p build/out');
});
test('URL에 포함된 user:password@ 를 가린다', () => {
  gone('git clone https://user:s3cretPass@host.example/repo.git', 's3cretPass');
});
test('JSON 형태의 "password": "값" 을 가린다', () => {
  gone('{"password": "hunter2hunter2", "user": "kim"}', 'hunter2hunter2');
});
test('키 이름이 단어일 뿐인 일반 문장은 그대로 둔다', () => {
  assert.equal(maskSecrets('refresh token needed here'), 'refresh token needed here');
});
test('토큰 인자가 있는 --env-file=.env 도 설정 파일로 바뀐다', () => {
  assert.ok(!maskSecrets('docker run --env-file=.env img').includes('.env'));
});
test('아주 긴 입력도 빠르게 처리한다 (백트래킹 폭주 없음)', () => {
  const t0 = Date.now();
  maskSecrets('a'.repeat(5000) + '/' + 'b1'.repeat(3000));
  maskSecrets('x/'.repeat(3000));
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0}ms`);
});
