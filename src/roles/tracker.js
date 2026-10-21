// 언제 검토를 시작할지 정한다. 서버로 들어오는 모든 이벤트(화면 팀에 안 맞는 것 포함)를 받아 세션별로 모은다.
import { EDIT_TOOLS } from '../events.js';
import { gitHead } from './context.js';

const REQUESTS_MAX = 5;
const MIN = 60_000;
const SESSION_TTL_MS = 6 * 60 * MIN; // 이보다 오래 조용하고 보류 중인 검토가 없는 세션 상태는 버린다

export function createReviewTracker({ config, now = Date.now, groupFiles, onDue, quietMs = 30_000, headOf = gitHead }) {
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
  // 검토를 받고 싶지 않은 저장소(roles.excludePaths 아래)는 모은 파일도 버린다
  const isExcluded = (repoRoot) => (config.roles.excludePaths ?? []).some((p) => repoRoot === p || repoRoot.startsWith(p.replace(/\/+$/, '') + '/'));
  const cooledDown = (repoRoot) => {
    const last = repoLast.get(repoRoot);
    return last === undefined || now() - last >= settingsFor(repoRoot).cooldownMs;
  };

  function sessionOf(ev) {
    let s = sessions.get(ev.sessionId);
    if (!s) {
      s = { files: new Set(), requests: [], lastResponse: '', lastActivity: now(), agents: new Set(), pending: new Set(), bases: new Map() };
      sessions.set(ev.sessionId, s);
    }
    return s;
  }

  // 모인 파일을 저장소별로 나눠, 조건이 맞는 저장소마다 due 를 낸다. onlyPending 이면 보류 중인 저장소만.
  async function evaluate(sessionId, s, reason, { onlyPending = false, ignoreCooldown = false } = {}) {
    const groups = await groupFiles([...s.files]);
    // 저장소 밖(또는 검토 대상이 아닌) 파일은 계속 쌓이지 않게 버린다
    const inRepo = new Set([...groups.values()].flat());
    for (const f of [...s.files]) if (!inRepo.has(f)) s.files.delete(f);
    let fired = false;
    for (const [repoRoot, files] of groups) {
      if (isExcluded(repoRoot)) { for (const f of files) s.files.delete(f); continue; }
      if (onlyPending && !s.pending.has(repoRoot)) continue;
      if (files.length < settingsFor(repoRoot).minWrites) continue;
      if (!ignoreCooldown && !cooledDown(repoRoot)) { s.pending.add(repoRoot); continue; }
      repoLast.set(repoRoot, now());
      s.pending.delete(repoRoot);
      for (const f of files) s.files.delete(f);
      fired = true;
      const baseSha = s.bases.get(repoRoot) ?? undefined;
      s.bases.delete(repoRoot);
      onDue({ repoRoot, sessionId, files, requests: [...s.requests], lastResponse: s.lastResponse, reason, baseSha });
    }
    if (fired) s.requests = [];
  }

  // 첫 편집 직전의 HEAD 를 저장소별로 기록해 둔다(같은 턴에 커밋해도 변경을 볼 수 있게)
  async function recordBase(s, filePath) {
    try {
      const root = [...(await groupFiles([filePath])).keys()][0];
      if (!root || s.bases.has(root)) return;
      s.bases.set(root, null);
      s.bases.set(root, await headOf(root));
    } catch { /* 기준점이 없으면 HEAD 기준으로 */ }
  }

  return {
    async onEvent(ev) {
      // live(세션 등록 정보 하트비트)는 사용자 활동이 아니다: 세션 상태를 만들지도, 마지막 활동 시각을 갱신하지도 않는다
      if (!config.roles?.enabled || !ev || typeof ev !== 'object' || ev.host || !ev.sessionId || ev.type === 'live') return;
      const s = sessionOf(ev);
      s.lastActivity = now();
      switch (ev.type) {
        case 'prompt':
          if (ev.promptText) s.requests = [...s.requests, ev.promptText].slice(-REQUESTS_MAX);
          break;
        case 'tool':
          if (ev.filePath && EDIT_TOOLS.has(ev.toolName)) {
            s.files.add(ev.filePath);
            await recordBase(s, ev.filePath);
          }
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
        if (s.pending.size === 0 && now() - s.lastActivity > SESSION_TTL_MS) { sessions.delete(id); continue; }
        if (s.pending.size === 0 || now() - s.lastActivity < quietMs) continue;
        await evaluate(id, s, 'deferred', { onlyPending: true });
      }
    },

    stats: () => ({ sessions: sessions.size, files: [...sessions.values()].reduce((n, s) => n + s.files.size, 0) }),
    pendingCount: () => [...sessions.values()].reduce((n, s) => n + s.pending.size, 0),
  };
}
