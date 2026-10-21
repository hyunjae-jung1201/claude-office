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

export function createState(config) {
  return { config, sessions: new Map() };
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
  if (ev.type === 'tool') setStatus(m, ev.category);
  else if (ev.type === 'wait') setStatus(m, 'wait');
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
      setStatus(s, 'read', '요청 파악 중');
      break;
    case 'tool':
      s.finishedAt = null;
      s.busySince ??= ts;
      s.openTools += 1;
      setStatus(s, ev.category);
      break;
    case 'toolDone':
      s.openTools = Math.max(0, s.openTools - 1);
      if (s.status === 'wait') setStatus(s, ev.category);
      break;
    case 'wait':
      setStatus(s, 'wait');
      break;
    case 'stop': {
      s.openTools = 0;
      if (s.members.size > 0) {
        setStatus(s, 'idle', WAITING_FOR_AGENTS);
        break;
      }
      const worked = s.busySince != null && ts - s.busySince >= state.config.celebrateAfterSeconds * 1000;
      s.finishedAt = worked ? ts : null;
      s.busySince = null;
      setStatus(s, 'idle');
      break;
    }
    default:
  }
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

export function snapshot(state, now) {
  const { projects, maxMembers } = state.config;
  const teams = projects.map((p) => {
    let latest = null;
    for (const s of state.sessions.values()) {
      if (s.project === p.name && (!latest || s.lastEventAt > latest.lastEventAt)) latest = s;
    }
    if (!latest) {
      return { name: p.name, color: p.color, status: 'off', label: DEFAULT_LABEL.off, members: [], overflow: 0, finishedAt: null };
    }
    const all = [...latest.members.values()].sort((a, b) => a.startedAt - b.startedAt);
    // 응답은 끝났지만 백그라운드 명령이 도는 중이면 서버실에서 일하는 것으로 보여 준다
    const background = latest.live === 'shell' && latest.status === 'idle';
    return {
      name: p.name,
      color: p.color,
      status: background ? 'run' : latest.status,
      label: background ? BACKGROUND_LABEL : latest.label,
      members: all.slice(0, maxMembers).map((m) => ({ id: m.id, type: m.type, status: m.status, label: m.label, startedAt: m.startedAt })),
      overflow: Math.max(0, all.length - maxMembers),
      finishedAt: latest.finishedAt,
    };
  });
  return { ts: now, teams };
}
