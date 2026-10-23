import http from 'node:http';
import { TOKEN_HEADER, loadOrCreateToken, tokenMatches } from './token.js';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig, matchProject } from './config.js';
import { normalizeEvent } from './events.js';
import { createState, applyEvent, tick, snapshot, setLabel, applyReviewEvent, setReviewHistory, teamOfSession } from './state.js';
import { ruleLabel } from './labels.js';
import { createSummarizer } from './summarizer.js';
import { startRemote, startLocalTail, projectionToEvents } from './remote.js';
import { createSessionRegistry } from './sessions.js';
import { createLiveMonitor } from './live.js';
import { validateRoleIds } from './roles/loader.js';
import { createReviewTracker } from './roles/tracker.js';
import { createScheduler } from './roles/scheduler.js';
import { createReviewStore } from './roles/store.js';
import { groupFilesByRepo, dirtyFiles } from './roles/context.js';
import { createFeedbackBox } from './roles/feedback.js';
import { runRole } from './roles/runner.js';
import { createDailyLog } from './daily.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const BODY_LIMIT = 1024 * 1024;
const HOOK_SESSION_MS = 10 * 60 * 1000;
const BUBBLE_EVENTS = new Set(['start', 'end', 'prompt', 'tool', 'wait', 'stop', 'agentStart', 'agentStop']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

export async function startServer({
  config,
  token = null, // 있으면 /event·/ingest 는 x-office-token 헤더가 같아야 받는다(없으면 인증 없음: 테스트용)
  summarizer = null,
  now = Date.now,
  tickMs = 30_000,
  port = config.port,
  publicDir = join(ROOT, 'public'),
  remoteFactory = startRemote,
  sessionsDir,
  liveMs = 3000,
  dailyDataDir, // 작업 로그 초안의 중간 저장 폴더(기본 data/daily)
  roles = null, // 역할 정의(Map). 없거나 config.roles.enabled 가 거짓이면 역할자 검토를 하지 않는다
  reviewStore = null,
  reviewRun = runRole,
  localTail = null, // hook 이 없는 세션을 세션 기록으로 읽는 수집기(없으면 사용 안 함)
} = {}) {
  const registry = createSessionRegistry(sessionsDir ? { dir: sessionsDir } : {});
  const state = createState(config);

  // 역할자 검토: 설정이 잘못됐으면 서버를 띄우기 전에 알린다
  const rolesOn = Boolean(roles && config.roles?.enabled);
  if (rolesOn) validateRoleIds(config, roles);
  const store = rolesOn ? (reviewStore ?? createReviewStore({ dir: join(ROOT, 'data', 'reviews') })) : null;
  if (rolesOn) setReviewHistory(state, store.list(20));
  const clients = new Set();
  const seqs = new Map(); // 세션/에이전트별 최신 이벤트 번호: 늦게 끝난 요약이 최신 문구를 덮지 않게 한다

  const broadcast = () => {
    if (clients.size === 0) return;
    const msg = JSON.stringify(snapshot(state, now()));
    for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
  };

  const bump = (key) => {
    const n = (seqs.get(key) ?? 0) + 1;
    seqs.set(key, n);
    return n;
  };

  const feedback = rolesOn && config.roles.deliver === 'session' ? createFeedbackBox({ now, minSeverity: config.roles.deliverMinSeverity }) : null;
  // 하루 작업 로그 초안(자동기록.md): config.dailyLog 가 있을 때만
  const dailyLog = config.dailyLog
    ? createDailyLog({ dir: config.dailyLog.dir, dataDir: dailyDataDir ?? join(ROOT, 'data', 'daily'), now, intervalMs: config.dailyLog.intervalSeconds * 1000, emit: (e) => { applyReviewEvent(state, e, now()); broadcast(); } })
    : null;
  let scheduler = null;
  let tracker = null;
  const hookSeen = new Map(); // hook 신호를 보내는 세션 -> 마지막 신호 시각 (같은 세션을 세션 기록으로 또 세지 않기 위해)

  function handleEvent(ev) {
    // hook 이 이미 알려 주는 세션의 세션 기록 이벤트는 버린다(이중 집계 방지). 10분 동안 hook 신호가 없으면 다시 받는다.
    if (ev.source === 'transcript' && !ev.host) {
      const last = hookSeen.get(ev.sessionId);
      if (last !== undefined && now() - last < HOOK_SESSION_MS) return;
    }
    // 역할자 검토는 화면 팀에 안 맞는 세션(홈 폴더 등)도 보므로 가장 먼저 넘긴다
    if (!ev.ai) tracker?.onEvent(ev).catch(() => {}); // 다른 AI 도구(Codex 등)의 세션은 역할자 검토 대상이 아니다
    if (ev.type === 'live' && ev.liveStatus === 'gone') {
      applyEvent(state, ev, ev.ts);
      broadcast();
      return;
    }
    // 이 PC의 세션은 등록 정보에서 이름을 찾는다(원격 이벤트는 수집기가 이름을 실어 보낸다)
    ev.sessionName ??= ev.host ? undefined : registry.nameOf(ev.sessionId);
    const project = matchProject(config, ev.cwd, ev.host, ev.sessionName, ev.ai);
    if (!project) return; // 지정하지 않은 폴더: 상태·추적·브로드캐스트 모두 만들지 않는다
    if (!ev.ai) dailyLog?.record(project, ev);
    applyEvent(state, ev, ev.ts);
    const key = `${ev.sessionId}|${ev.agentId ?? ''}`;
    // 말풍선을 바꾸는 이벤트만 번호를 올린다(toolDone은 제외: 요약이 도구 종료 뒤에 도착해도 보이게)
    const seq = BUBBLE_EVENTS.has(ev.type) ? bump(key) : (seqs.get(key) ?? 0);
    if (ev.type === 'end') for (const k of [...seqs.keys()]) if (k.startsWith(`${ev.sessionId}|`)) seqs.delete(k);
    if (ev.type === 'agentStop') seqs.delete(key);

    if (ev.type === 'wait') setLabel(state, ev.sessionId, ev.agentId ?? null, ruleLabel(ev));
    if (ev.type === 'tool') {
      setLabel(state, ev.sessionId, ev.agentId ?? null, ruleLabel(ev));
      if (summarizer) {
        summarizer.summarize(ev).then((label) => {
          if (seqs.get(key) !== seq) return;
          setLabel(state, ev.sessionId, ev.agentId ?? null, label);
          broadcast();
        }).catch(() => {});
      }
    }
    broadcast();
  }

  function readBody(req, res) {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return res.writeHead(413).end();
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return res.writeHead(400).end();
      }
      const ev = normalizeEvent(payload, now());
      if (!ev) return res.writeHead(400).end();
      hookSeen.set(ev.sessionId, now());
      handleEvent(ev);
      // 역할자 의견 전달(deliver: session): 같은 세션의 다음 프롬프트에만 한 번 붙인다
      const note = ev.type === 'prompt' && !ev.ai ? feedback?.take(ev.sessionId) : undefined;
      if (note) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: note } }));
      res.writeHead(204).end();
    });
    req.on('error', () => res.writeHead(400).end());
  }

  // "지금 검토": 그 팀에 모여 있는 변경을 바로 검토한다. 모인 변경이 없으면 팀 폴더가 git 저장소일 때 커밋 안 된 변경을 검토한다.
  async function reviewNow(req, res) {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => { size += c.length; if (size > 4096) tooBig = true; else chunks.push(c); });
    req.on('end', async () => {
      const send = (status, obj) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(obj));
      if (tooBig) return send(413, { error: 'too-big' });
      let team;
      try { team = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.team; } catch { return send(400, { error: 'bad-json' }); }
      if (typeof team !== 'string' || !team) return send(400, { error: 'bad-team' });
      if (!rolesOn) return send(409, { error: 'roles-disabled' });
      const project = config.projects.find((p) => p.name === team);
      if (!project) return send(404, { error: 'unknown-team' });
      try {
        if (await tracker.reviewNow(project.path, project.host) > 0) return send(200, { started: true, via: 'pending' });
        const files = project.host ? null : await dirtyFiles(project.path);
        if (!files?.length) return send(200, { started: false, reason: 'no-changes' });
        let latest = null;
        for (const [id, s] of state.sessions) if (s.project === team && (!latest || s.lastEventAt > latest.at)) latest = { id, at: s.lastEventAt };
        const root = (await groupFilesByRepo(files)).keys().next().value;
        if (!root) return send(200, { started: false, reason: 'no-changes' });
        scheduler.submit({ repoRoot: root, team, sessionId: latest?.id ?? `manual:${team}`, files, requests: [], lastResponse: '', reason: 'manual' });
        return send(200, { started: true, via: 'git' });
      } catch {
        return send(500, { error: 'failed' });
      }
    });
    req.on('error', () => res.writeHead(400).end());
  }

  // 다른 PC 가 ssh 로 밀어 넣는 세션 기록 줄(remote-tail.cjs 출력)을 받아 그 원격(host)의 이벤트로 처리한다(remotes[].push)
  const ingestCtx = new Map();
  function ingest(req, res, url) {
    const name = url.searchParams.get('remote');
    if (!name) return res.writeHead(400).end();
    const remote = config.remotes?.find((r) => r.name === name && r.push);
    if (!remote) return res.writeHead(404).end();
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) tooBig = true; else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return res.writeHead(413).end();
      let ctx = ingestCtx.get(name);
      if (!ctx) ingestCtx.set(name, (ctx = { tools: new Map(), seen: new Set() }));
      for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
        let p;
        try { p = JSON.parse(line); } catch { continue; }
        try { for (const ev of projectionToEvents(p, ctx, now())) handleEvent({ ...ev, host: name, source: 'transcript' }); } catch { /* 형식이 틀린 줄은 건너뛴다 */ }
      }
      res.writeHead(204).end();
    });
    req.on('error', () => res.writeHead(400).end());
  }

  // 보고서 상세: ?repo=<저장소 루트>(없으면 전체 최근 20건). 저장소가 화면 팀이 아니어도 볼 수 있다.
  function serveReviews(url, res) {
    const repo = url.searchParams.get('repo');
    if (repo !== null && (repo.length > 500 || !repo.startsWith('/') || repo.includes('\0'))) return res.writeHead(400).end();
    const host = url.searchParams.get('host');
    if (host !== null && (host.length > 50 || host.includes('\0'))) return res.writeHead(400).end();
    const data = !store ? [] : repo ? store.forRepo(repo, 20, host || undefined) : store.list(20);
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data));
  }

  async function serveStatic(pathname, res) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return res.writeHead(400).end(); }
    let base = publicDir;
    if (rel === '/') rel = '/index.html';
    else if (rel.startsWith('/vendor/three/')) {
      base = join(ROOT, 'node_modules', 'three');
      rel = rel.slice('/vendor/three'.length);
    }
    const file = resolve(base, '.' + rel);
    if (file !== base && !file.startsWith(base + sep)) return res.writeHead(404).end();
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(data);
    } catch {
      res.writeHead(404).end();
    }
  }

  // 브라우저를 통한 교차 출처 공격(CSRF, DNS 리바인딩, WebSocket 하이재킹)을 막는다.
  const ownPort = () => server.address().port;
  const hostOk = (req) => [`127.0.0.1:${ownPort()}`, `localhost:${ownPort()}`].includes(req.headers.host);
  const originOk = (origin) => !origin || [`http://127.0.0.1:${ownPort()}`, `http://localhost:${ownPort()}`].includes(origin);

  const server = http.createServer((req, res) => {
    if (!hostOk(req)) return res.writeHead(403).end();
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (req.method === 'GET' && pathname === '/api/reviews') return serveReviews(url, res);
    if (req.method === 'POST' && (pathname === '/event' || pathname === '/ingest') && token && !tokenMatches(token, req.headers[TOKEN_HEADER])) return res.writeHead(401).end();
    if (req.method === 'POST' && pathname === '/event') {
      if (req.headers.origin) return res.writeHead(403).end();
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return res.writeHead(415).end();
      return readBody(req, res);
    }
    if (req.method === 'POST' && pathname === '/ingest') {
      if (req.headers.origin) return res.writeHead(403).end();
      if (!String(req.headers['content-type'] ?? '').startsWith('application/x-ndjson')) return res.writeHead(415).end();
      return ingest(req, res, url);
    }
    if (req.method === 'POST' && pathname === '/api/review-now') {
      if (!originOk(req.headers.origin)) return res.writeHead(403).end();
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return res.writeHead(415).end();
      return reviewNow(req, res);
    }
    if (req.method === 'GET') return serveStatic(pathname, res);
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ origin, req }) => hostOk(req) && originOk(origin) });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.send(JSON.stringify(snapshot(state, now())));
  });

  // 이 PC에서 실행 중인 세션: 등록 정보를 주기적으로 읽어 상태 변화·하트비트를 이벤트로 흘려 넣는다
  const liveMonitor = createLiveMonitor({ list: () => registry.liveSessions(), emit: handleEvent, now });
  const pollLive = () => liveMonitor.poll();
  const liveTimer = setInterval(pollLive, liveMs);
  liveTimer.unref();

  const timer = setInterval(() => {
    tick(state, now());
    tracker?.tick().catch(() => {});
    for (const [id, at] of hookSeen) if (now() - at >= HOOK_SESSION_MS) hookSeen.delete(id);
    for (const k of [...seqs.keys()]) if (!state.sessions.has(k.split('|')[0])) seqs.delete(k); // 사라진 세션의 추적 상태 정리
    broadcast();
  }, tickMs);
  timer.unref();

  if (rolesOn) {
    scheduler = createScheduler({
      config, roles, store, run: reviewRun, now,
      // 화면에 보일 팀: 그 세션이 속한 팀 → 저장소를 덮는 팀 → 없음(보고서 패널에만 남는다)
      resolveTeam: (job) => job.team ?? teamOfSession(state, job.sessionId) ?? matchProject(config, job.repoRoot)?.name,
      emit: (e) => {
        if (e.type === 'done' && feedback) feedback.add(e.sessionId, e.review);
        if (e.type === 'done' && e.team) dailyLog?.recordReview(e.team, e.review);
        applyReviewEvent(state, e, now());
        broadcast();
      },
    });
    tracker = createReviewTracker({ config, now, groupFiles: groupFilesByRepo, onDue: (job) => scheduler.submit(job) });
  }

  await new Promise((r) => server.listen(port, HOST, r));
  pollLive();

  // 원격 PC: 읽기 전용으로 세션 기록을 받아 같은 이벤트로 흘려 넣는다
  const remotes = (config.remotes ?? []).filter((r) => !r.push).map((remote) => remoteFactory({ remote, onEvent: handleEvent })); // push 원격은 /ingest 로 받는다
  const localCollector = localTail ? localTail({ onEvent: handleEvent }) : null;

  return {
    port: server.address().port,
    host: HOST,
    stats: () => ({ seqs: seqs.size, sessions: state.sessions.size, remotes: remotes.map((r) => r.status()), transcripts: localCollector?.status(), reviews: scheduler?.stats() }),
    close() {
      clearInterval(timer);
      clearInterval(liveTimer);
      scheduler?.close();
      dailyLog?.close();
      for (const r of remotes) r.stop();
      localCollector?.stop();
      for (const ws of clients) ws.terminate();
      return new Promise((r) => {
        wss.close(() => server.close(() => r()));
        server.closeAllConnections?.();
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configPath = process.env.CLAUDE_OFFICE_CONFIG ?? join(ROOT, 'config.json');
  const config = loadConfig(configPath);
  const { loadRoles } = await import('./roles/loader.js');
  const roles = config.roles?.enabled ? loadRoles(join(ROOT, 'roles')) : null;
  const reviewRun = process.env.CLAUDE_OFFICE_FAKE_ROLES ? (await import('./roles/fake.js')).fakeRun : runRole;
  const reviewStore = process.env.CLAUDE_OFFICE_REVIEW_DIR ? createReviewStore({ dir: process.env.CLAUDE_OFFICE_REVIEW_DIR }) : undefined;
  const localTail = config.localTranscripts === false ? null : startLocalTail;
  const srv = await startServer({ config, token: loadOrCreateToken(), summarizer: createSummarizer(), roles, reviewRun, reviewStore, localTail });
  console.log(`Claude Office: http://localhost:${srv.port}  (프로젝트 ${config.projects.length}개)`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => srv.close().then(() => process.exit(0)));
}
