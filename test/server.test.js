import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { connect } from './helpers/ws-client.js';

const config = {
  port: 0, offAfterMinutes: 10, maxMembers: 4, celebrateAfterSeconds: 30,
  projects: [{ name: 'A', path: '/w/a', color: '#e8637a' }, { name: 'B', path: '/w/b', color: '#2a7f8f' }],
};
const hookPayload = (extra = {}) => ({ session_id: 's1', cwd: '/w/a', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...extra });
const post = (port, body) => fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const teamA = (snap) => snap.teams.find((t) => t.name === 'A');

async function withServer(opts, fn) {
  const srv = await startServer({ config, ...opts });
  try { await fn(srv); } finally { await srv.close(); }
}

test('정상 이벤트는 204이고 WS 클라이언트가 해당 팀의 상태를 받는다', () =>
  withServer({}, async ({ port }) => {
    const c = await connect(port);
    const res = await post(port, hookPayload());
    assert.equal(res.status, 204);
    const snap = await c.waitFor((s) => teamA(s).status === 'run');
    assert.equal(teamA(snap).status, 'run');
    c.close();
  }));

test('깨진 JSON과 알 수 없는 이벤트는 400이고 스냅샷은 그대로다', () =>
  withServer({}, async ({ port }) => {
    const c = await connect(port);
    await c.waitFor((s) => teamA(s).status === 'off');
    assert.equal((await post(port, '{not json')).status, 400);
    assert.equal((await post(port, { foo: 1 })).status, 400);
    assert.equal((await post(port, hookPayload({ hook_event_name: 'Mystery' }))).status, 400);
    assert.equal((await post(port, '"str"')).status, 400);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(c.seen.every((s) => teamA(s).status === 'off'));
    c.close();
  }));

test('접속하자마자 현재 스냅샷을 받는다', () =>
  withServer({}, async ({ port }) => {
    await post(port, hookPayload());
    const c = await connect(port);
    const snap = await c.waitFor(() => true);
    assert.equal(teamA(snap).status, 'run');
    c.close();
  }));

test('127.0.0.1에만 바인딩한다', () =>
  withServer({}, async ({ host }) => assert.equal(host, '127.0.0.1')));

test('요약이 끝나지 않아도 /event 응답은 즉시 온다', () =>
  withServer({ summarizer: { summarize: () => new Promise(() => {}) } }, async ({ port }) => {
    const t0 = Date.now();
    assert.equal((await post(port, hookPayload())).status, 204);
    assert.ok(Date.now() - t0 < 500);
  }));

test('요약 결과가 나중에 말풍선 문구로 브로드캐스트된다', () =>
  withServer({ summarizer: { summarize: async () => '학습에 필요한 데이터 다운 중' } }, async ({ port }) => {
    const c = await connect(port);
    await post(port, hookPayload());
    const snap = await c.waitFor((s) => teamA(s).label === '학습에 필요한 데이터 다운 중');
    assert.equal(teamA(snap).status, 'run');
    c.close();
  }));

test('늦게 끝난 이전 요약이 최신 문구를 덮어쓰지 않는다', () => {
  const pending = [];
  const summarizer = { summarize: () => new Promise((resolve) => pending.push(resolve)) };
  return withServer({ summarizer }, async ({ port }) => {
    const c = await connect(port);
    await post(port, hookPayload({ tool_input: { command: 'first' } }));
    await post(port, hookPayload({ tool_input: { command: 'second' } }));
    await c.waitFor(() => pending.length === 2 || true);
    while (pending.length < 2) await new Promise((r) => setTimeout(r, 10));
    pending[1]('두 번째 작업');
    await c.waitFor((s) => teamA(s).label === '두 번째 작업');
    pending[0]('첫 번째 작업');
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(c.seen.every((s) => teamA(s).label !== '첫 번째 작업'));
    c.close();
  });
});

test('서버를 새로 띄우면 모든 팀이 off로 시작한다', async () => {
  await withServer({}, async ({ port }) => { await post(port, hookPayload()); });
  await withServer({}, async ({ port }) => {
    const c = await connect(port);
    const snap = await c.waitFor(() => true);
    assert.ok(snap.teams.every((t) => t.status === 'off'));
    c.close();
  });
});

test('tick이 조용한 세션을 off로 바꾸고 브로드캐스트한다', () => {
  let t = 1_000_000;
  return withServer({ now: () => t, tickMs: 20 }, async ({ port }) => {
    const c = await connect(port);
    await post(port, hookPayload({ hook_event_name: 'SessionStart' }));
    await c.waitFor((s) => teamA(s).status === 'idle');
    t += 11 * 60 * 1000;
    await c.waitFor((s) => teamA(s).status === 'off' && s.ts === t);
    c.close();
  });
});

test('너무 큰 본문은 413', () =>
  withServer({}, async ({ port }) => {
    const res = await post(port, JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }));
    assert.equal(res.status, 413);
  }));

function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    }).on('error', reject);
  });
}

test('정적 파일: public, vendor/three 제공, 경로 탈출은 404', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-pub-'));
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'index.html'), '<h1>office</h1>');
  writeFileSync(join(dir, 'js', 'x.js'), 'export const a = 1;');
  return withServer({ publicDir: dir }, async ({ port }) => {
    const root = await rawGet(port, '/');
    assert.equal(root.status, 200);
    assert.match(root.type, /text\/html/);
    assert.match(root.body, /office/);
    const js = await rawGet(port, '/js/x.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /javascript/);
    assert.equal((await rawGet(port, '/vendor/three/build/three.module.js')).status, 200);
    assert.equal((await rawGet(port, '/js/..%2f..%2fpackage.json')).status, 404);
    assert.equal((await rawGet(port, '/vendor/three/../../package.json')).status, 404);
    assert.equal((await rawGet(port, '/nope')).status, 404);
  });
});
