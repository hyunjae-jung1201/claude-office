import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '../src/roles/testrun.js';

const node = process.execPath;
const dir = () => realpathSync(mkdtempSync(join(tmpdir(), 'testrun-')));

test('통과: 종료 코드 0 → ok, 명령 문자열·시간·출력 꼬리', async () => {
  const r = await runTests({ command: [node, '-e', 'console.log("3 passing")'], cwd: dir() });
  assert.deepEqual([r.ok, r.exitCode, r.timedOut], [true, 0, false]);
  assert.match(r.output, /3 passing/);
  assert.ok(r.durationMs >= 0 && r.command.includes('-e'));
});

test('실패: 종료 코드와 출력의 마지막 부분을 남기고, 비밀값은 가린다', async () => {
  const r = await runTests({ command: [node, '-e', 'console.log("x".repeat(9000)); console.error("token=abcd1234efghijkl FAIL at a.js:3"); process.exit(3)'], cwd: dir() });
  assert.deepEqual([r.ok, r.exitCode], [false, 3]);
  assert.ok(r.output.length <= 3000);
  assert.match(r.output, /FAIL at a\.js:3/);
  assert.ok(!r.output.includes('abcd1234efghijkl'));
});

test('작업 폴더에서 실행되고, 환경변수는 허용 목록만(CI=1 포함) 전달한다', async () => {
  const d = dir();
  writeFileSync(join(d, 'marker.txt'), 'm');
  process.env.SECRET_FOR_TESTRUN = 'leak-me';
  const r = await runTests({ command: [node, '-e', 'const fs=require("fs");console.log(fs.existsSync("marker.txt"), process.env.SECRET_FOR_TESTRUN, process.env.CI, process.env.CLAUDE_OFFICE_ROLE)'], cwd: d });
  delete process.env.SECRET_FOR_TESTRUN;
  assert.match(r.output, /true undefined 1 1/);
});

test('시간 초과: 프로세스(자식 포함)를 끝내고 timedOut', async () => {
  const t0 = Date.now();
  const r = await runTests({ command: [node, '-e', 'setInterval(()=>{},1000)'], cwd: dir(), timeoutMs: 300 });
  assert.deepEqual([r.ok, r.timedOut], [false, true]);
  assert.ok(Date.now() - t0 < 5000);
});

test('없는 명령·중단 signal 은 실패로 돌려준다(예외를 던지지 않는다)', async () => {
  const a = await runTests({ command: ['/no/such/binary-xyz'], cwd: dir() });
  assert.equal(a.ok, false);
  assert.match(a.output, /실행 실패|ENOENT/);
  const ac = new AbortController();
  const p = runTests({ command: [node, '-e', 'setInterval(()=>{},1000)'], cwd: dir(), signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  const b = await p;
  assert.equal(b.ok, false);
  assert.equal(b.aborted, true);
});
