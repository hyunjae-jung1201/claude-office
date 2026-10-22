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

// ---- 원격 PC 에서 테스트 실행(ssh)
import { EventEmitter } from 'node:events';
import { buildRemoteTestCommand, runRemoteTests } from '../src/roles/testrun.js';

test('buildRemoteTestCommand: 작업 폴더로 이동해 timeout·CI 환경으로 실행하고, 모든 인자를 작은따옴표로 감싼다', () => {
  const s = buildRemoteTestCommand({ cwd: "/home/u/my proj", command: ['python3', '-m', 'pytest', "-k", "it's; rm -rf /"], timeoutMs: 120_000 });
  assert.equal(s, "cd '/home/u/my proj' && exec env CI=1 CLAUDE_OFFICE_ROLE=1 timeout -k 5 120 'python3' '-m' 'pytest' '-k' 'it'\\''s; rm -rf /'");
});

function fakeSsh(exitCode, out = '') {
  const calls = [];
  const spawnFn = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.pid = 0; child.kill = () => {};
    calls.push({ cmd, args, options });
    setImmediate(() => { if (out) child.stdout.emit('data', out); child.emit('close', exitCode); });
    return child;
  };
  return { spawnFn, calls };
}
const REMOTE = { name: 'PC2', ssh: 'me@192.168.0.20', key: '/k/id' };

test('runRemoteTests: ssh 로 원격 명령을 실행하고 표시 이름은 "PC2: 명령"이며, 124 는 시간 초과, 255 는 연결 실패로 본다', async () => {
  const a = fakeSsh(0, '5 passed');
  const ok = await runRemoteTests({ remote: REMOTE, command: ['pytest', '-q'], cwd: '/home/u/acc', timeoutMs: 60_000, spawnFn: a.spawnFn });
  assert.deepEqual([ok.ok, ok.exitCode, ok.command], [true, 0, 'PC2: pytest -q']);
  assert.match(ok.output, /5 passed/);
  assert.equal(a.calls[0].cmd, 'ssh');
  assert.ok(a.calls[0].args.includes('BatchMode=yes') && a.calls[0].args.includes('me@192.168.0.20'));
  assert.match(a.calls[0].args.at(-1), /^cd '\/home\/u\/acc' && exec env CI=1 .* timeout -k 5 60 'pytest' '-q'$/);
  const t = await runRemoteTests({ remote: REMOTE, command: ['pytest'], cwd: '/x', spawnFn: fakeSsh(124).spawnFn });
  assert.deepEqual([t.ok, t.timedOut], [false, true]);
  const c = await runRemoteTests({ remote: REMOTE, command: ['pytest'], cwd: '/x', spawnFn: fakeSsh(255, 'ssh: connect to host refused').spawnFn });
  assert.equal(c.ok, false);
  assert.match(c.output, /SSH 연결 실패/);
});
