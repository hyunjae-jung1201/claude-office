// roles/<id>.md 를 읽어 역할 정의를 만든다. 역할 추가 = 파일 추가.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const KEYS = new Set(['name', 'color', 'model', 'when', 'tools']);
const WHEN = new Set(['always', 'code', 'docs', 'ui']);
const PROMPT_LIMIT = 20 * 1024;
const unquote = (v) => v.replace(/^(["'])(.*)\1$/, '$2');

function parseValue(raw) {
  let v = raw.trim();
  if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim(); // 따옴표 없는 값의 끝 주석 제거
  return v;
}

function parseRole(id, text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`역할 ${id}: 파일 맨 위에 --- 로 둘러싼 frontmatter(머리말)가 필요합니다`);
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`역할 ${id}: 이해할 수 없는 줄 "${line.trim()}"`);
    const key = line.slice(0, i).trim();
    if (!KEYS.has(key)) throw new Error(`역할 ${id}: 알 수 없는 항목 "${key}" (허용: ${[...KEYS].join(', ')})`);
    fm[key] = parseValue(line.slice(i + 1));
  }
  if (!fm.name) throw new Error(`역할 ${id}: name 이 필요합니다`);
  const name = unquote(fm.name);
  const color = fm.color ? unquote(fm.color) : '#8a94a6';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`역할 ${id}: color 는 #rrggbb 형식이어야 합니다 ("${color}")`);
  const when = fm.when ? unquote(fm.when) : 'always';
  if (!WHEN.has(when)) throw new Error(`역할 ${id}: when 은 always|code|docs|ui 중 하나여야 합니다 ("${when}")`);
  const model = fm.model ? unquote(fm.model) : 'sonnet';
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error(`역할 ${id}: model 형식이 올바르지 않습니다 ("${model}")`);

  let tools = ['Read', 'Grep', 'Glob'];
  if (fm.tools !== undefined) {
    const inner = fm.tools.replace(/^\[/, '').replace(/\]$/, '');
    tools = inner.split(',').map((t) => unquote(t.trim())).filter(Boolean);
    const bad = tools.find((t) => !READ_ONLY_TOOLS.has(t));
    if (bad) throw new Error(`역할 ${id}: tools 에는 Read, Grep, Glob 만 쓸 수 있습니다 (${bad} 는 허용되지 않음)`);
  }

  const prompt = m[2].trim();
  if (Buffer.byteLength(prompt) > PROMPT_LIMIT) throw new Error(`역할 ${id}: 프롬프트가 너무 깁니다 (최대 20KB)`);
  return { id, name, color, model, when, tools, prompt };
}

export function loadRoles(dir) {
  const roles = new Map();
  let files = [];
  try { files = readdirSync(dir); } catch { return roles; }
  for (const f of files.sort()) {
    if (!f.endsWith('.md')) continue;
    const id = basename(f, '.md');
    if (!/^[a-z0-9_-]+$/.test(id)) throw new Error(`역할 파일 이름(id)은 영문 소문자·숫자·_- 만 쓸 수 있습니다: ${f}`);
    roles.set(id, parseRole(id, readFileSync(join(dir, f), 'utf8')));
  }
  return roles;
}

const underPath = (repoRoot, p) => repoRoot === p || repoRoot.startsWith(p.replace(/\/+$/, '') + '/');

// 우선순위: 팀 항목의 roles → roles.projects 에서 가장 긴 경로 → roles.default
export function rolesFor(config, repoRoot, teamName) {
  const team = teamName ? config.projects.find((p) => p.name === teamName && p.roles) : null;
  if (team) return team.roles;
  let best = null;
  for (const [path, v] of Object.entries(config.roles.projects ?? {})) {
    if (v.roles && underPath(repoRoot, path) && (!best || path.length > best.path.length)) best = { path, roles: v.roles };
  }
  return best ? best.roles : config.roles.default;
}

export function validateRoleIds(config, known) {
  const check = (ids, where) => {
    for (const id of ids ?? []) if (!known.has(id)) throw new Error(`알 수 없는 역할 id: ${id} (${where}) — roles/${id}.md 가 있어야 합니다`);
  };
  check(config.roles.default, 'roles.default');
  for (const [path, v] of Object.entries(config.roles.projects ?? {})) check(v.roles, `roles.projects ${path}`);
  for (const p of config.projects) check(p.roles, `프로젝트 ${p.name}`);
}
