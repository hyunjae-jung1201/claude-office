import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const DEFAULTS = { port: 9410, offAfterMinutes: 10, maxMembers: 4, celebrateAfterSeconds: 30 };
const MAX_PROJECTS = 5;
const PALETTE = ['#e8637a', '#2a7f8f', '#8fb339', '#d9822b', '#6c63d9'];

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

function validateRemotes(list) {
  const names = new Set();
  return list.map((r, i) => {
    if (!r.name) throw new Error(`remotes[${i}]에 name이 없습니다`);
    if (!r.ssh) throw new Error(`remotes[${i}]에 ssh(사용자@주소)가 없습니다`);
    if (names.has(r.name)) throw new Error(`remote 이름이 중복입니다: ${r.name}`);
    names.add(r.name);
    return { name: r.name, ssh: r.ssh, key: r.key ?? '~/.ssh/claude_office_ed25519' };
  });
}

function validateProjects(list, remotes = []) {
  if (list.length > MAX_PROJECTS) throw new Error(`프로젝트는 최대 ${MAX_PROJECTS}개까지 지정할 수 있습니다`);
  const remoteNames = new Set(remotes.map((r) => r.name));
  const names = new Set();
  const paths = new Set();
  const aliasKeys = new Map();
  return list.map((p, i) => {
    if (!p.name) throw new Error(`projects[${i}]에 name이 없습니다`);
    if (!p.path) throw new Error(`projects[${i}]에 path가 없습니다`);
    if (p.host && !remoteNames.has(p.host)) throw new Error(`프로젝트 ${p.name}의 host(${p.host})가 remotes에 정의돼 있지 않습니다`);
    const path = trimSlash(p.path);
    const pathKey = `${p.host ?? ''}|${path}`;
    if (names.has(p.name) || paths.has(pathKey)) throw new Error(`프로젝트 이름 또는 경로가 중복입니다: ${p.name}`);
    names.add(p.name);
    paths.add(pathKey);
    const out = { name: p.name, path, color: p.color ?? PALETTE[i % PALETTE.length] };
    if (p.host) out.host = p.host;
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

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const remotes = validateRemotes(raw.remotes ?? []);
  const config = { ...DEFAULTS, ...raw, remotes, projects: validateProjects(raw.projects ?? [], remotes) };
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
export function matchProject(config, cwd, host = null, sessionName = undefined) {
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
