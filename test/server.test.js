import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import WebSocket from 'ws';
import { connect } from './helpers/ws-client.js';

const config = {
  port: 0, offAfterMinutes: 10, maxMembers: 4, celebrateAfterSeconds: 30,
  projects: [{ name: 'A', path: '/w/a', color: '#e8637a' }, { name: 'B', path: '/w/b', color: '#2a7f8f' }],
};
const hookPayload = (extra = {}) => ({ session_id: 's1', cwd: '/w/a', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...extra });
const post = (port, body) => fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
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

// ---- 보안 리뷰 반영: 브라우저를 통한 교차 출처 공격(CSRF, WebSocket 하이재킹, DNS 리바인딩) 차단
function rawRequest(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('/event: Origin 헤더가 있는 요청(웹 페이지에서 온 요청)은 403', () =>
  withServer({}, async ({ port }) => {
    const status = await rawRequest(port, {
      method: 'POST', path: '/event', body: JSON.stringify(hookPayload()),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: `127.0.0.1:${port}` },
    });
    assert.equal(status, 403);
    const c = await connect(port);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(c.seen.every((s) => teamA(s).status === 'off'));
    c.close();
  }));

test('/event: Content-Type이 application/json이 아니면 415 (프리플라이트 없는 단순 요청 차단)', () =>
  withServer({}, async ({ port }) => {
    const status = await rawRequest(port, { method: 'POST', path: '/event', body: JSON.stringify(hookPayload()), headers: { 'content-type': 'text/plain' } });
    assert.equal(status, 415);
  }));

test('Host가 로컬 주소가 아니면 모든 요청이 403 (DNS 리바인딩 차단)', () =>
  withServer({}, async ({ port }) => {
    assert.equal(await rawRequest(port, { path: '/', headers: { host: 'evil.example' } }), 403);
    assert.equal(await rawRequest(port, { method: 'POST', path: '/event', body: '{}', headers: { host: `evil.example:${port}`, 'content-type': 'application/json' } }), 403);
    assert.equal(await rawRequest(port, { path: '/nope', headers: { host: `localhost:${port}` } }), 404);
  }));

function wsOpens(url, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    ws.on('open', () => { ws.close(); resolve(true); });
    ws.on('error', () => resolve(false));
    ws.on('unexpected-response', () => resolve(false));
  });
}

test('WebSocket: 다른 출처에서의 접속은 거부, 자기 출처와 Origin 없는 접속은 허용', () =>
  withServer({}, async ({ port }) => {
    const url = `ws://127.0.0.1:${port}/ws`;
    assert.equal(await wsOpens(url, 'https://evil.example'), false);
    assert.equal(await wsOpens(url, `http://localhost:${port}`), true);
    assert.equal(await wsOpens(url, `http://127.0.0.1:${port}`), true);
    assert.equal(await wsOpens(url, null), true);
  }));

// ---- 최종 검토 반영
test('PostToolUse가 요약보다 먼저 와도 요약 문구가 표시된다', () => {
  const pending = [];
  const summarizer = { summarize: () => new Promise((resolve) => pending.push(resolve)) };
  return withServer({ summarizer }, async ({ port }) => {
    const c = await connect(port);
    await post(port, hookPayload());
    await post(port, hookPayload({ hook_event_name: 'PostToolUse' }));
    while (pending.length < 1) await new Promise((r) => setTimeout(r, 10));
    pending[0]('학습 데이터 다운 중');
    await c.waitFor((s) => teamA(s).label === '학습 데이터 다운 중');
    c.close();
  });
});

test('AskUserQuestion/ExitPlanMode는 코드 작성이 아니라 답변·계획 승인 대기로 표시된다', () =>
  withServer({}, async ({ port }) => {
    const c = await connect(port);
    await post(port, hookPayload({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } }));
    const s1 = await c.waitFor((s) => teamA(s).status === 'wait');
    assert.equal(teamA(s1).label, '답변 기다리는 중');
    await post(port, hookPayload({ tool_name: 'ExitPlanMode', tool_input: {} }));
    await c.waitFor((s) => teamA(s).label === '계획 승인 기다리는 중');
    c.close();
  }));

test('지정하지 않은 폴더의 이벤트는 브로드캐스트도 추적 상태도 만들지 않는다', () =>
  withServer({}, async ({ port, stats }) => {
    const c = await connect(port);
    await c.waitFor(() => true);
    const before = c.seen.length;
    assert.equal((await post(port, hookPayload({ cwd: '/home/hyeanjae' }))).status, 204);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(c.seen.length, before);
    assert.equal(stats().seqs, 0);
    c.close();
  }));

test('tick으로 사라진 세션의 추적 상태도 정리된다', () => {
  let t = 1_000_000;
  return withServer({ now: () => t, tickMs: 20 }, async ({ port, stats }) => {
    await post(port, hookPayload());
    assert.equal(stats().seqs, 1);
    t += 61 * 60 * 1000;
    for (let i = 0; i < 100 && stats().seqs > 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(stats().seqs, 0);
  });
});

// ---- 원격 PC
test('원격 수집기가 보낸 이벤트는 host가 같은 팀에만 반영된다', () => {
  let push;
  const remoteFactory = ({ remote, onEvent }) => { push = onEvent; return { stop() {}, status: () => 'connected' }; };
  const rconfig = {
    ...config,
    remotes: [{ name: 'PC2', ssh: 'me@10.0.0.2', key: '/k' }],
    projects: [...config.projects, { name: 'R', path: '/w/a', host: 'PC2', color: '#6c63d9' }],
  };
  return withServer({ config: rconfig, remoteFactory }, async ({ port }) => {
    const c = await connect(port);
    push({ sessionId: 'r1', cwd: '/w/a/sub', host: 'PC2', type: 'tool', category: 'run', detail: 'make', ts: Date.now() });
    const snap = await c.waitFor((s) => s.teams.find((t) => t.name === 'R').status === 'run');
    assert.equal(teamA(snap).status, 'off'); // 같은 경로의 로컬 팀 A는 영향 없음
    c.close();
  });
});

test('서버를 닫으면 원격 수집기도 멈춘다', async () => {
  let stopped = 0;
  const remoteFactory = () => ({ stop: () => stopped++, status: () => 'connected' });
  const rconfig = { ...config, remotes: [{ name: 'PC2', ssh: 'me@10.0.0.2', key: '/k' }] };
  await withServer({ config: rconfig, remoteFactory }, async () => {});
  assert.equal(stopped, 1);
});

// ---- 세션 이름으로 팀 찾기
test('홈 폴더에서 열린 세션도 이름(별칭)으로 팀에 연결된다', () => {
  const sessionsDir = mkdtempSync(join(tmpdir(), 'office-sess-'));
  writeFileSync(join(sessionsDir, '7.json'), JSON.stringify({ pid: 7, sessionId: 'named-1', name: '에이 팀' }));
  const nconfig = { ...config, projects: [{ name: 'A', path: '/w/a', color: '#e8637a', aliases: ['에이 팀'] }, config.projects[1]] };
  return withServer({ config: nconfig, sessionsDir }, async ({ port }) => {
    const c = await connect(port);
    await post(port, hookPayload({ session_id: 'named-1', cwd: '/home/hyeanjae' }));
    await c.waitFor((s) => teamA(s).status === 'run');
    await post(port, hookPayload({ session_id: 'stranger', cwd: '/home/hyeanjae', tool_name: 'Read', tool_input: { file_path: '/x' } }));
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(c.seen.every((s) => teamA(s).status !== 'read'));
    c.close();
  });
});

test('원격 이벤트의 sessionName으로도 팀이 정해진다', () => {
  let push;
  const remoteFactory = ({ onEvent }) => { push = onEvent; return { stop() {}, status: () => 'connected' }; };
  const rconfig = { ...config, remotes: [{ name: 'PC2', ssh: 'a@b', key: '/k' }], projects: [...config.projects, { name: 'R', path: '/r', host: 'PC2', aliases: ['원격 이름'], color: '#6c63d9' }] };
  return withServer({ config: rconfig, remoteFactory }, async ({ port }) => {
    const c = await connect(port);
    push({ sessionId: 'r1', cwd: '/home/other', host: 'PC2', sessionName: '원격 이름', type: 'tool', category: 'read', detail: 'x', ts: Date.now() });
    await c.waitFor((s) => s.teams.find((t) => t.name === 'R').status === 'read');
    c.close();
  });
});
