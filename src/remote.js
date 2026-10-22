// 원격 PC의 Claude Code 세션 기록을 SSH로 읽어(읽기 전용) 사무실 이벤트로 바꾼다.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { toolCategory, maskDetail, USER_WAIT_TOOLS, EDIT_TOOLS } from './events.js';
import { maskSecrets } from './mask.js';
import { minimalEnv } from './env.js';

const TAIL_SCRIPT = readFileSync(new URL('./remote-tail.cjs', import.meta.url), 'utf8');
const TAIL_PATH = fileURLToPath(new URL('./remote-tail.cjs', import.meta.url));
const WORKING_AGE_S = 30; // init 때 이 시간 안에 움직인 세션은 일하는 중으로 본다
const KINDS = new Set(['init', 'prompt', 'tool', 'result', 'stop', 'live', 'astart', 'atool', 'astop']);
const NOT_A_PROMPT = /^<(task-notification|system-reminder|command-)/;

const expandHome = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const str = (v) => (typeof v === 'string' && v ? v : undefined);

export function buildSshArgs(remote) {
  return [
    '-i', expandHome(remote.key ?? '~/.ssh/claude_office_ed25519'),
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes', // 비밀번호를 묻지 않는다(키 전용)
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10',
    remote.ssh,
    'node', '-',
  ];
}

function toolEvents(tools, base, ctx, agent = {}) {
  if (ctx.tools.size > 1000) ctx.tools.clear();
  return tools.map((t) => {
    const category = toolCategory(t.n);
    if (t.i) ctx.tools.set(t.i, category);
    if (USER_WAIT_TOOLS[t.n]) return { ...base, type: 'wait', waitKind: USER_WAIT_TOOLS[t.n], ...agent };
    // 편집 도구의 경로 원문(서버 안에서 git 저장소를 찾는 데만 쓰인다)
    const filePath = EDIT_TOOLS.has(t.n) && typeof t.d === 'string' && t.d.startsWith('/') && t.d.length <= 1000 ? t.d : undefined;
    return { ...base, type: 'tool', category, toolName: t.n, filePath, detail: maskDetail(t.d), ...agent };
  });
}

// p: remote-tail.cjs가 내보낸 한 줄. ctx: { tools: Map(id→category), seen: Set(sessionId) }
export function projectionToEvents(p, ctx, now) {
  if (!p || typeof p !== 'object') return [];
  const sessionId = str(p.s);
  const cwd = str(p.c);
  if (!sessionId || !cwd || !KINDS.has(p.k)) return [];
  if (p.k === 'tool' && !Array.isArray(p.tools)) return [];
  if (p.k === 'result' && !Array.isArray(p.ids)) return [];
  if (p.k === 'atool' && !Array.isArray(p.tools)) return [];

  const base = { sessionId, cwd, ts: now, ...(str(p.n) ? { sessionName: p.n } : {}) };
  if (p.k === 'live') return str(p.st) ? [{ ...base, type: 'live', liveStatus: p.st }] : [];

  const out = [];
  if (!ctx.seen.has(sessionId)) {
    ctx.seen.add(sessionId);
    out.push({ ...base, type: 'start' });
  } else if (p.k === 'init' && !(p.last && p.age < WORKING_AGE_S)) {
    return []; // 재접속 때 이미 알고 있는 세션: 일하는 중이 아니면 건드리지 않는다
  }

  switch (p.k) {
    case 'init':
      if (p.last === 'tool' && Array.isArray(p.tools) && p.age < WORKING_AGE_S) out.push(...toolEvents(p.tools, base, ctx));
      else if ((p.last === 'prompt' || p.last === 'result') && p.age < WORKING_AGE_S) out.push({ ...base, type: 'prompt' });
      break;
    case 'prompt':
      if (NOT_A_PROMPT.test(p.p ?? '')) return out;
      out.push({ ...base, type: 'prompt', promptText: str(p.p) ? maskSecrets(p.p).slice(0, 300) : undefined });
      break;
    case 'tool':
      out.push(...toolEvents(p.tools, base, ctx));
      break;
    case 'result':
      for (const id of p.ids) {
        out.push({ ...base, type: 'toolDone', category: ctx.tools.get(id) ?? 'write' });
        ctx.tools.delete(id);
      }
      break;
    case 'stop':
      out.push({ ...base, type: 'stop', assistantText: str(p.a) ? maskSecrets(p.a).slice(0, 2000) : undefined });
      break;
    case 'astart':
      if (str(p.a)) out.push({ ...base, type: 'agentStart', agentId: p.a, agentType: str(p.t) });
      break;
    case 'atool':
      if (str(p.a)) out.push(...toolEvents(p.tools, base, ctx, { agentId: p.a, agentType: str(p.t) }));
      break;
    case 'astop':
      if (str(p.a)) out.push({ ...base, type: 'agentStop', agentId: p.a });
      break;
    default:
  }
  return out;
}

// 수집기 공통: 자식 프로세스(원격 ssh 또는 이 PC의 node)가 내보내는 한 줄 JSON을 이벤트로 바꿔 넘기고, 끊기면 점점 늦춰 가며 다시 연결한다.
function runCollector({ label, launch, feed, decorate, onEvent, now, retryMs, log }) {
  const ctx = { tools: new Map(), seen: new Set() };
  let child = null;
  let timer = null;
  let stopped = false;
  let status = 'connecting';
  let delay = retryMs[0];
  let lastError = '';

  function connect() {
    if (stopped) return;
    status = 'connecting';
    child = launch();
    child.stdin?.on?.('error', () => {});
    if (feed !== null) child.stdin?.end?.(feed);
    child.stderr?.on('data', (d) => { lastError = String(d).trim().slice(0, 200); });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let p;
      try { p = JSON.parse(line); } catch { return; }
      if (p?.k === 'hello' && status !== 'connected') {
        status = 'connected';
        delay = retryMs[0];
        log.log?.(`Claude Office: ${label} 연결됨`);
      }
      for (const ev of projectionToEvents(p, ctx, now())) onEvent(decorate(ev));
    });
    const onEnd = () => {
      if (child === null) return;
      child = null;
      status = 'down';
      if (stopped) return;
      log.error?.(`Claude Office: ${label} 연결 끊김${lastError ? ` (${lastError})` : ''}, ${Math.round(delay / 1000)}초 뒤 재시도`);
      timer = setTimeout(connect, delay);
      timer.unref?.();
      delay = Math.min(delay * 2, retryMs[1]);
    };
    child.on('error', (e) => { lastError = e.message; onEnd(); });
    child.on('close', onEnd);
  }

  connect();
  return {
    status: () => status,
    stop() {
      stopped = true;
      clearTimeout(timer);
      child?.kill();
    },
  };
}

// 다른 PC: SSH로 원격 스크립트를 띄운다(읽기 전용).
export function startRemote({ remote, onEvent, spawnFn = spawn, now = Date.now, retryMs = [3000, 30000], log = console }) {
  return runCollector({
    label: `원격 ${remote.name}`,
    launch: () => spawnFn('ssh', buildSshArgs(remote), { stdio: ['pipe', 'pipe', 'pipe'] }),
    feed: TAIL_SCRIPT,
    decorate: (ev) => ({ ...ev, host: remote.name, source: 'transcript' }),
    onEvent, now, retryMs, log,
  });
}

// 이 PC: hook이 없는 세션(hook 설치 전에 시작된 세션)과 하위 에이전트를 세션 기록(~/.claude/projects)으로 읽는다.
export function startLocalTail({ onEvent, spawnFn = spawn, now = Date.now, retryMs = [3000, 30000], log = console, env = {} } = {}) {
  return runCollector({
    label: '이 PC 세션 기록',
    launch: () => spawnFn(process.execPath, [TAIL_PATH], { stdio: ['ignore', 'pipe', 'pipe'], env: minimalEnv({ INCLUDE_TEXT: '1', ...env }) }),
    feed: null,
    decorate: (ev) => ({ ...ev, source: 'transcript' }),
    onEvent, now, retryMs, log,
  });
}
