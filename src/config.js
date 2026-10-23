import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const AI_TOOLS = new Set(['codex']); // projects[].ai 로 팀이 될 수 있는 다른 AI 도구
const DEFAULTS = { port: 9410, offAfterMinutes: 10, maxMembers: 4, celebrateAfterSeconds: 30, responseWaitMinutes: 5 };
const MAX_PROJECTS = 6;
const PALETTE = ['#e8637a', '#2a7f8f', '#8fb339', '#d9822b', '#6c63d9', '#e5b83a'];

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

function validateRemotes(list) {
  const names = new Set();
  return list.map((r, i) => {
    if (!r.name) throw new Error(`remotes[${i}]에 name이 없습니다`);
    if (r.push !== undefined && typeof r.push !== 'boolean') throw new Error(`remotes[${i}].push는 true/false여야 합니다`);
    if (!r.ssh && r.push !== true) throw new Error(`remotes[${i}]에 ssh(사용자@주소)가 없습니다(다른 PC 가 밀어 넣는 원격이면 push: true)`);
    if (names.has(r.name)) throw new Error(`remote 이름이 중복입니다: ${r.name}`);
    names.add(r.name);
    if (r.review !== undefined && typeof r.review !== 'boolean') throw new Error(`remotes[${i}].review는 true/false여야 합니다`);
    return { name: r.name, ...(r.ssh ? { ssh: r.ssh } : {}), key: r.key ?? '~/.ssh/claude_office_ed25519', review: r.review === true, push: r.push === true };
  });
}

function validateProjects(list, remotes = []) {
  if (list.length > MAX_PROJECTS) throw new Error(`프로젝트는 최대 ${MAX_PROJECTS}개까지 지정할 수 있습니다`);
  const remoteNames = new Set(remotes.map((r) => r.name));
  const names = new Set();
  const paths = new Set();
  const aliasKeys = new Map();
  const aiTeams = new Set(); // AI 도구 팀은 PC(host)마다 도구당 하나(신호가 폴더와 상관없이 그 PC 의 팀으로 가므로)
  return list.map((p, i) => {
    if (!p.name) throw new Error(`projects[${i}]에 name이 없습니다`);
    if (!p.path && !p.ai) throw new Error(`projects[${i}]에 path가 없습니다`);
    if (p.ai !== undefined && !AI_TOOLS.has(p.ai)) throw new Error(`프로젝트 ${p.name}의 ai는 ${[...AI_TOOLS].join(', ')} 중 하나여야 합니다`);
    if (p.host && !remoteNames.has(p.host)) throw new Error(`프로젝트 ${p.name}의 host(${p.host})가 remotes에 정의돼 있지 않습니다`);
    const path = p.ai ? `ai:${p.ai}` : trimSlash(p.path); // 다른 AI 도구 팀은 폴더가 아니라 그 도구의 모든 활동을 받는다(실제 cwd 와 겹치지 않는 가짜 경로)
    const pathKey = `${p.host ?? ''}|${path}`;
    if (names.has(p.name) || paths.has(pathKey)) throw new Error(`프로젝트 이름 또는 경로가 중복입니다: ${p.name}`);
    names.add(p.name);
    paths.add(pathKey);
    const out = { name: p.name, path, color: p.color ?? PALETTE[i % PALETTE.length] };
    if (p.ai) {
      const aiKey = `${p.ai}|${p.host ?? ''}`;
      if (aiTeams.has(aiKey)) throw new Error(`ai 팀은 PC 마다 도구당 하나만 둘 수 있습니다: ${p.ai}${p.host ? ` (${p.host})` : ''} — ${p.name}`);
      aiTeams.add(aiKey);
      out.ai = p.ai;
    }
    if (p.host) out.host = p.host;
    if (p.testCommand !== undefined) {
      if (!Array.isArray(p.testCommand) || p.testCommand.length === 0 || p.testCommand.some((a) => typeof a !== 'string' || !a)) throw new Error(`프로젝트 ${p.name}의 testCommand는 비어 있지 않은 문자열 배열이어야 합니다 (예: ["npm", "test"])`);
      out.testCommand = [...p.testCommand];
    }
    if (p.testTimeoutSeconds !== undefined) {
      if (!Number.isFinite(p.testTimeoutSeconds) || p.testTimeoutSeconds < 5 || p.testTimeoutSeconds > 1800) throw new Error(`프로젝트 ${p.name}의 testTimeoutSeconds는 5~1800 사이 숫자여야 합니다`);
      out.testTimeoutSeconds = p.testTimeoutSeconds;
    }
    if (p.roles !== undefined) {
      if (!Array.isArray(p.roles) || p.roles.some((r) => typeof r !== 'string' || !r)) throw new Error(`프로젝트 ${p.name}의 roles는 역할 id 목록이어야 합니다`);
      out.roles = [...p.roles];
    }
    if (p.aliases !== undefined) {
      if (!Array.isArray(p.aliases) || p.aliases.some((a) => typeof a !== 'string' || !a)) throw new Error(`프로젝트 ${p.name}의 aliases는 문자열 목록이어야 합니다`);
      out.aliases = [...p.aliases];
    }
    // 세션 이름 별칭(팀 이름 포함)은 같은 host 안에서 중복되면 어느 팀인지 알 수 없다
    for (const a of [p.name, ...(out.aliases ?? [])]) {
      const key = `${p.host ?? ''}|${a.toLowerCase()}`;
      if (aliasKeys.has(key) && aliasKeys.get(key) !== p.name) throw new Error(`별칭이 중복입니다: ${a}`);
      aliasKeys.set(key, p.name);
    }
    return out;
  });
}

const ROLES_DEFAULTS = { enabled: true, default: ['pm', 'developer', 'qa'], cooldownMinutes: 5, minWrites: 1, dailyLimit: 120, deliver: 'report', deliverMinSeverity: 'major', excludePaths: [] };

function validateDailyLog(raw) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || typeof raw.dir !== 'string' || !raw.dir.startsWith('/')) throw new Error('dailyLog.dir는 절대 경로 문자열이어야 합니다');
  const intervalSeconds = raw.intervalSeconds ?? 120;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 3600) throw new Error('dailyLog.intervalSeconds는 10~3600 사이 숫자여야 합니다');
  return { dir: trimSlash(raw.dir), intervalSeconds };
}

function validateRolesConfig(raw = {}) {
  const roles = { ...ROLES_DEFAULTS, ...raw, projects: raw.projects ?? {} };
  const ids = (v, where) => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) throw new Error(`${where}는 역할 id 목록이어야 합니다`);
  };
  const posInt = (v, name, min) => {
    if (!Number.isFinite(v) || v < min) throw new Error(`roles.${name}는 ${min} 이상의 숫자여야 합니다`);
  };
  ids(roles.default, 'roles.default');
  ids(roles.excludePaths, 'roles.excludePaths');
  posInt(roles.cooldownMinutes, 'cooldownMinutes', 0);
  posInt(roles.minWrites, 'minWrites', 1);
  posInt(roles.dailyLimit, 'dailyLimit', 1);
  if (!['report', 'session'].includes(roles.deliver)) throw new Error('roles.deliver는 "report"(보고만) 또는 "session"(다음 프롬프트에 의견 전달)이어야 합니다');
  if (!['minor', 'major', 'critical'].includes(roles.deliverMinSeverity)) throw new Error('roles.deliverMinSeverity는 minor|major|critical 중 하나여야 합니다');
  for (const [path, v] of Object.entries(roles.projects)) {
    if (v.roles !== undefined) ids(v.roles, `roles.projects ${path}의 roles`);
    if (v.cooldownMinutes !== undefined) posInt(v.cooldownMinutes, 'projects.cooldownMinutes', 0);
    if (v.minWrites !== undefined) posInt(v.minWrites, 'projects.minWrites', 1);
  }
  return roles;
}

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const remotes = validateRemotes(raw.remotes ?? []);
  const dailyLog = validateDailyLog(raw.dailyLog);
  const config = { ...DEFAULTS, ...raw, ...(dailyLog ? { dailyLog } : {}), remotes, projects: validateProjects(raw.projects ?? [], remotes), roles: validateRolesConfig(raw.roles) };
  if (!Number.isFinite(config.responseWaitMinutes) || config.responseWaitMinutes < 0) throw new Error('responseWaitMinutes는 0 이상의 숫자여야 합니다');
  // 화면은 팀당 팀원 4명까지만 자리를 배치한다
  if (!Number.isInteger(config.maxMembers) || config.maxMembers < 1 || config.maxMembers > 4) {
    throw new Error('maxMembers는 1~4 사이의 정수여야 합니다');
  }
  return config;
}

// `/office add`: 설정 파일에 프로젝트를 추가한다. 검증을 통과한 뒤에만 파일을 쓴다.
export function addProject(path, folder, name) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const list = raw.projects ?? [];
  const folderPath = trimSlash(folder);
  const added = { name: name ?? basename(folderPath), path: folderPath, color: PALETTE[list.length % PALETTE.length] };
  validateProjects([...list, added], validateRemotes(raw.remotes ?? []));
  writeFileSync(path, JSON.stringify({ ...raw, projects: [...list, added] }, null, 2) + '\n');
  return added;
}

// host가 없으면 이 PC의 프로젝트, 있으면 그 원격 PC의 프로젝트만 후보가 된다.
// 폴더가 어느 팀에도 안 맞으면, 세션 이름이 팀 이름/별칭과 같은 팀으로 연결한다.
export function matchProject(config, cwd, host = null, sessionName = undefined, ai = undefined) {
  if (ai) { // 다른 AI 도구의 신호는 그 도구 전용 팀이 있으면 폴더와 상관없이 그 팀으로 간다
    const team = config.projects.find((p) => p.ai === ai && (p.host ?? null) === (host ?? null)); // PC 마다 자기 AI 팀이 따로 있다(이 PC 의 Codex 와 다른 PC 의 Codex 는 서로 다른 팀)
    if (team) return team;
  }
  const dir = trimSlash(cwd);
  let best = null;
  for (const p of config.projects) {
    if ((p.host ?? null) !== (host ?? null)) continue;
    const hit = dir === p.path || dir.startsWith(p.path === '/' ? '/' : p.path + '/');
    if (hit && (!best || p.path.length > best.path.length)) best = p;
  }
  if (!best && sessionName) {
    const want = sessionName.toLowerCase();
    best = config.projects.find((p) => (p.host ?? null) === (host ?? null) && [p.name, ...(p.aliases ?? [])].some((a) => a.toLowerCase() === want)) ?? null;
  }
  return best;
}
