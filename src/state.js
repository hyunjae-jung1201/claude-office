import { matchProject } from './config.js';

const MIN = 60 * 1000;
const OPEN_TOOL_FACTOR = 6; // 진행 중 도구가 있으면 off 판정을 6배 늦춘다

export const DEFAULT_LABEL = {
  read: '파일 읽는 중',
  write: '코드 작성 중',
  run: '명령 실행 중',
  wait: '승인 기다리는 중',
  idle: '다음 지시 기다리는 중',
  off: '자는 중',
};
const WAITING_FOR_AGENTS = '하위 에이전트 기다리는 중';
const BACKGROUND_LABEL = '백그라운드 작업 중';

export const ROLE_LINGER_MS = 8000; // 검토가 끝난 역할자가 화면에 남아 있는 시간
const HISTORY_LIMIT = 20;
export const RESPONSE_WAIT_MS = 5 * 60 * 1000; // 턴이 끝난 뒤 이 시간 동안은 응답 대기실에서 사용자의 응답을 기다리고, 지나면 휴게실로 간다
const DEFAULT_ROOM = { read: 'library', write: 'work', run: 'server', wait: 'response', idle: 'lounge', off: 'lounge' };
const RESPONSE_LABEL = '응답 기다리는 중';
const LIMIT_NOTICE = '오늘 검토 한도에 도달했습니다';

export function createState(config) {
  return { config, sessions: new Map(), roleActivity: new Map(), badges: new Map(), history: [], notice: null };
}

export const teamOfSession = (state, sessionId) => state.sessions.get(sessionId)?.project;

const reviewSummary = (r) => ({
  id: r.id, repoRoot: r.repoRoot, host: r.host, repoName: r.repoName, team: r.team, verdict: r.verdict, concerns: r.concerns, at: r.finishedAt,
  summary: r.results.find((x) => x.verdict !== 'ok')?.summary || '문제 없음',
});

// 역할자 검토 이벤트(스케줄러)를 화면 상태에 반영한다
export function applyReviewEvent(state, ev, now) {
  const acts = ev.team ? state.roleActivity : null;
  switch (ev.type) {
    case 'start':
      if (acts) {
        // 테스터·기록원 같은 job 아바타는 역할자 검토가 시작돼도 그대로 둔다
        const jobs = [...(acts.get(ev.team)?.entries() ?? [])].filter(([, e]) => e.job);
        acts.set(ev.team, new Map([...jobs, ...ev.roles.map((r) => [r.id, { id: r.id, name: r.name, color: r.color, status: 'running', label: '검토 중', doneAt: 0 }])]));
      }
      break;
    case 'job': {
      if (!acts || !ev.team) break;
      let m = acts.get(ev.team);
      if (!m) acts.set(ev.team, (m = new Map()));
      let e = m.get(ev.id);
      if (!e) {
        if (!ev.name) break; // 모르는 job 의 상태 갱신
        e = { id: ev.id, name: ev.name, color: ev.color ?? '#8a94a6', room: ev.room, job: true, status: 'running', label: '', doneAt: 0 };
        m.set(ev.id, e);
      }
      e.status = ev.status ?? e.status;
      e.label = String(ev.label ?? e.label).slice(0, 30);
      e.doneAt = e.status === 'running' ? 0 : now;
      break;
    }
    case 'role': {
      const entry = acts?.get(ev.team)?.get(ev.roleId);
      if (!entry) break;
      entry.status = ev.status;
      if (ev.status !== 'running') {
        entry.label = ev.status === 'failed' ? '검토 실패' : (ev.summary || '검토 끝').slice(0, 30);
        entry.doneAt = now;
      }
      break;
    }
    case 'done': {
      const r = ev.review;
      state.history = [reviewSummary(r), ...state.history].slice(0, HISTORY_LIMIT);
      if (ev.team) {
        state.badges.set(ev.team, { verdict: r.verdict, concerns: r.concerns, at: now });
        for (const e of acts.get(ev.team)?.values() ?? []) if (e.status === 'running' && !e.job) { e.status = 'done'; e.doneAt = now; }
      }
      state.notice = null;
      break;
    }
    case 'skipped':
      if (ev.reason === 'limit') state.notice = LIMIT_NOTICE;
      break;
    default:
  }
}

// 서버 시작 때 저장된 검토(최근순)에서 목록과 팀 배지를 복원한다
export function setReviewHistory(state, reviews) {
  const valid = reviews.filter((r) => r && Array.isArray(r.results));
  state.history = valid.slice(0, HISTORY_LIMIT).map(reviewSummary);
  for (const r of valid) {
    if (r.team && !state.badges.has(r.team)) state.badges.set(r.team, { verdict: r.verdict, concerns: r.concerns, at: r.finishedAt });
  }
}

function sessionFor(state, ev, project) {
  let s = state.sessions.get(ev.sessionId);
  if (!s) {
    s = {
      sessionId: ev.sessionId,
      project: project.name,
      status: 'idle',
      label: DEFAULT_LABEL.idle,
      lastEventAt: ev.ts,
      busySince: null,
      openTools: 0,
      activity: null,
      awaiting: false, // 턴이 끝나 사용자의 응답(다음 지시)을 기다리는 중
      idleAt: ev.ts,
      finishedAt: null,
      members: new Map(),
    };
    state.sessions.set(ev.sessionId, s);
  }
  return s;
}

function setStatus(target, status, label) {
  target.status = status;
  target.label = label ?? DEFAULT_LABEL[status];
}

function applyMemberEvent(s, ev) {
  const m = s.members.get(ev.agentId);
  if (!m) return;
  if (ev.type === 'tool') { setStatus(m, ev.category); m.activity = ev.activity ?? null; }
  else if (ev.type === 'wait') { setStatus(m, 'wait'); m.activity = ev.activity ?? null; }
  else if (ev.type === 'toolDone' && m.status === 'wait') setStatus(m, ev.category);
}

export function applyEvent(state, ev, now) {
  // 세션이 사라졌다는 신호는 팀에 맞는지와 상관없이 그 세션을 지운다
  if (ev.type === 'live' && ev.liveStatus === 'gone') {
    state.sessions.delete(ev.sessionId);
    return;
  }
  const project = matchProject(state.config, ev.cwd, ev.host, ev.sessionName);
  if (!project) return;
  const ts = ev.ts ?? now;

  if (ev.type === 'end') {
    state.sessions.delete(ev.sessionId);
    return;
  }
  const s = sessionFor(state, { ...ev, ts }, project);
  s.lastEventAt = ts;

  if (ev.type === 'live') {
    // 세션 등록 정보: 살아 있음을 알리고(하트비트), 백그라운드 명령이 도는 중인지(shell)를 기록한다
    s.live = ev.liveStatus;
    return;
  }

  if (ev.type === 'agentStart') {
    const m = { id: ev.agentId, type: ev.agentType ?? 'agent', startedAt: ts };
    setStatus(m, 'write', '작업 시작 중');
    s.members.set(ev.agentId, m);
    s.awaiting = false;
    return;
  }
  if (ev.type === 'agentStop') {
    s.members.delete(ev.agentId);
    if (s.status === 'idle' && s.members.size === 0 && s.label === WAITING_FOR_AGENTS) s.label = DEFAULT_LABEL.idle;
    return;
  }
  if (ev.agentId) {
    applyMemberEvent(s, ev);
    return;
  }

  switch (ev.type) {
    case 'start':
      setStatus(s, 'idle');
      break;
    case 'prompt':
      s.finishedAt = null;
      s.busySince ??= ts;
      s.activity = 'work'; // 요청 파악은 읽기가 아니라 팀 책상에서 시작한다(곧 쓸 도구의 방으로 이동)
      s.awaiting = false;
      setStatus(s, 'read', '요청 파악 중');
      break;
    case 'tool':
      s.finishedAt = null;
      s.busySince ??= ts;
      s.openTools += 1;
      s.activity = ev.activity ?? null;
      s.awaiting = false;
      setStatus(s, ev.category);
      break;
    case 'toolDone':
      s.openTools = Math.max(0, s.openTools - 1);
      if (s.status === 'wait') { s.activity = null; setStatus(s, ev.category); }
      break;
    case 'wait':
      s.activity = ev.activity ?? null;
      s.awaiting = false;
      setStatus(s, 'wait');
      break;
    case 'stop': {
      s.openTools = 0;
      if (s.members.size > 0) {
        setStatus(s, 'idle', WAITING_FOR_AGENTS);
        s.awaiting = false;
        break;
      }
      s.awaiting = true;
      const worked = s.busySince != null && ts - s.busySince >= state.config.celebrateAfterSeconds * 1000;
      s.finishedAt = worked ? ts : null;
      s.busySince = null;
      setStatus(s, 'idle');
      break;
    }
    default:
  }
  // 쉬기 시작한 시각(지시 대기 구역 → 휴게실 전환 기준). 다시 일하면 초기화한다.
  if (s.status === 'idle') s.idleAt ??= ts; else s.idleAt = null;
}

export function tick(state, now) {
  const base = state.config.offAfterMinutes * MIN;
  for (const [id, s] of state.sessions) {
    const window = s.openTools > 0 ? base * OPEN_TOOL_FACTOR : base;
    if (now - s.lastEventAt > window) state.sessions.delete(id);
  }
}

export function setLabel(state, sessionId, agentId, label) {
  const s = state.sessions.get(sessionId);
  if (!s) return;
  const target = agentId ? s.members.get(agentId) : s;
  if (target) target.label = label;
}

// 팀장이 지금 있을 방: 백그라운드 작업은 서버실, 쉬는 중은 지시 대기 구역(오래 쉬면 휴게실), 그 밖에는 하는 일의 종류
function leaderRoom(s, background, now, waitMs) {
  if (background) return 'server';
  if (s.status === 'idle') return s.awaiting && now - (s.idleAt ?? now) <= waitMs ? 'response' : 'lounge';
  return s.activity ?? DEFAULT_ROOM[s.status];
}
const memberRoom = (m) => m.activity ?? DEFAULT_ROOM[m.status];

export function snapshot(state, now) {
  const { projects, maxMembers } = state.config;
  const teams = projects.map((p) => {
    let latest = null;
    for (const s of state.sessions.values()) {
      if (s.project === p.name && (!latest || s.lastEventAt > latest.lastEventAt)) latest = s;
    }
    const roleAct = state.roleActivity.get(p.name);
    const roles = roleAct
      ? [...roleAct.values()].filter((r) => r.status === 'running' || now - r.doneAt <= ROLE_LINGER_MS).map(({ id, name, color, status, label, room }) => ({ id, name, color, status, label, ...(room ? { room } : {}) }))
      : [];
    const badge = state.badges.get(p.name) ?? null;
    if (!latest) {
      return { name: p.name, color: p.color, status: 'off', label: DEFAULT_LABEL.off, room: 'lounge', members: [], overflow: 0, finishedAt: null, roles, badge };
    }
    const all = [...latest.members.values()].sort((a, b) => a.startedAt - b.startedAt);
    // 응답은 끝났지만 백그라운드 명령이 도는 중이면 서버실에서 일하는 것으로 보여 준다
    const background = latest.live === 'shell' && latest.status === 'idle';
    const room = leaderRoom(latest, background, now, (state.config.responseWaitMinutes ?? 5) * 60 * 1000);
    return {
      name: p.name,
      color: p.color,
      status: background ? 'run' : latest.status,
      label: background ? BACKGROUND_LABEL : room === 'response' && latest.status === 'idle' ? RESPONSE_LABEL : latest.label,
      room,
      members: all.slice(0, maxMembers).map((m) => ({ id: m.id, type: m.type, status: m.status, label: m.label, room: memberRoom(m), startedAt: m.startedAt })),
      overflow: Math.max(0, all.length - maxMembers),
      finishedAt: latest.finishedAt,
      roles,
      badge,
    };
  });
  return { ts: now, teams, reviews: state.history, reviewNotice: state.notice ?? undefined };
}
