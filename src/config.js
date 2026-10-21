import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const DEFAULTS = { port: 9410, offAfterMinutes: 10, maxMembers: 4, celebrateAfterSeconds: 30 };
const MAX_PROJECTS = 5;
const PALETTE = ['#e8637a', '#2a7f8f', '#8fb339', '#d9822b', '#6c63d9'];

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

function validateProjects(list) {
  if (list.length > MAX_PROJECTS) throw new Error(`프로젝트는 최대 ${MAX_PROJECTS}개까지 지정할 수 있습니다`);
  const names = new Set();
  const paths = new Set();
  return list.map((p, i) => {
    if (!p.name) throw new Error(`projects[${i}]에 name이 없습니다`);
    if (!p.path) throw new Error(`projects[${i}]에 path가 없습니다`);
    const path = trimSlash(p.path);
    if (names.has(p.name) || paths.has(path)) throw new Error(`프로젝트 이름 또는 경로가 중복입니다: ${p.name}`);
    names.add(p.name);
    paths.add(path);
    return { name: p.name, path, color: p.color ?? PALETTE[i % PALETTE.length] };
  });
}

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const config = { ...DEFAULTS, ...raw, projects: validateProjects(raw.projects ?? []) };
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
  validateProjects([...list, added]);
  writeFileSync(path, JSON.stringify({ ...raw, projects: [...list, added] }, null, 2) + '\n');
  return added;
}

export function matchProject(config, cwd) {
  const dir = trimSlash(cwd);
  let best = null;
  for (const p of config.projects) {
    const hit = dir === p.path || dir.startsWith(p.path === '/' ? '/' : p.path + '/');
    if (hit && (!best || p.path.length > best.path.length)) best = p;
  }
  return best;
}
