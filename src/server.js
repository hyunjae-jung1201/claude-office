import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig, matchProject } from './config.js';
import { normalizeEvent } from './events.js';
import { createState, applyEvent, tick, snapshot, setLabel } from './state.js';
import { ruleLabel } from './labels.js';
import { createSummarizer } from './summarizer.js';
import { startRemote } from './remote.js';
import { createSessionRegistry } from './sessions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const BODY_LIMIT = 1024 * 1024;
const LIVE_HEARTBEAT_MS = 30_000;
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
  summarizer = null,
  now = Date.now,
  tickMs = 30_000,
  port = config.port,
  publicDir = join(ROOT, 'public'),
  remoteFactory = startRemote,
  sessionsDir,
  liveMs = 3000,
} = {}) {
  const registry = createSessionRegistry(sessionsDir ? { dir: sessionsDir } : {});
  const state = createState(config);
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

  function handleEvent(ev) {
    if (ev.type === 'live' && ev.liveStatus === 'gone') {
      applyEvent(state, ev, ev.ts);
      broadcast();
      return;
    }
    // 이 PC의 세션은 등록 정보에서 이름을 찾는다(원격 이벤트는 수집기가 이름을 실어 보낸다)
    ev.sessionName ??= ev.host ? undefined : registry.nameOf(ev.sessionId);
    if (!matchProject(config, ev.cwd, ev.host, ev.sessionName)) return; // 지정하지 않은 폴더: 상태·추적·브로드캐스트 모두 만들지 않는다
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
      handleEvent(ev);
      res.writeHead(204).end();
    });
    req.on('error', () => res.writeHead(400).end());
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
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && pathname === '/event') {
      if (req.headers.origin) return res.writeHead(403).end();
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return res.writeHead(415).end();
      return readBody(req, res);
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
  const liveKnown = new Map(); // sessionId -> { status, at }
  function pollLive() {
    const t = now();
    const seen = new Set();
    for (const s of registry.liveSessions()) {
      seen.add(s.sessionId);
      const prev = liveKnown.get(s.sessionId);
      if (prev && prev.status === s.status && t - prev.at < LIVE_HEARTBEAT_MS) continue;
      liveKnown.set(s.sessionId, { status: s.status, at: t });
      handleEvent({ sessionId: s.sessionId, cwd: s.cwd ?? '/', sessionName: s.name, type: 'live', liveStatus: s.status ?? 'idle', ts: t });
    }
    for (const id of [...liveKnown.keys()]) {
      if (seen.has(id)) continue;
      liveKnown.delete(id);
      handleEvent({ sessionId: id, cwd: '/', type: 'live', liveStatus: 'gone', ts: t });
    }
  }
  const liveTimer = setInterval(pollLive, liveMs);
  liveTimer.unref();

  const timer = setInterval(() => {
    tick(state, now());
    for (const k of [...seqs.keys()]) if (!state.sessions.has(k.split('|')[0])) seqs.delete(k); // 사라진 세션의 추적 상태 정리
    broadcast();
  }, tickMs);
  timer.unref();

  await new Promise((r) => server.listen(port, HOST, r));
  pollLive();

  // 원격 PC: 읽기 전용으로 세션 기록을 받아 같은 이벤트로 흘려 넣는다
  const remotes = (config.remotes ?? []).map((remote) => remoteFactory({ remote, onEvent: handleEvent }));

  return {
    port: server.address().port,
    host: HOST,
    stats: () => ({ seqs: seqs.size, sessions: state.sessions.size, remotes: remotes.map((r) => r.status()) }),
    close() {
      clearInterval(timer);
      clearInterval(liveTimer);
      for (const r of remotes) r.stop();
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
  const srv = await startServer({ config, summarizer: createSummarizer() });
  console.log(`Claude Office: http://localhost:${srv.port}  (프로젝트 ${config.projects.length}개)`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => srv.close().then(() => process.exit(0)));
}
