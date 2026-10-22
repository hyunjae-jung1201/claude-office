import { maskSecrets } from './mask.js';

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const DETAIL_LIMIT = 200;
// Claude가 사용자의 답을 기다리며 멈추는 도구들
// 파일을 만들거나 바꾸는 도구: 역할자 검토의 대상이 된다
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const PATH_LIMIT = 1000;
const PROMPT_LIMIT = 300;
const RESPONSE_LIMIT = 2000;

export const USER_WAIT_TOOLS = { AskUserQuestion: 'answer', ExitPlanMode: 'plan' };
const PRE_MASK_LIMIT = DETAIL_LIMIT * 4; // 마스킹 전에 먼저 자른다(입력 크기 제한)

export function toolCategory(toolName) {
  if (READ_TOOLS.has(toolName)) return 'read';
  if (toolName === 'Bash') return 'run';
  return 'write';
}

export function maskDetail(v) {
  if (typeof v !== 'string' || !v) return undefined;
  // 자르는 경계에 걸친 토큰 조각이 가려지지 않은 채 남지 않도록 마지막 단어를 버린다.
  const cut = v.length > PRE_MASK_LIMIT ? v.slice(0, PRE_MASK_LIMIT).replace(/\S*$/, '') : v;
  return maskSecrets(cut).slice(0, DETAIL_LIMIT);
}

function detailOf(input) {
  if (!input || typeof input !== 'object') return undefined;
  return maskDetail(input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern
    ?? input.url ?? input.query ?? input.description);
}

const str = (v) => (typeof v === 'string' && v ? v : undefined);

// ---- 작업 종류(어느 방에서 하는 일인지): library research work docs planning lab build git data server meeting consult briefing
const DOC_FILE = /\.(?:md|markdown|txt|rst|adoc)$|(?:^|\/)README[^/]*$/i;
const LAB = /\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:test|lint|check|e2e)\b|\bpytest\b|\bjest\b|\bvitest\b|\bmocha\b|\bcargo\s+test\b|\bgo\s+test\b|\bmake\s+(?:test|check)\b|\beslint\b|\bruff\b|\bmypy\b|\btsc\s+--noEmit|\bnode\s+--test\b|\bunittest\b|\bphpunit\b|\brspec\b|\bplaywright\s+test\b|\bflake8\b|\bpylint\b/;
const BUILD = /\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:build|install|ci|i|add)\b|\bnpm\s+i\b|\b(?:pip3?|pipenv|poetry|conda)\s+install\b|\bmake\b|\bcmake\b|\bgradle\w*\b|\bmvn\b|\bdocker\s+(?:compose\s+)?build\b|\bcargo\s+build\b|\bgo\s+build\b|\bwebpack\b|\bvite\s+build\b|\bbundle\s+install\b|\b(?:apt(?:-get)?|brew|yum|dnf)\s+install\b|\btsc\b|\bbabel\b|\brollup\b/;
const DATA_CMD = /^(?:wget|scp|rsync|gdown|kaggle|yt-dlp|youtube-dl|unzip|tar|7z|gsutil|huggingface-cli)\b|^aws\s+s3\b|^curl\b.*\s-(?:[A-Za-z]*[Oo]\b|-output\b|-remote-name\b)/;
const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'env', 'command', 'exec', 'nice']);

function bashActivity(cmd) {
  const found = new Set();
  for (const raw of cmd.split(/&&|\|\||;|\|/)) {
    let seg = raw.trim();
    // 앞쪽 VAR=값 과 sudo/time 같은 접두를 건너뛴다
    for (;;) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*=\S*|\S+)\s*/.exec(seg);
      if (!m) break;
      const tok = m[1];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok) || WRAPPERS.has(tok)) seg = seg.slice(m[0].length);
      else break;
    }
    if (!seg) continue;
    const first = seg.split(/\s+/)[0];
    if (first === 'git' || first === 'gh') found.add('git');
    else if (LAB.test(seg)) found.add('lab');
    else if (BUILD.test(seg)) found.add('build');
    else if (DATA_CMD.test(seg)) found.add('data');
  }
  for (const k of ['git', 'lab', 'build', 'data']) if (found.has(k)) return k;
  return 'server';
}

export function activityOf(tool, detail) {
  const d = typeof detail === 'string' ? detail : '';
  switch (tool) {
    case 'Read': case 'Grep': case 'Glob': return 'library';
    case 'WebSearch': case 'WebFetch': return 'research';
    case 'Edit': case 'Write': case 'NotebookEdit': case 'MultiEdit': return DOC_FILE.test(d) ? 'docs' : 'work';
    case 'TodoWrite': case 'EnterPlanMode': return 'planning';
    case 'Agent': case 'Task': return 'briefing';
    case 'AskUserQuestion': return 'consult';
    case 'ExitPlanMode': return 'meeting';
    case 'Bash': return bashActivity(d);
    default: return 'work';
  }
}

// 분류용 원문(마스킹 전). 화면·LLM으로는 보내지 않고 방을 고르는 데만 쓴다.
const rawDetailOf = (input) => {
  if (!input || typeof input !== 'object') return '';
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description;
  return typeof v === 'string' ? v.slice(0, 2000) : '';
};

// 편집 도구가 건드린 파일 경로 원문(서버 안에서 git 저장소를 찾는 데만 쓰고, 화면·LLM으로는 보내지 않는다)
function editedPath(tool, input) {
  if (!EDIT_TOOLS.has(tool) || !input || typeof input !== 'object') return undefined;
  const p = str(input.file_path) ?? str(input.notebook_path);
  return p && p.length <= PATH_LIMIT ? p : undefined;
}

const maskedText = (v, limit) => (str(v) ? maskSecrets(v.slice(0, limit * 2)).slice(0, limit) : undefined);

export function normalizeEvent(payload, now) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const sessionId = str(payload.session_id);
  const cwd = str(payload.cwd);
  const name = str(payload.hook_event_name);
  if (!sessionId || !cwd || !name) return null;

  const base = { sessionId, cwd, ts: now };
  const agent = () => {
    const agentId = str(payload.agent_id);
    return agentId ? { agentId, agentType: str(payload.agent_type) } : {};
  };

  switch (name) {
    case 'SessionStart': return { ...base, type: 'start' };
    case 'SessionEnd': return { ...base, type: 'end' };
    case 'Stop': return { ...base, type: 'stop', assistantText: maskedText(payload.last_assistant_message, RESPONSE_LIMIT) };
    case 'UserPromptSubmit': {
      const prompt = str(payload.prompt);
      if (prompt?.startsWith('<task-notification>')) return null;
      return { ...base, type: 'prompt', promptText: maskedText(prompt, PROMPT_LIMIT) };
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      const tool = str(payload.tool_name);
      if (!tool) return null;
      if (name === 'PreToolUse' && USER_WAIT_TOOLS[tool]) return { ...base, type: 'wait', waitKind: USER_WAIT_TOOLS[tool], activity: activityOf(tool, ''), ...agent() };
      return {
        ...base,
        type: name === 'PreToolUse' ? 'tool' : 'toolDone',
        category: toolCategory(tool),
        toolName: tool,
        activity: activityOf(tool, rawDetailOf(payload.tool_input)),
        filePath: editedPath(tool, payload.tool_input),
        detail: detailOf(payload.tool_input),
        ...agent(),
      };
    }
    case 'PermissionRequest':
      return { ...base, type: 'wait', waitKind: 'approval', activity: 'meeting', detail: detailOf(payload.tool_input), ...agent() };
    case 'Notification':
      return payload.notification_type === 'permission_prompt' ? { ...base, type: 'wait', waitKind: 'approval', activity: 'meeting' } : null;
    case 'SubagentStart':
    case 'SubagentStop': {
      const a = agent();
      if (!a.agentId) return null;
      return { ...base, type: name === 'SubagentStart' ? 'agentStart' : 'agentStop', ...a };
    }
    default:
      return null;
  }
}
