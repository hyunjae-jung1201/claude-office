// 역할자에게 줄 문맥: 편집된 파일이 속한 git 저장소를 찾고, 서버가 직접 diff 를 만들어 프롬프트에 넣는다.
// 역할자에게는 셸 도구를 주지 않으므로 git 정보는 모두 여기서 만든다.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, sep } from 'node:path';
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
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
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
  let root = null;
  try { root = realpathSync((await git(dir, ['rev-parse', '--show-toplevel'])).trim()); } catch { /* 저장소 아님 */ }
  rootCache.set(dir, root);
  return root;
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
  let buf;
  try { buf = readHead(`${root}/${rel}`, NEW_FILE_BYTES); } catch { return ''; }
  const header = `diff --git a/${rel} b/${rel}\nnew file\n--- /dev/null\n+++ b/${rel}\n`;
  if (buf.includes(0)) return `${header}(바이너리 파일, 내용 생략)\n`;
  const text = buf.toString('utf8');
  const more = (() => { try { return readFileSync(`${root}/${rel}`).length > NEW_FILE_BYTES; } catch { return false; } })();
  return header + text.split('\n').map((l) => '+' + l).join('\n') + (more ? '\n(이후 생략)\n' : '\n');
}

export async function buildDiff(repoRoot, files, { limit = DIFF_LIMIT } = {}) {
  const rels = [...new Set(files.map((f) => relPath(repoRoot, f)))];
  const sensitive = rels.filter((r) => isSensitivePath(r));
  const normal = rels.filter((r) => !isSensitivePath(r));
  let hasHead = true;
  try { await git(repoRoot, ['rev-parse', '--verify', '-q', 'HEAD']); } catch { hasHead = false; }

  const tracked = new Set();
  if (normal.length) {
    try { (await git(repoRoot, ['ls-files', '--', ...normal])).split('\n').filter(Boolean).forEach((t) => tracked.add(t)); } catch { /* 없음 */ }
  }
  const trackedFiles = normal.filter((r) => tracked.has(r));
  const untracked = normal.filter((r) => !tracked.has(r) && existsSync(`${repoRoot}/${r}`)).slice(0, MAX_NEW_FILES);

  let diff = '';
  let stats = '';
  if (trackedFiles.length && hasHead) {
    try { diff += await git(repoRoot, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--', ...trackedFiles]); } catch { /* 무시 */ }
    try { stats += await git(repoRoot, ['diff', 'HEAD', '--stat', '--no-color', '--', ...trackedFiles]); } catch { /* 무시 */ }
  }
  for (const rel of untracked) {
    diff += newFileDiff(repoRoot, rel);
    stats += ` ${rel} | (새 파일)\n`;
  }
  if (sensitive.length) diff += `\n# 설정 파일 변경(내용 제외): ${sensitive.length}개\n`;

  diff = maskSecrets(diff);
  const excluded = sensitive.map((r) => maskSecrets(r));
  const truncated = Buffer.byteLength(diff) > limit;
  return { diff: truncated ? '' : diff, truncated, stats: maskSecrets(stats), excluded };
}

const clip = (s, n) => maskSecrets(String(s ?? '')).slice(0, n);

const READ_ONLY_RULES = `## 읽기 전용 규칙
- 파일을 수정하거나 실행하지 마라. 쓸 수 있는 도구는 읽기(Read), 검색(Grep), 파일 찾기(Glob)뿐이다.
- .env, 키 파일, ~/.ssh 같은 비밀 파일은 읽지 마라. 코드 안에서 비밀값을 발견하면 값을 옮겨 적지 말고 "위치"만 알려라.
- 아래 "변경 내용"에 없는 것도 필요하면 읽어서 확인해도 된다. 확인하지 않은 것은 단정하지 마라.`;

const OUTPUT_FORMAT = `## 출력 형식 (반드시 지킬 것)
설명이나 코드 펜스 없이, 아래 JSON 객체 하나만 출력한다.
{"verdict": "ok|concern|block", "summary": "한국어 한 줄 요약(60자 안팎)", "findings": [{"severity": "info|minor|major|critical", "text": "무엇이 왜 문제인지", "file": "경로", "line": 12}]}
- 문제가 없으면 verdict 는 "ok", findings 는 빈 배열.
- "block" 은 지금 당장 멈추고 고쳐야 할 때만 쓴다.
- file/line 은 확실할 때만 적는다.`;

export function buildPrompt(role, bundle) {
  const requests = bundle.requests.slice(-REQUESTS_MAX).map((r, i) => `${i + 1}. ${clip(r, REQUEST_LIMIT)}`).join('\n') || '(없음)';
  const files = bundle.files.map((f) => `- ${clip(relative(bundle.repoRoot, f) || f, 200)}`).join('\n') || '(없음)';
  const change = bundle.truncated
    ? `변경이 너무 커서 diff 는 생략했다. 통계는 다음과 같고, 필요한 파일은 직접 읽어서 확인하라.\n${bundle.stats}`
    : `${bundle.stats ? bundle.stats + '\n' : ''}${bundle.diff || '(변경 내용 없음)'}`;
  return [
    role.prompt,
    READ_ONLY_RULES,
    `## 프로젝트\n${clip(bundle.repoName, 100)} (${clip(bundle.repoRoot, 200)})`,
    `## 사용자의 최근 요청 (오래된 순)\n${requests}`,
    `## Claude의 마지막 응답\n${clip(bundle.lastResponse, RESPONSE_LIMIT) || '(없음)'}`,
    `## 이번에 바뀐 파일\n${files}`,
    `## 변경 내용\n${change}`,
    OUTPUT_FORMAT,
  ].join('\n\n');
}
