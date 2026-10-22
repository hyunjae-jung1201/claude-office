import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { startLocalTail } from '../src/remote.js';

function fakeSpawn() {
  const calls = [];
  const spawnFn = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); // readline 이 쓰는 실제 스트림
    child.stderr = new PassThrough();
    child.stdin = { on() {}, end() {} };
    child.killed = 0;
    child.kill = () => { child.killed++; };
    calls.push({ cmd, args, options, child });
    return child;
  };
  return { spawnFn, calls };
}
const send = (child, obj) => child.stdout.write(JSON.stringify(obj) + '\n');

test('이 PC의 세션 기록 읽기: node로 remote-tail.cjs를 직접 실행하고, 텍스트 포함 옵션을 켜고, 최소 환경만 넘긴다', () => {
  const { spawnFn, calls } = fakeSpawn();
  process.env.SUPER_SECRET_FOR_TEST = 'leak-me';
  const c = startLocalTail({ onEvent() {}, spawnFn, log: {} });
  delete process.env.SUPER_SECRET_FOR_TEST;
  assert.equal(calls[0].cmd, process.execPath);
  assert.match(calls[0].args[0], /remote-tail\.cjs$/);
  assert.equal(calls[0].options.env.INCLUDE_TEXT, '1');
  assert.equal(calls[0].options.env.SUPER_SECRET_FOR_TEST, undefined);
  assert.ok(calls[0].options.env.HOME);
  c.stop();
});

test('줄 → 이벤트: host 없이 source=transcript가 붙는다', async () => {
  const { spawnFn, calls } = fakeSpawn();
  const events = [];
  const c = startLocalTail({ onEvent: (e) => events.push(e), spawnFn, now: () => 5000, log: {} });
  const child = calls[0].child;
  send(child, { k: 'hello' });
  await new Promise((r) => setImmediate(r));
  assert.equal(c.status(), 'connected');
  send(child, { s: 'S1', c: '/home/me/app', n: '팅크웨어', k: 'tool', tools: [{ i: 't', n: 'Edit', d: '/home/me/app/a.js' }] });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events.map((e) => [e.type, e.host, e.source, e.sessionName, e.filePath]), [['start', undefined, 'transcript', '팅크웨어', undefined], ['tool', undefined, 'transcript', '팅크웨어', '/home/me/app/a.js']]);
  c.stop();
});

test('끊기면 다시 연결하고, stop 하면 프로세스를 종료하고 더 이상 연결하지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { spawnFn, calls } = fakeSpawn();
  const c = startLocalTail({ onEvent() {}, spawnFn, retryMs: [1000, 4000], log: { error() {} } });
  calls[0].child.emit('close', 1);
  assert.equal(c.status(), 'down');
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 2);
  c.stop();
  assert.equal(calls[1].child.killed, 1);
  calls[1].child.emit('close', 0);
  t.mock.timers.tick(10_000);
  assert.equal(calls.length, 2);
});
