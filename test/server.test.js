import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

// ---- 세션 등록 정보 폴링 (백그라운드 작업 표시)
test('등록 정보의 shell 상태는 "백그라운드 작업 중", idle이면 대기, 사라지면 꺼짐', () => {
  const sessionsDir = mkdtempSync(join(tmpdir(), 'office-live-'));
  const file = join(sessionsDir, `${process.pid}.json`);
  const entry = (status) => JSON.stringify({ pid: process.pid, sessionId: 'live-1', name: '에이 팀', cwd: '/home/hyeanjae', status });
  const nconfig = { ...config, projects: [{ name: 'A', path: '/w/a', color: '#e8637a', aliases: ['에이 팀'] }, config.projects[1]] };
  writeFileSync(file, entry('shell'));
  return withServer({ config: nconfig, sessionsDir, liveMs: 30 }, async ({ port }) => {
    const c = await connect(port);
    const s1 = await c.waitFor((s) => teamA(s).label === '백그라운드 작업 중');
    assert.equal(teamA(s1).status, 'run');
    writeFileSync(file, entry('idle'));
    await c.waitFor((s) => teamA(s).status === 'idle');
    rmSync(file);
    await c.waitFor((s) => teamA(s).status === 'off');
    c.close();
  });
});

// ---- 역할자 검토 통합
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createReviewStore } from '../src/roles/store.js';

const ROLES_MAP = new Map(['pm', 'developer', 'qa'].map((id) => [id, { id, name: id.toUpperCase(), color: '#112233', model: 'sonnet', when: 'always', tools: ['Read', 'Grep', 'Glob'], prompt: `나는 ${id}` }]));
const OK_JSON = JSON.stringify({ verdict: 'ok', summary: '문제 없음', findings: [] });
const gitIn = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
function makeRepo(files = { 'a.js': 'const a = 1;\n' }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'office-repo-')));
  gitIn(root, 'init', '-q');
  for (const [n, t] of Object.entries(files)) writeFileSync(join(root, n), t);
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-qm', 'init');
  return root;
}
const rolesCfg = (over = {}) => ({ enabled: true, default: ['pm', 'developer', 'qa'], cooldownMinutes: 5, minWrites: 1, dailyLimit: 120, deliver: 'report', projects: {}, ...over });
const roleServer = (repoRoot, extra = {}) => ({
  config: { ...config, projects: repoRoot ? [{ name: 'A', path: repoRoot, color: '#e8637a' }, config.projects[1]] : config.projects, roles: rolesCfg(extra.rolesCfg) },
  roles: ROLES_MAP,
  reviewStore: createReviewStore({ dir: mkdtempSync(join(tmpdir(), 'office-rev-')) }),
  reviewRun: extra.run ?? (async () => { await new Promise((r) => setTimeout(r, 30)); return OK_JSON; }),
});
const editThenStop = async (port, { cwd, session = 'rs1', file, resp = '고쳤습니다' }) => {
  await post(port, { session_id: session, cwd, hook_event_name: 'UserPromptSubmit', prompt: '기능을 고쳐줘' });
  await post(port, { session_id: session, cwd, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } });
  await post(port, { session_id: session, cwd, hook_event_name: 'Stop', last_assistant_message: resp });
};
const getJson = (port, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, body: body ? (res.headers['content-type']?.includes('json') ? JSON.parse(body) : body) : null }));
  }).on('error', reject);
});
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); } throw new Error('timeout'); };

test('편집 후 Stop → 역할자 3명이 나타나고, 끝나면 배지와 최근 검토 목록이 생긴다', async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  await withServer(roleServer(repo), async ({ port }) => {
    const c = await connect(port);
    await editThenStop(port, { cwd: repo, file: join(repo, 'a.js') });
    const s1 = await c.waitFor((s) => teamA(s).roles.length === 3 && teamA(s).roles.every((r) => r.status === 'running'));
    assert.deepEqual(teamA(s1).roles.map((r) => r.name), ['PM', 'DEVELOPER', 'QA']);
    const s2 = await c.waitFor((s) => teamA(s).badge && s.reviews.length === 1);
    assert.equal(teamA(s2).badge.verdict, 'ok');
    assert.equal(s2.reviews[0].repoName, repo.split('/').pop());
    c.close();
  });
});

test('세션이 홈 폴더에서 두 저장소를 편집하면 저장소마다 검토되고, 팀이 없어도 API로 볼 수 있다 (Review Focus 1)', async () => {
  const r1 = makeRepo({ 'a.js': 'x\n' });
  const r2 = makeRepo({ 'b.js': 'y\n' });
  writeFileSync(join(r1, 'a.js'), 'x2\n');
  writeFileSync(join(r2, 'b.js'), 'y2\n');
  await withServer(roleServer(null), async ({ port }) => {
    const cwd = '/home/hyeanjae';
    await post(port, { session_id: 'h1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(r1, 'a.js') } });
    await post(port, { session_id: 'h1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(r2, 'b.js') } });
    await post(port, { session_id: 'h1', cwd, hook_event_name: 'Stop', last_assistant_message: '끝' });
    const all = await until(async () => { const r = await getJson(port, '/api/reviews'); return r.body.length === 2 && r.body; });
    assert.deepEqual(all.map((x) => x.repoRoot).sort(), [r1, r2].sort());
    const one = await getJson(port, `/api/reviews?repo=${encodeURIComponent(r1)}`);
    assert.equal(one.body.length, 1);
    assert.equal(one.body[0].results.length, 3);
    assert.ok(!JSON.stringify(one.body).includes('기능을'));
  });
});

test('/api/reviews: 다른 Origin/Host는 403, 이상한 repo 값은 400, 검토가 없으면 빈 배열', () =>
  withServer(roleServer(null), async ({ port }) => {
    assert.equal((await getJson(port, '/api/reviews', { host: 'evil.example' })).status, 403);
    assert.equal((await getJson(port, '/api/reviews?repo=relative/path')).status, 400);
    assert.equal((await getJson(port, `/api/reviews?repo=${encodeURIComponent('/a/' + 'x'.repeat(600))}`)).status, 400);
    const ok = await getJson(port, '/api/reviews?repo=/nope');
    assert.deepEqual([ok.status, ok.body], [200, []]);
  }));

test('diff 속 비밀값과 .env 변경은 역할자 프롬프트에 원문으로 전달되지 않는다 (Review Focus 3)', async () => {
  const repo = makeRepo({ 'a.js': 'x\n', '.env': 'K=old\n' });
  writeFileSync(join(repo, 'a.js'), 'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
  writeFileSync(join(repo, '.env'), 'K=ENVSECRETVALUE424242\n');
  const prompts = [];
  const run = async ({ prompt }) => { prompts.push(prompt); return OK_JSON; };
  await withServer(roleServer(repo, { run }), async ({ port }) => {
    await editThenStop(port, { cwd: repo, file: join(repo, 'a.js'), resp: '토큰 sk-abcdefghijklmnopqrstuvwx1234 를 넣었습니다' });
    await post(port, { session_id: 'rs1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(repo, '.env') } });
    await until(() => prompts.length >= 3);
    for (const p of prompts) {
      assert.ok(!p.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
      assert.ok(!p.includes('ENVSECRETVALUE424242'));
      assert.ok(!p.includes('sk-abcdefghijklmnopqrstuvwx1234'));
    }
  });
});

test('알 수 없는 역할 id가 설정에 있으면 서버 시작이 한국어 오류로 거부된다 (Review Focus 5)', async () => {
  const opts = roleServer(null);
  opts.config.roles.default = ['pm', 'ghost'];
  await assert.rejects(startServer(opts), /알 수 없는 역할 id: ghost/);
});

test('roles.enabled=false면 검토하지 않는다', async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'a.js'), 'z\n');
  let calls = 0;
  await withServer(roleServer(repo, { rolesCfg: { enabled: false }, run: async () => { calls++; return OK_JSON; } }), async ({ port }) => {
    await editThenStop(port, { cwd: repo, file: join(repo, 'a.js') });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls, 0);
  });
});

test('검토가 진행 중일 때 서버를 닫아도 오류 없이 끝난다 (Review Focus 5: 재시작)', async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'a.js'), 'z\n');
  const srv = await startServer({ ...roleServer(repo, { run: () => new Promise(() => {}) }), port: 0 });
  await editThenStop(srv.port, { cwd: repo, file: join(repo, 'a.js') });
  await until(async () => (await getJson(srv.port, '/api/reviews')).status === 200);
  await new Promise((r) => setTimeout(r, 150));
  await assert.doesNotReject(srv.close());
});

test('서버를 다시 띄우면 저장된 검토에서 목록과 팀 배지가 복원된다', async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'a.js'), 'z\n');
  const opts = roleServer(repo);
  await withServer(opts, async ({ port }) => {
    await editThenStop(port, { cwd: repo, file: join(repo, 'a.js') });
    await until(async () => (await getJson(port, '/api/reviews')).body.length === 1);
  });
  await withServer(opts, async ({ port }) => {
    const c = await connect(port);
    const s = await c.waitFor(() => true);
    assert.equal(s.reviews.length, 1);
    assert.equal(teamA(s).badge.verdict, 'ok');
    c.close();
  });
});

// ---- hook이 없는 세션: 세션 기록(transcript) 수집기
function fakeLocalTail() {
  const h = { push: null, stopped: 0 };
  h.factory = ({ onEvent }) => { h.push = onEvent; return { stop() { h.stopped++; }, status: () => 'connected' }; };
  return h;
}
const tx = (o) => ({ sessionId: 'tx1', cwd: '/w/a', ts: Date.now(), source: 'transcript', ...o });

test('hook이 없는 세션도 세션 기록 이벤트로 팀 상태가 바뀐다', () => {
  const lt = fakeLocalTail();
  return withServer({ localTail: lt.factory }, async ({ port }) => {
    const c = await connect(port);
    lt.push(tx({ type: 'tool', category: 'run', detail: 'make' }));
    await c.waitFor((s) => teamA(s).status === 'run');
    lt.push(tx({ type: 'agentStart', agentId: 'ag1', agentType: 'Explore' }));
    const s = await c.waitFor((x) => teamA(x).members.length === 1);
    assert.equal(teamA(s).members[0].type, 'Explore');
    c.close();
  });
});

test('hook 신호가 오는 세션의 세션 기록 이벤트는 무시한다(이중 집계 방지), 10분 뒤에는 다시 받는다', () => {
  const lt = fakeLocalTail();
  let t = 1_000_000;
  return withServer({ localTail: lt.factory, now: () => t }, async ({ port }) => {
    const c = await connect(port);
    await post(port, hookPayload({ session_id: 'tx1', cwd: '/w/a' })); // hook: Bash → run
    await c.waitFor((s) => teamA(s).status === 'run');
    lt.push(tx({ type: 'tool', category: 'read', detail: '/w/a/x' }));
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(c.seen.every((s) => teamA(s).status !== 'read'));
    t += 11 * 60 * 1000;
    lt.push(tx({ type: 'tool', category: 'read', detail: '/w/a/x', ts: t }));
    await c.waitFor((s) => teamA(s).status === 'read');
    c.close();
  });
});

test('세션 기록으로만 알려진 세션이 파일을 수정하고 응답을 끝내도 역할자 검토가 시작된다', async () => {
  const repo = makeRepo();
  writeFileSync(join(repo, 'a.js'), 'const a = 9;\n');
  const lt = fakeLocalTail();
  await withServer({ ...roleServer(repo), localTail: lt.factory }, async ({ port }) => {
    const c = await connect(port);
    lt.push(tx({ cwd: repo, type: 'prompt', promptText: '값을 9로 바꿔줘' }));
    lt.push(tx({ cwd: repo, type: 'tool', category: 'write', toolName: 'Edit', filePath: join(repo, 'a.js'), detail: join(repo, 'a.js') }));
    lt.push(tx({ cwd: repo, type: 'stop', assistantText: '바꿨습니다' }));
    const s = await c.waitFor((x) => teamA(x).badge && x.reviews.length === 1);
    assert.equal(teamA(s).badge.verdict, 'ok');
    c.close();
  });
});

test('서버를 닫으면 세션 기록 수집기도 멈춘다', async () => {
  const lt = fakeLocalTail();
  await withServer({ localTail: lt.factory }, async () => {});
  assert.equal(lt.stopped, 1);
});

// ---- git 없는 팀 폴더
test('git이 아닌 팀 폴더에서 파일을 수정하고 응답을 끝내면 수정 기록으로 역할자 검토가 시작된다', async () => {
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'office-plain-')));
  writeFileSync(join(plain, 'a.js'), 'const a = 2;\n');
  const prompts = [];
  const opts = roleServer(plain, { run: async ({ prompt }) => { prompts.push(prompt); return OK_JSON; } });
  await withServer(opts, async ({ port }) => {
    const c = await connect(port);
    await post(port, { session_id: 'pg1', cwd: plain, hook_event_name: 'UserPromptSubmit', prompt: '값을 2로 바꿔줘' });
    await post(port, { session_id: 'pg1', cwd: plain, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(plain, 'a.js'), old_string: 'const a = 1;', new_string: 'const a = 2;' } });
    await post(port, { session_id: 'pg1', cwd: plain, hook_event_name: 'Stop', last_assistant_message: '바꿨습니다' });
    const s = await c.waitFor((x) => teamA(x).badge && x.reviews.length === 1);
    assert.equal(teamA(s).badge.verdict, 'ok');
    await until(() => prompts.length >= 3);
    assert.match(prompts[0], /-const a = 1;/);
    assert.match(prompts[0], /\+const a = 2;/);
    c.close();
  });
});
