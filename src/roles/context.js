// 역할자에게 줄 문맥: 편집된 파일이 속한 git 저장소를 찾고, 서버가 직접 diff 를 만들어 프롬프트에 넣는다.
// 역할자에게는 셸 도구를 주지 않으므로 git 정보는 모두 여기서 만든다.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync, readFileSync, openSync, readSync, closeSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { isSensitivePath, maskSecrets } from '../mask.js';

const run = promisify(execFile);
const DIFF_LIMIT = 60_000;
const NEW_FILE_BYTES = 4096;
const MAX_NEW_FILES = 20;
const REQUEST_LIMIT = 300;
const REQUESTS_MAX = 5;
const RESPONSE_LIMIT = 2000;

async function git(root, args) {
  const { stdout } = await run('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1' }, // 파일 이름의 * ? 등을 패턴으로 해석하지 않는다
  });
  return stdout;
}

const rootCache = new Map(); // 폴더 -> 저장소 루트 | null
function existingDir(path) {
  let dir = dirname(path);
  while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);
  return dir;
}

export async function repoRootOf(filePath) {
  if (!isAbsolute(filePath)) return null;
  const dir = realpathSync(existingDir(filePath));
  if (rootCache.has(dir)) return rootCache.get(dir);
  if (rootCache.size > 500) rootCache.clear(); // 오래 떠 있는 서버에서 무한히 늘지 않게
  let root = null;
  try { root = realpathSync((await git(dir, ['rev-parse', '--show-toplevel'])).trim()); } catch { /* 저장소 아님 */ }
  rootCache.set(dir, root);
  return root;
}

// 저장소의 현재 HEAD(없으면 undefined). 검토의 기준점으로 첫 편집 시점에 기록한다.
export async function gitHead(repoRoot) {
  try { return (await git(repoRoot, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || undefined; } catch { return undefined; }
}

// 파일들을 저장소 루트별로 묶는다. 저장소 밖·상대 경로·홈 폴더 자체가 저장소인 경우는 제외.
export async function groupFilesByRepo(files, { homeDir = homedir() } = {}) {
  const out = new Map();
  for (const f of new Set(files)) {
    const root = await repoRootOf(f);
    if (!root || root === homeDir || root === sep) continue;
    if (!out.has(root)) out.set(root, []);
    out.get(root).push(f);
  }
  return out;
}

function relPath(root, file) {
  let abs = file;
  try { abs = realPathOf(file); } catch { /* 없는 파일은 그대로 */ }
  const rel = relative(root, abs);
  return rel && !rel.startsWith('..') ? rel : relative(root, file);
}
function realPathOf(file) {
  const dir = existingDir(file);
  const realDir = realpathSync(dir);
  return realDir + file.slice(dir.length);
}

function readHead(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally { closeSync(fd); }
}

function newFileDiff(root, rel) {
  const header = `diff --git a/${rel} b/${rel}\nnew file\n--- /dev/null\n+++ b/${rel}\n`;
  // 심볼릭 링크·특수 파일은 읽지 않는다(링크로 저장소 밖이나 민감 파일의 내용이 새는 것을 막는다)
  try {
    const st = lstatSync(`${root}/${rel}`);
    if (!st.isFile()) return `${header}(링크 또는 특수 파일, 내용 생략)\n`;
  } catch { return ''; }
  let buf;
  try { buf = readHead(`${root}/${rel}`, NEW_FILE_BYTES); } catch { return ''; }
  if (buf.includes(0)) return `${header}(바이너리 파일, 내용 생략)\n`;
  const text = buf.toString('utf8');
  const more = (() => { try { return readFileSync(`${root}/${rel}`).length > NEW_FILE_BYTES; } catch { return false; } })();
  return header + text.split('\n').map((l) => '+' + l).join('\n') + (more ? '\n(이후 생략)\n' : '\n');
}

export async function buildDiff(repoRoot, files, { limit = DIFF_LIMIT, base } = {}) {
  const rels = [...new Set(files.map((f) => relPath(repoRoot, f)))];
  const sensitive = rels.filter((r) => isSensitivePath(r));
  const normal = rels.filter((r) => !isSensitivePath(r));
  // 기준점: 첫 편집 시점의 커밋(같은 턴에 커밋했어도 변경이 보이도록). 올바르지 않으면 HEAD.
  let baseRef = 'HEAD';
  if (base) {
    try { await git(repoRoot, ['rev-parse', '--verify', '-q', `${base}^{commit}`]); baseRef = base; } catch { /* HEAD 사용 */ }
  }
  let hasHead = true;
  try { await git(repoRoot, ['rev-parse', '--verify', '-q', baseRef]); } catch { hasHead = false; }

  const tracked = new Set();
  if (normal.length) {
    try { (await git(repoRoot, ['ls-files', '--', ...normal])).split('\n').filter(Boolean).forEach((t) => tracked.add(t)); } catch { /* 없음 */ }
  }
  // 추적 안 되는 파일 중 .gitignore 에 걸린 것(로컬 설정 등)은 이름 규칙으로 못 거르는 비밀이 있을 수 있어 내용을 읽지 않는다
  const notIgnored = new Set();
  if (normal.length) {
    try { (await git(repoRoot, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...normal])).split('\0').filter(Boolean).forEach((f) => notIgnored.add(f)); } catch { /* 없음 */ }
  }
  const trackedFiles = normal.filter((r) => tracked.has(r));
  const untracked = normal.filter((r) => notIgnored.has(r) && existsSync(`${repoRoot}/${r}`)).slice(0, MAX_NEW_FILES);
  const ignored = normal.filter((r) => !tracked.has(r) && !notIgnored.has(r) && existsSync(`${repoRoot}/${r}`));

  let diff = '';
  let stats = '';
  if (trackedFiles.length && hasHead) {
    try { diff += await git(repoRoot, ['diff', baseRef, '--no-color', '--no-ext-diff', '--', ...trackedFiles]); } catch { /* 무시 */ }
    try { stats += await git(repoRoot, ['diff', baseRef, '--stat', '--no-color', '--', ...trackedFiles]); } catch { /* 무시 */ }
  }
  for (const rel of untracked) {
    diff += newFileDiff(repoRoot, rel);
    stats += ` ${rel} | (새 파일)\n`;
  }
  const hidden = [...sensitive, ...ignored];
  if (hidden.length) diff += `\n# 설정 파일 변경(내용 제외): ${hidden.length}개\n`;

  diff = maskSecrets(diff);
  const excluded = hidden.map((r) => maskSecrets(r));
  const truncated = Buffer.byteLength(diff) > limit;
  return { diff: truncated ? '' : diff, truncated, stats: maskSecrets(stats), excluded };
}

// git 이 없는 팀 폴더용: Claude 가 파일을 고칠 때 남긴 "이전 → 이후" 기록으로 변경 내용을 만든다(폴더에는 아무것도 만들지 않는다).
const prefixed = (mark, text) => (typeof text === 'string' && text ? text.split('\n').map((l) => mark + l).join('\n') + '\n' : '');
export function buildEditsBundle(job, { limit = DIFF_LIMIT } = {}) {
  const root = job.repoRoot;
  const rel = (f) => relative(root, f) || f;
  const hidden = new Set();
  const counts = new Map();
  let diff = '';
  for (const e of job.edits ?? []) {
    const r = rel(e.file);
    if (isSensitivePath(r)) { hidden.add(r); continue; }
    const parts = e.kind === 'multi' ? (e.edits ?? []) : [e];
    counts.set(r, (counts.get(r) ?? 0) + (e.kind === 'multi' ? parts.length : 1));
    if (e.kind === 'write') {
      diff += `--- /dev/null\n+++ new file: ${r} (Write: 파일 전체 내용)\n${prefixed('+', e.new)}`;
    } else {
      for (const p of parts) diff += `--- a/${r}\n+++ b/${r}\n${prefixed('-', p.old)}${prefixed('+', p.new)}`;
    }
  }
  // 수정 기록이 없는 파일(예: 노트북 편집)과 기록이 버려진 파일도 목록에는 남긴다
  for (const f of job.files) {
    const r = rel(f);
    if (isSensitivePath(r)) hidden.add(r);
    else if (!counts.has(r)) counts.set(r, 0);
  }
  if (hidden.size) diff += `\n# 설정 파일 변경(내용 제외): ${hidden.size}개\n`;
  diff = maskSecrets(diff);
  const stats = maskSecrets([...counts].map(([r, n]) => ` ${r} | ${n ? `${n}회 수정` : '(수정 기록 없음, 직접 읽어 확인)'}\n`).join(''));
  const truncated = Buffer.byteLength(diff) > limit;
  return {
    repoRoot: root, repoName: basename(root), requests: job.requests, lastResponse: job.lastResponse, files: job.files,
    diff: truncated ? '' : diff, truncated, stats, excluded: [...hidden].map((r) => maskSecrets(r)), mode: 'edits',
  };
}

const clip = (s, n) => maskSecrets(String(s ?? '')).slice(0, n);

const READ_ONLY_RULES = `## 읽기 전용 규칙
- 파일을 수정하거나 실행하지 마라. 쓸 수 있는 도구는 읽기(Read), 검색(Grep), 파일 찾기(Glob)뿐이다.
- .env, 키 파일, ~/.ssh 같은 비밀 파일은 읽지 마라. 코드 안에서 비밀값을 발견하면 값을 옮겨 적지 말고 "위치"만 알려라.
- 아래 "변경 내용"에 없는 것도 필요하면 읽어서 확인해도 된다. 확인하지 않은 것은 단정하지 마라.
- 검토 범위는 "이번에 바뀐 파일"이다. git 상태 등에서 그 밖의 파일 변경이 보여도 사용자가 하던 다른 작업일 수 있으니 이번 작업의 문제로 지적하지 마라.`;

const OUTPUT_FORMAT = `## 출력 형식 (반드시 지킬 것)
설명이나 코드 펜스 없이, 아래 JSON 객체 하나만 출력한다.
{"verdict": "ok|concern|block", "summary": "한국어 한 줄 요약(60자 안팎)", "findings": [{"severity": "info|minor|major|critical", "text": "무엇이 왜 문제인지", "file": "경로", "line": 12}]}
- 문제가 없으면 verdict 는 "ok", findings 는 빈 배열.
- "block" 은 지금 당장 멈추고 고쳐야 할 때만 쓴다.
- file/line 은 확실할 때만 적는다.`;

export function buildPrompt(role, bundle) {
  const requests = bundle.requests.slice(-REQUESTS_MAX).map((r, i) => `${i + 1}. ${clip(r, REQUEST_LIMIT)}`).join('\n') || '(없음)';
  const files = bundle.files.map((f) => `- ${clip(relative(bundle.repoRoot, f) || f, 200)}`).join('\n') || '(없음)';
  const excludedNote = bundle.excluded?.length
    ? `\n(보안상 비밀값이 들어 있을 수 있는 설정 파일 ${bundle.excluded.length}개의 변경 내용은 일부러 제외했다. 내용을 볼 수 없다는 것은 문제로 지적하지 마라.)`
    : '';
  const editsNote = bundle.mode === 'edits'
    ? '이 폴더는 git 저장소가 아니라서, 아래는 git diff 가 아니라 Claude 가 파일을 고칠 때 남긴 수정 기록(이전 → 이후)이다. 현재 파일과 다를 수 있으니 필요하면 직접 읽어서 확인하라.\n'
    : '';
  const change = editsNote + (bundle.truncated
    ? `변경이 너무 커서 diff 는 생략했다. 통계는 다음과 같고, 필요한 파일은 직접 읽어서 확인하라.\n${bundle.stats}`
    : `${bundle.stats ? bundle.stats + '\n' : ''}${bundle.diff || '(변경 내용 없음)'}`);
  return [
    role.prompt,
    READ_ONLY_RULES,
    `## 프로젝트\n${clip(bundle.repoName, 100)} (${clip(bundle.repoRoot, 200)})`,
    `## 사용자의 최근 요청 (오래된 순)\n${requests}`,
    `## Claude의 마지막 응답\n${clip(bundle.lastResponse, RESPONSE_LIMIT) || '(없음)'}`,
    `## 이번에 바뀐 파일\n${files}`,
    `## 변경 내용\n${change}${excludedNote}`,
    OUTPUT_FORMAT,
  ].join('\n\n');
}
