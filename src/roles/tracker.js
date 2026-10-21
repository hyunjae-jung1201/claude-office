// 언제 검토를 시작할지 정한다. 서버로 들어오는 모든 이벤트(화면 팀에 안 맞는 것 포함)를 받아 세션별로 모은다.
import { EDIT_TOOLS } from '../events.js';

const REQUESTS_MAX = 5;
const MIN = 60_000;

export function createReviewTracker({ config, now = Date.now, groupFiles, onDue, quietMs = 30_000 }) {
  const sessions = new Map();
  const repoLast = new Map(); // 저장소 루트 -> 마지막 검토 시작 시각

  const settingsFor = (repoRoot) => {
    let best = null;
    for (const [path, v] of Object.entries(config.roles.projects ?? {})) {
      const hit = repoRoot === path || repoRoot.startsWith(path.replace(/\/+$/, '') + '/');
      if (hit && (!best || path.length > best.path.length)) best = { path, v };
    }
    return {
      minWrites: best?.v.minWrites ?? config.roles.minWrites,
      cooldownMs: (best?.v.cooldownMinutes ?? config.roles.cooldownMinutes) * MIN,
    };
  };
  const cooledDown = (repoRoot) => {
    const last = repoLast.get(repoRoot);
    return last === undefined || now() - last >= settingsFor(repoRoot).cooldownMs;
  };

  function sessionOf(ev) {
    let s = sessions.get(ev.sessionId);
    if (!s) {
      s = { files: new Set(), requests: [], lastResponse: '', lastActivity: now(), agents: new Set(), pending: new Set() };
      sessions.set(ev.sessionId, s);
    }
    return s;
  }

  // 모인 파일을 저장소별로 나눠, 조건이 맞는 저장소마다 due 를 낸다. onlyPending 이면 보류 중인 저장소만.
  async function evaluate(sessionId, s, reason, { onlyPending = false, ignoreCooldown = false } = {}) {
    const groups = await groupFiles([...s.files]);
    let fired = false;
    for (const [repoRoot, files] of groups) {
      if (onlyPending && !s.pending.has(repoRoot)) continue;
      if (files.length < settingsFor(repoRoot).minWrites) continue;
      if (!ignoreCooldown && !cooledDown(repoRoot)) { s.pending.add(repoRoot); continue; }
      repoLast.set(repoRoot, now());
      s.pending.delete(repoRoot);
      for (const f of files) s.files.delete(f);
      fired = true;
      onDue({ repoRoot, sessionId, files, requests: [...s.requests], lastResponse: s.lastResponse, reason });
    }
    if (fired) s.requests = [];
  }

  return {
    async onEvent(ev) {
      if (!config.roles?.enabled || !ev || typeof ev !== 'object' || ev.host || !ev.sessionId) return;
      const s = sessionOf(ev);
      s.lastActivity = now();
      switch (ev.type) {
        case 'prompt':
          if (ev.promptText) s.requests = [...s.requests, ev.promptText].slice(-REQUESTS_MAX);
          break;
        case 'tool':
          if (ev.filePath && EDIT_TOOLS.has(ev.toolName)) s.files.add(ev.filePath);
          break;
        case 'agentStart':
          if (ev.agentId) s.agents.add(ev.agentId);
          break;
        case 'agentStop':
          s.agents.delete(ev.agentId);
          break;
        case 'stop':
          if (ev.assistantText) s.lastResponse = ev.assistantText;
          if (s.agents.size === 0 && s.files.size > 0) await evaluate(ev.sessionId, s, 'stop');
          break;
        case 'end':
          if (s.pending.size > 0) await evaluate(ev.sessionId, s, 'deferred', { onlyPending: true, ignoreCooldown: true });
          sessions.delete(ev.sessionId);
          break;
        default:
      }
    },

    // 쿨다운이 끝났고 세션이 조용한 보류 변경을 검토한다(사용자가 작업을 멈춰도 마지막 변경이 검토되도록)
    async tick() {
      for (const [id, s] of [...sessions]) {
        if (s.pending.size === 0 || now() - s.lastActivity < quietMs) continue;
        await evaluate(id, s, 'deferred', { onlyPending: true });
      }
    },

    pendingCount: () => [...sessions.values()].reduce((n, s) => n + s.pending.size, 0),
  };
}
