// 언제 검토를 시작할지 정한다. 서버로 들어오는 모든 이벤트(화면 팀에 안 맞는 것 포함)를 받아 세션별로 모은다.
import { EDIT_TOOLS } from '../events.js';
import { gitHead } from './context.js';

const REQUESTS_MAX = 5;
const MIN = 60_000;
const EDITS_MAX = 100; // 세션당 보관하는 수정 기록 수(오래된 것부터 버림)
const SESSION_TTL_MS = 6 * 60 * MIN; // 이보다 오래 조용하고 보류 중인 검토가 없는 세션 상태는 버린다

export function createReviewTracker({ config, now = Date.now, groupFiles, onDue, quietMs = 30_000, headOf = gitHead }) {
  const sessions = new Map();
  const repoLast = new Map(); // 저장소 루트(원격은 host:경로) -> 마지막 검토 시작 시각
  const lastKey = (repoRoot, host) => (host ? `${host}:${repoRoot}` : repoRoot);
  const reviewableHost = (host) => config.remotes?.some((r) => r.name === host && r.review === true);

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
  const cooledDown = (repoRoot, host) => {
    const last = repoLast.get(lastKey(repoRoot, host));
    return last === undefined || now() - last >= settingsFor(repoRoot).cooldownMs;
  };

  // git 저장소가 아닌 파일이 화면에 올린(이 PC의) 팀 폴더 안이면 그 폴더를 검토 단위로 삼는다. 가장 긴 경로가 우선.
  const teamFolderOf = (file, host) => {
    let best = null;
    for (const p of config.projects ?? []) {
      if ((p.host ?? null) !== (host ?? null) || typeof p.path !== 'string') continue;
      const root = p.path.replace(/\/+$/, '');
      if (root && file.startsWith(root + '/') && (!best || root.length > best.length)) best = root;
    }
    return best;
  };

  function sessionOf(ev) {
    let s = sessions.get(ev.sessionId);
    if (!s) {
      s = { files: new Set(), edits: [], requests: [], lastResponse: '', lastActivity: now(), agents: new Set(), pending: new Set(), bases: new Map() };
      sessions.set(ev.sessionId, s);
    }
    return s;
  }

  // 모인 파일을 저장소별로 나눠, 조건이 맞는 저장소마다 due 를 낸다. onlyPending 이면 보류 중인 저장소만.
  // 같은 세션의 평가는 한 줄로 세운다(await 사이에 stop·tick·수동 검토가 겹쳐 같은 파일을 두 번 내보내지 않게)
  function evaluate(sessionId, s, reason, opts) {
    const run = (s.lock ?? Promise.resolve()).then(() => evaluateNow(sessionId, s, reason, opts));
    s.lock = run.catch(() => {});
    return run;
  }

  async function evaluateNow(sessionId, s, reason, { onlyPending = false, ignoreCooldown = false, ignoreMin = false, inPath = null } = {}) {
    // 원격 PC 의 파일은 이 PC 의 파일 시스템으로 저장소를 찾지 않는다(같은 경로의 다른 파일일 수 있다)
    const groups = s.host ? new Map() : await groupFiles([...s.files]);
    // git 저장소가 아니어도 팀 폴더 안이면 Claude 의 수정 기록으로 검토한다(editGroups). 둘 다 아니면 계속 쌓이지 않게 버린다
    const inRepo = new Set([...groups.values()].flat());
    const editRoots = new Set();
    for (const f of [...s.files]) {
      if (inRepo.has(f)) continue;
      const root = teamFolderOf(f, s.host);
      if (!root) { s.files.delete(f); continue; }
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(f);
      editRoots.add(root);
    }
    let fired = 0;
    for (const [repoRoot, files] of groups) {
      if (inPath && !inPath(repoRoot)) continue;
      if (isExcluded(repoRoot)) { for (const f of files) s.files.delete(f); if (editRoots.has(repoRoot)) s.edits = s.edits.filter((e) => !files.includes(e.file)); continue; }
      if (onlyPending && !s.pending.has(repoRoot)) continue;
      if (!ignoreMin && files.length < settingsFor(repoRoot).minWrites) continue;
      if (!ignoreCooldown && !cooledDown(repoRoot, s.host)) { s.pending.add(repoRoot); continue; }
      repoLast.set(lastKey(repoRoot, s.host), now());
      s.pending.delete(repoRoot);
      for (const f of files) s.files.delete(f);
      fired++;
      const baseSha = s.bases.get(repoRoot) ?? undefined;
      s.bases.delete(repoRoot);
      const job = { repoRoot, ...(s.host ? { host: s.host } : {}), sessionId, files, requests: [...s.requests], lastResponse: s.lastResponse, reason, baseSha };
      if (editRoots.has(repoRoot)) {
        const mine = new Set(files);
        job.edits = s.edits.filter((e) => mine.has(e.file));
        s.edits = s.edits.filter((e) => !mine.has(e.file));
      }
      onDue(job);
    }
    if (fired) s.requests = [];
    s.edits = s.edits.filter((e) => s.files.has(e.file)); // 검토가 끝났거나 버려진 파일의 수정 기록은 지운다
    return fired;
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
      if (!config.roles?.enabled || !ev || typeof ev !== 'object' || !ev.sessionId || ev.type === 'live') return;
      if (ev.host && !reviewableHost(ev.host)) return; // 원격은 review 를 켠 PC 만
      const s = sessionOf(ev);
      if (ev.host) s.host = ev.host;
      s.lastActivity = now();
      switch (ev.type) {
        case 'prompt':
          if (ev.promptText) s.requests = [...s.requests, ev.promptText].slice(-REQUESTS_MAX);
          break;
        case 'tool':
          if (ev.filePath && EDIT_TOOLS.has(ev.toolName)) {
            s.files.add(ev.filePath);
            if (ev.edit) s.edits = [...s.edits, ev.edit].slice(-EDITS_MAX);
            if (!s.host) await recordBase(s, ev.filePath);
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

    // "지금 검토": 그 팀 폴더(projectPath, host)에 모여 있는 변경을 쿨다운·최소 수정 수와 상관없이 바로 검토한다. 시작한 검토 수를 돌려준다.
    async reviewNow(projectPath, host) {
      const root = String(projectPath).replace(/\/+$/, '');
      const inPath = (r) => r === root || r.startsWith(root + '/');
      let n = 0;
      for (const [id, s] of [...sessions]) {
        if ((s.host ?? null) !== (host ?? null) || s.files.size === 0) continue;
        n += await evaluate(id, s, 'manual', { ignoreCooldown: true, ignoreMin: true, inPath });
      }
      return n;
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
