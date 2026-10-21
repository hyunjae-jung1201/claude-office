// 원격 PC에서 `node -` 로 실행된다(표준입력으로 이 스크립트를 보냄). Claude Code 세션 기록(jsonl)을 읽기 전용으로
// 지켜보다가, 상태 판단에 필요한 최소 필드만 한 줄 JSON으로 표준출력에 내보낸다. 파일 쓰기·설정 변경은 하지 않는다.
// Node 18에서도 동작하도록 CommonJS로 작성한다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const POLL_MS = Number(process.env.POLL_MS) || 1000;
const RECENT_MS = 10 * 60 * 1000; // 이 시간 안에 수정된 세션만 "실행 중"으로 본다
const TAIL_BYTES = 256 * 1024;
const MAX_READ = 4 * 1024 * 1024;
const SESS_DIR = process.env.CLAUDE_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions');

const files = new Map(); // 파일 경로 -> { off, rest: Buffer, cwd, sid }
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function detail(input) {
  if (!input || typeof input !== 'object') return '';
  const v = input.command || input.file_path || input.notebook_path || input.path || input.pattern || input.url || input.query || input.description;
  return typeof v === 'string' ? v.slice(0, 400) : '';
}

// 한 줄을 { k, ... } 로 줄인다. 하위 에이전트(sidechain)·메타·관심 없는 줄은 null.
function project(line, st) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  if (typeof o.cwd === 'string') st.cwd = o.cwd;
  if (typeof o.sessionId === 'string') st.sid = o.sessionId;
  if (st.sid && st.cwd) cwdBySid.set(st.sid, st.cwd);
  if (o.isSidechain || o.isMeta) return null;
  const m = o.message;
  if (!m) return null;
  if (o.type === 'user') {
    const c = m.content;
    if (typeof c === 'string') return { k: 'prompt', p: c.slice(0, 40) };
    if (Array.isArray(c)) {
      const ids = c.filter((b) => b && b.type === 'tool_result').map((b) => b.tool_use_id);
      if (ids.length) return { k: 'result', ids };
      const t = c.find((b) => b && b.type === 'text');
      if (t) return { k: 'prompt', p: String(t.text || '').slice(0, 40) };
    }
    return null;
  }
  if (o.type === 'assistant' && Array.isArray(m.content)) {
    const tools = m.content.filter((b) => b && b.type === 'tool_use').map((b) => ({ i: b.id, n: b.name, d: detail(b.input) }));
    if (tools.length) return { k: 'tool', tools };
    // 생각만 있는 end_turn 줄은 제외: 턴 종료는 텍스트가 있는 줄 하나로만 센다
    if (m.stop_reason === 'end_turn' && m.content.some((b) => b && b.type === 'text')) return { k: 'stop' };
  }
  return null;
}

let names = new Map(); // sessionId -> 세션 이름 (실행 중인 세션 등록 정보)
let registry = []; // 프로세스가 살아 있는 세션 [{ sid, name, cwd, st }]
const cwdBySid = new Map(); // 기록에서 본 가장 최근 작업 폴더
const liveSeen = new Map(); // sid -> { st, at, name, cwd } (이미 알린 상태)
const HEARTBEAT_MS = 30000;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function loadRegistry() {
  const nextNames = new Map();
  const next = [];
  let list = [];
  try { list = fs.readdirSync(SESS_DIR); } catch { names = nextNames; registry = next; return; }
  for (const f of list) {
    if (!f.endsWith('.json')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8'));
      if (!o || typeof o.sessionId !== 'string') continue;
      if (typeof o.name === 'string' && o.name) nextNames.set(o.sessionId, o.name);
      if (Number.isInteger(o.pid) && pidAlive(o.pid)) next.push({ sid: o.sessionId, name: o.name, cwd: o.cwd, st: typeof o.status === 'string' ? o.status : 'idle' });
    } catch { /* 무시 */ }
  }
  names = nextNames;
  registry = next;
}

// 상태가 바뀌었거나 30초가 지나면 live 로 알리고, 사라진 세션은 gone 으로 알린다.
function emitLive() {
  const t = Date.now();
  const present = new Set();
  for (const e of registry) {
    present.add(e.sid);
    const prev = liveSeen.get(e.sid);
    if (prev && prev.st === e.st && t - prev.at < HEARTBEAT_MS) continue;
    const c = cwdBySid.get(e.sid) || e.cwd;
    liveSeen.set(e.sid, { st: e.st, at: t, name: e.name, cwd: c });
    if (c) emit({ k: 'live', s: e.sid, c, st: e.st, ...(e.name ? { n: e.name } : {}) });
  }
  for (const [sid, prev] of [...liveSeen]) {
    if (present.has(sid)) continue;
    liveSeen.delete(sid);
    if (prev.cwd) emit({ k: 'live', s: sid, c: prev.cwd, st: 'gone', ...(prev.name ? { n: prev.name } : {}) });
  }
}

function header(file, st) {
  const s = st.sid || path.basename(file, '.jsonl');
  const n = names.get(s);
  return n ? { s, c: st.cwd, n } : { s, c: st.cwd };
}

function readRange(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function splitLines(buf) {
  const lines = [];
  let from = 0;
  let i;
  while ((i = buf.indexOf(10, from)) >= 0) {
    lines.push(buf.slice(from, i).toString('utf8'));
    from = i + 1;
  }
  return { lines, rest: buf.slice(from) };
}

function initFile(file, stat) {
  const st = { off: stat.size, rest: Buffer.alloc(0), cwd: undefined, sid: undefined };
  files.set(file, st);
  if (Date.now() - stat.mtimeMs > RECENT_MS) return;
  const start = Math.max(0, stat.size - TAIL_BYTES);
  let { lines } = splitLines(readRange(file, start, stat.size));
  if (start > 0) lines = lines.slice(1); // 잘린 첫 줄 버림
  let last = null;
  for (const l of lines) {
    const p = project(l, st);
    if (p) last = p;
  }
  if (!st.cwd) return;
  emit({ ...header(file, st), k: 'init', last: last ? last.k : null, tools: last && last.tools, age: Math.round((Date.now() - stat.mtimeMs) / 1000) });
}

function readNew(file, stat, st) {
  if (stat.size < st.off) { st.off = 0; st.rest = Buffer.alloc(0); }
  if (stat.size === st.off) return;
  let start = st.off;
  if (stat.size - start > MAX_READ) { start = stat.size - MAX_READ; st.rest = Buffer.alloc(0); }
  const { lines, rest } = splitLines(Buffer.concat([st.rest, readRange(file, start, stat.size)]));
  st.off = stat.size;
  st.rest = rest;
  for (const l of lines) {
    const p = project(l, st);
    if (p && st.cwd) emit({ ...header(file, st), ...p });
  }
}

function listFiles() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }); } catch { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let entries = [];
    try { entries = fs.readdirSync(path.join(ROOT, d.name), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(ROOT, d.name, e.name));
  }
  return out;
}

let firstScan = true;
function scan() {
  loadRegistry();
  for (const file of listFiles()) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    const st = files.get(file);
    if (!st) {
      if (firstScan) initFile(file, stat);
      else { files.set(file, { off: 0, rest: Buffer.alloc(0), cwd: undefined, sid: undefined }); readNew(file, stat, files.get(file)); }
    } else {
      readNew(file, stat, st);
    }
  }
  firstScan = false;
  emitLive();
}

emit({ k: 'hello' });
scan();
setInterval(scan, POLL_MS);
