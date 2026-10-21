// 원격 PC의 Claude Code 세션 기록을 SSH로 읽어(읽기 전용) 사무실 이벤트로 바꾼다.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { toolCategory, maskDetail, USER_WAIT_TOOLS } from './events.js';

const TAIL_SCRIPT = readFileSync(new URL('./remote-tail.cjs', import.meta.url), 'utf8');
const WORKING_AGE_S = 30; // init 때 이 시간 안에 움직인 세션은 일하는 중으로 본다
const KINDS = new Set(['init', 'prompt', 'tool', 'result', 'stop']);
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

function toolEvents(tools, base, ctx) {
  if (ctx.tools.size > 1000) ctx.tools.clear();
  return tools.map((t) => {
    const category = toolCategory(t.n);
    if (t.i) ctx.tools.set(t.i, category);
    if (USER_WAIT_TOOLS[t.n]) return { ...base, type: 'wait', waitKind: USER_WAIT_TOOLS[t.n] };
    return { ...base, type: 'tool', category, detail: maskDetail(t.d) };
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

  const base = { sessionId, cwd, ts: now, ...(str(p.n) ? { sessionName: p.n } : {}) };
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
      out.push({ ...base, type: 'prompt' });
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
      out.push({ ...base, type: 'stop' });
      break;
    default:
  }
  return out;
}

// SSH로 원격 스크립트를 띄우고, 끊기면 점점 늦춰 가며 다시 연결한다.
export function startRemote({ remote, onEvent, spawnFn = spawn, now = Date.now, retryMs = [3000, 30000], log = console }) {
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
    child = spawnFn('ssh', buildSshArgs(remote), { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    child.stdin.end(TAIL_SCRIPT);
    child.stderr.on('data', (d) => { lastError = String(d).trim().slice(0, 200); });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let p;
      try { p = JSON.parse(line); } catch { return; }
      if (p?.k === 'hello' && status !== 'connected') {
        status = 'connected';
        delay = retryMs[0];
        log.log?.(`Claude Office: 원격 ${remote.name} 연결됨`);
      }
      for (const ev of projectionToEvents(p, ctx, now())) onEvent({ ...ev, host: remote.name });
    });
    const onEnd = () => {
      if (child === null) return;
      child = null;
      status = 'down';
      if (stopped) return;
      log.error?.(`Claude Office: 원격 ${remote.name} 연결 끊김${lastError ? ` (${lastError})` : ''}, ${Math.round(delay / 1000)}초 뒤 재시도`);
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
