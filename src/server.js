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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const BODY_LIMIT = 1024 * 1024;
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
} = {}) {
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
    applyEvent(state, ev, ev.ts);
    const key = `${ev.sessionId}|${ev.agentId ?? ''}`;
    const seq = bump(key);
    if (ev.type === 'end') for (const k of [...seqs.keys()]) if (k.startsWith(`${ev.sessionId}|`)) seqs.delete(k);
    if (ev.type === 'agentStop') seqs.delete(key);

    if (ev.type === 'tool' && matchProject(config, ev.cwd)) {
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

  const timer = setInterval(() => {
    tick(state, now());
    broadcast();
  }, tickMs);
  timer.unref();

  await new Promise((r) => server.listen(port, HOST, r));

  return {
    port: server.address().port,
    host: HOST,
    close() {
      clearInterval(timer);
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
