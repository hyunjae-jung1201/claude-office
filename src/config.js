import { readFileSync } from 'node:fs';

const DEFAULTS = { port: 7410, offAfterMinutes: 10, maxMembers: 4, celebrateAfterSeconds: 30 };
const MAX_PROJECTS = 5;
const PALETTE = ['#e8637a', '#2a7f8f', '#8fb339', '#d9822b', '#6c63d9'];

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const list = raw.projects ?? [];
  if (list.length > MAX_PROJECTS) throw new Error(`프로젝트는 최대 ${MAX_PROJECTS}개까지 지정할 수 있습니다`);

  const names = new Set();
  const paths = new Set();
  const projects = list.map((p, i) => {
    if (!p.name) throw new Error(`projects[${i}]에 name이 없습니다`);
    if (!p.path) throw new Error(`projects[${i}]에 path가 없습니다`);
    const path = trimSlash(p.path);
    if (names.has(p.name) || paths.has(path)) throw new Error(`프로젝트 이름 또는 경로가 중복입니다: ${p.name}`);
    names.add(p.name);
    paths.add(path);
    return { name: p.name, path, color: p.color ?? PALETTE[i % PALETTE.length] };
  });

  return { ...DEFAULTS, ...raw, projects };
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
