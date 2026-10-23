import { asksQuestion } from './question.js';
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
    ?? input.url ?? input.query ?? input.skill ?? input.description);
}

const str = (v) => (typeof v === 'string' && v ? v : undefined);

// ---- 작업 종류(어느 방에서 하는 일인지): library research work docs planning lab build git data server briefing response
const DOC_FILE = /\.(?:md|markdown|txt|rst|adoc)$|(?:^|\/)README[^/]*$/i;
const LAB = /\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:test|lint|check|e2e)\b|\bpytest\b|\bjest\b|\bvitest\b|\bmocha\b|\bcargo\s+test\b|\bgo\s+test\b|\bmake\s+(?:test|check)\b|\beslint\b|\bruff\b|\bmypy\b|\btsc\s+--noEmit|\bnode\s+--test\b|\bunittest\b|\bphpunit\b|\brspec\b|\bplaywright\s+test\b|\bflake8\b|\bpylint\b/;
const BUILD = /\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:build|install|ci|i|add)\b|\bnpm\s+i\b|\b(?:pip3?|pipenv|poetry|conda)\s+install\b|\bmake\b|\bcmake\b|\bgradle\w*\b|\bmvn\b|\bdocker\s+(?:compose\s+)?build\b|\bcargo\s+build\b|\bgo\s+build\b|\bwebpack\b|\bvite\s+build\b|\bbundle\s+install\b|\b(?:apt(?:-get)?|brew|yum|dnf)\s+install\b|\btsc\b|\bbabel\b|\brollup\b/;
const DATA_CMD = /^(?:wget|scp|rsync|gdown|kaggle|yt-dlp|youtube-dl|unzip|tar|7z|gsutil|huggingface-cli)\b|^aws\s+s3\b|^curl\b.*\s-(?:[A-Za-z]*[Oo]\b|-output\b|-remote-name\b)/;
const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'env', 'command', 'exec', 'nice']);

// 서버실은 서버·인프라 일(접속·프로세스·네트워크·컨테이너·장치)만. 파일을 읽는 명령은 자료실, 문서를 만들면 문서실, 그 밖의 손작업은 작업실.
// 밑줄(_)은 단어 경계로 치지 않는다: make_ppt.py, eval_model.py
const DOC_KEYWORDS = /(?<![A-Za-z])(?:pptx?|docx?|xlsx?|pdf|pandoc|libreoffice|soffice|reportlab|openpyxl|pptxgenjs|python-pptx|python-docx|slides?|deck)(?![A-Za-z])|슬라이드|보고서|발표|문서/i;
const DOC_REF = /\.(?:md|markdown|txt|rst|adoc|docx?|pptx?|xlsx?|pdf)(?=["'\s]|$)/i; // 명령 안에서 글·문서 파일을 가리키는 부분
const EXPERIMENT = /(?<![A-Za-z])(?:train|training|eval|evaluate|infer|inference|bench|benchmark|experiment|validate|predict|sweep)(?![A-Za-z])/i;
const DB_TOOLS = new Set(['sqlite3', 'mongosh', 'mongo', 'psql', 'mysql', 'duckdb']);
const WIN_SERVER = /Get-Process|Stop-Process|Get-Service|Restart-Service|tasklist|taskkill|ipconfig|netstat/i;
const SERVER_TOOLS = new Set(['ssh', 'sshpass', 'docker', 'docker-compose', 'kubectl', 'systemctl', 'service', 'journalctl', 'kill', 'pkill', 'killall', 'pgrep', 'ps', 'top', 'htop', 'nvidia-smi', 'lsof', 'netstat', 'ss', 'ping', 'nc', 'nohup', 'screen', 'tmux', 'adb', 'uvicorn', 'gunicorn', 'nginx', 'redis-cli', 'fuser', 'crontab', 'curl']);
const SERVER_RUN = /\b(?:npm\s+(?:start|run\s+(?:dev|start|serve))|node\s+\S*server\S*|flask\s+run|python3?\s+-m\s+http\.server)\b/;
const SHELL_READ = new Set(['ls', 'cat', 'head', 'tail', 'less', 'more', 'find', 'grep', 'egrep', 'rg', 'ag', 'wc', 'stat', 'file', 'tree', 'du', 'df', 'diff', 'cmp', 'sort', 'uniq', 'awk', 'sed', 'jq', 'readlink', 'realpath', 'basename', 'dirname', 'which', 'type', 'pwd']);
const FILE_TOOLS = new Set(['cp', 'mv', 'mkdir', 'touch', 'rm', 'ln', 'chmod', 'chown', 'tee', 'rmdir']);
const RUNNER = /^(?:python[\d.]*|node|nodejs|ruby|perl|deno|bun|bash|sh|zsh|uv|poetry|pipenv)$|^\.{0,2}\//;
const ROOM_PRIORITY = ['git', 'lab', 'build', 'data', 'docs', 'server', 'work', 'library'];

// heredoc(<<'EOF' … EOF) 본문은 명령이 아니라 글/스크립트 내용이라, 명령 분류에서는 빼고(문서 키워드 검색에만 쓴다)
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const stripHeredocs = (cmd) => cmd.replace(HEREDOC, (m) => m.split('\n')[0]);

function segmentRoom(seg, full) {
  let rest = seg.trim();
  // 앞쪽 VAR=값, sudo/time/timeout N 같은 접두를 건너뛴다
  for (;;) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)|\S+)\s*/.exec(rest);
    if (!m) break;
    const tok = m[1];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok) || WRAPPERS.has(tok)) rest = rest.slice(m[0].length);
    else if (tok === 'timeout') rest = rest.slice(m[0].length).replace(/^[\d.]+[smhd]?\s*/, '');
    else break;
  }
  if (!rest) return null;
  const first = rest.split(/\s+/)[0].replace(/^.*\//, '').replace(/^\(+/, '');
  if (first === 'git' || first === 'gh') return 'git';
  if (LAB.test(rest)) return 'lab';
  if (BUILD.test(rest)) return 'build';
  if (DATA_CMD.test(rest)) return 'data';
  const writes = /(?:^|[^>\d])>{1,2}\s*[^&\s]/.test(rest) || first === 'tee' || /\bsed\s+(?:-[A-Za-z]*i|--in-place)/.test(rest);
  if (writes) return DOC_REF.test(rest) ? 'docs' : 'work'; // 글·문서 파일에 쓰면 문서실, 아니면 작업실
  if (FILE_TOOLS.has(first)) return 'work';
  if (RUNNER.test(rest.split(/\s+/)[0]) || RUNNER.test(first)) {
    if (DOC_KEYWORDS.test(full)) return 'docs';
    if (EXPERIMENT.test(rest)) return 'lab';
    if (SERVER_RUN.test(rest)) return 'server';
    return 'work';
  }
  if (DB_TOOLS.has(first)) return 'data';
  if (/^(?:powershell|pwsh|cmd)(?:\.exe)?$/i.test(first)) return WIN_SERVER.test(rest) ? 'server' : 'work';
  if (SERVER_TOOLS.has(first) || SERVER_RUN.test(rest)) return first === 'curl' && /\s-[A-Za-z]*[Oo]\b|--output|--remote-name/.test(rest) ? 'data' : 'server';
  if (/^soffice$|^libreoffice$|^pandoc$/.test(first)) return 'docs';
  if (SHELL_READ.has(first)) return 'library';
  return null;
}

function bashActivity(cmd) {
  const shell = stripHeredocs(cmd);
  const found = new Set();
  for (const raw of shell.split(/&&|\|\||;|\||\n/)) {
    const room = segmentRoom(raw, cmd);
    if (room) found.add(room);
  }
  for (const r of ROOM_PRIORITY) if (found.has(r)) return r;
  return 'work';
}

// ---- 편집 도구: 고치는 파일의 종류로 방을 고른다(문서·테스트·빌드 설정·서버 설정·데이터·그 밖의 코드)
const DOC_EDIT = /\.(?:md|markdown|txt|rst|adoc|docx?|pptx?|xlsx?|pdf)$|(?:^|\/)README[^/]*$/i;
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|specs?)\/|[._-](?:test|spec)\.[A-Za-z0-9]+$|_test\.[A-Za-z0-9]+$|(?:^|\/)test_[^/]+\.py$/i;
const BUILD_FILE = /(?:^|\/)(?:Makefile|CMakeLists\.txt|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|setup\.py|(?:build|settings)\.gradle(?:\.kts)?|pom\.xml|Cargo\.toml|go\.mod)$|(?:^|\/)\.github\/workflows\/[^/]+$/i;
const SERVER_FILE = /\/nginx\/|\/systemd\/|\.(?:service|timer)$|(?:^|\/)(?:crontab|supervisord?\.conf)$|(?:^|\/)\.env[^/]*$/i;
const DATA_FILE = /\.(?:csv|tsv|parquet|jsonl|sqlite3?|db)$/i;
function editRoom(path) {
  if (BUILD_FILE.test(path)) return 'build'; // requirements.txt 처럼 이름이 정해진 설정 파일이 먼저
  if (DOC_EDIT.test(path)) return 'docs';
  if (TEST_FILE.test(path)) return 'lab';
  if (SERVER_FILE.test(path)) return 'server';
  if (DATA_FILE.test(path)) return 'data';
  return 'work';
}

// ---- 스킬: 이름으로 하는 일을 짐작한다
function skillRoom(name) {
  if (/execut|implement|subagent/i.test(name)) return 'work';
  if (/plan|brainstorm|spec|design-doc/i.test(name)) return 'planning';
  if (/docx|pptx|xlsx|pdf|humanize|(?:^|[:\-])docs?(?:$|[:\-])/i.test(name)) return 'docs';
  if (/test|tdd|debug|verif/i.test(name)) return 'lab';
  if (/review/i.test(name)) return 'library';
  return 'work';
}

// ---- MCP 도구: 서버 이름·도구 이름으로 짐작한다
const MCP_ROOMS = [
  [/^mcp__(?:plugin_)?(?:playwright|mobile-mcp|jupyter|semgrep)/, 'lab'],
  [/^mcp__(?:plugin_)?mongodb/, 'data'],
  [/^mcp__(?:plugin_)?(?:atlassian|sequential-thinking)/, 'planning'],
  [/^mcp__(?:plugin_)?github/, 'git'],
  [/^mcp__ai-memory__/, 'library'],
  [/^mcp__claude_ai_Claude_Docs__/, 'docs'],
  [/^mcp__context7__|^mcp__claude_ai_(?:Gmail|Google_Calendar|Google_Drive)/, 'research'],
  [/^mcp__plugin_desktop-commander_desktop-commander__(?:read_|list_directory|get_file_info|start_search|get_more_search_results|list_searches)/, 'library'],
];

export function activityOf(tool, detail) {
  const d = typeof detail === 'string' ? detail : '';
  if (typeof tool === 'string' && tool.startsWith('mcp__')) return MCP_ROOMS.find(([re]) => re.test(tool))?.[1] ?? 'work';
  switch (tool) {
    case 'Read': case 'Grep': case 'Glob': case 'LSP': return 'library';
    case 'WebSearch': case 'WebFetch': return 'research';
    case 'Edit': case 'Write': case 'MultiEdit': return editRoom(d);
    case 'NotebookEdit': return 'lab';
    case 'TodoWrite': case 'EnterPlanMode': case 'CronCreate': case 'CronDelete': case 'CronList': case 'ScheduleWakeup': return 'planning';
    case 'Agent': case 'Task': case 'SendMessage': case 'ListAgents': return 'briefing';
    case 'EnterWorktree': case 'ExitWorktree': return 'git';
    case 'Monitor': return 'lab'; // 끝난 작업의 오류를 지켜보는 일은 서버 관리가 아니라 검증
    case 'Artifact': case 'ArtifactData': case 'ArtifactComments': return 'docs';
    case 'Skill': return skillRoom(d);
    case 'AskUserQuestion': case 'ExitPlanMode': return 'response'; // 사용자의 응답을 기다린다
    case 'Bash': return bashActivity(d);
    default: return 'work';
  }
}

// 분류용 원문(마스킹 전). 화면·LLM으로는 보내지 않고 방을 고르는 데만 쓴다.
const rawDetailOf = (input) => {
  if (!input || typeof input !== 'object') return '';
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.skill ?? input.description;
  return typeof v === 'string' ? v.slice(0, 2000) : '';
};

// 편집 도구가 건드린 파일 경로 원문(서버 안에서 git 저장소를 찾는 데만 쓰고, 화면·LLM으로는 보내지 않는다)
function editedPath(tool, input) {
  if (!EDIT_TOOLS.has(tool) || !input || typeof input !== 'object') return undefined;
  const p = str(input.file_path) ?? str(input.notebook_path);
  return p && p.length <= PATH_LIMIT ? p : undefined;
}

// 수정 전·후 내용(git 없이 역할자가 검토하는 근거). 마스킹·크기 제한을 거친다. 상대 경로·편집 도구가 아닌 것은 없음.
const EDIT_TEXT_LIMIT = 4000;
const MULTI_EDITS_MAX = 20;
export function editRecord(tool, input) {
  if (!input || typeof input !== 'object') return undefined;
  const file = str(input.file_path);
  if (!file || !file.startsWith('/') || file.length > PATH_LIMIT) return undefined;
  const t = (v) => maskedText(v, EDIT_TEXT_LIMIT);
  if (tool === 'Edit') return { kind: 'edit', file, old: t(input.old_string), new: t(input.new_string) };
  if (tool === 'Write') return { kind: 'write', file, new: t(input.content) };
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    const edits = input.edits.slice(0, MULTI_EDITS_MAX).filter((e) => e && typeof e === 'object').map((e) => ({ old: t(e.old_string), new: t(e.new_string) }));
    return { kind: 'multi', file, edits };
  }
  return undefined;
}

const maskedText = (v, limit) => (str(v) ? maskSecrets(v.slice(0, limit * 2)).slice(0, limit) : undefined);

// 다른 AI 도구(Codex 등)의 hook 신호: hook.js 가 환경변수로 도구 이름을 실어 보낸다(office_ai). 알려진 도구만 받는다.
const KNOWN_AI = new Set(['codex']);
const CODEX_SHELL = new Set(['exec_command', 'shell', 'local_shell', 'container.exec', 'bash', 'exec']);
const CODEX_READ = new Set(['read_file', 'view', 'open', 'list_dir', 'cat']);
const CODEX_PATCH = new Set(['apply_patch', 'patch']);

// ["bash", "-lc", "git status"] 같은 셸 래퍼는 안쪽 명령만 본다
const shellWrapped = (argv) => {
  const i = argv.findIndex((a) => /^-[a-z]*c$/.test(a));
  return (i > 0 ? argv.slice(i + 1) : argv).join(' ');
};

// Codex 의 도구 이름·입력을 이 프로그램이 아는 형태(Bash·Edit·Read)로 맞춘다. 모르는 도구는 그대로 둔다.
export function adaptCodexPayload(payload) {
  const name = str(payload.tool_name);
  if (!name) return payload;
  const input = payload.tool_input;
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  if (CODEX_SHELL.has(name)) {
    const cmd = (input && typeof input === 'object' && (Array.isArray(input.command) ? shellWrapped(input.command) : input.cmd ?? input.command)) || /"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] || '';
    return { ...payload, tool_name: 'Bash', tool_input: { command: String(cmd) } };
  }
  if (CODEX_PATCH.has(name)) {
    const file = /\*\*\* (?:Update|Add|Delete) File:\s*(\S[^\n]*)/.exec(text)?.[1]?.trim();
    return { ...payload, tool_name: 'Edit', tool_input: { file_path: file ?? '' } };
  }
  if (CODEX_READ.has(name)) {
    const path = input && typeof input === 'object' ? input.path ?? input.file_path ?? input.dir ?? '' : '';
    return { ...payload, tool_name: 'Read', tool_input: { file_path: String(path) } };
  }
  return payload;
}

export function normalizeEvent(payload, now) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const ai = KNOWN_AI.has(payload.office_ai) ? payload.office_ai : undefined;
  if (ai === 'codex') payload = adaptCodexPayload(payload);
  const sessionId = str(payload.session_id);
  const cwd = str(payload.cwd);
  const name = str(payload.hook_event_name);
  if (!sessionId || !cwd || !name) return null;

  const base = { sessionId, cwd, ts: now, ...(ai ? { ai } : {}) };
  const agent = () => {
    const agentId = str(payload.agent_id);
    return agentId ? { agentId, agentType: str(payload.agent_type) } : {};
  };

  switch (name) {
    case 'SessionStart': return { ...base, type: 'start' };
    case 'SessionEnd': return { ...base, type: 'end' };
    case 'Stop': return { ...base, type: 'stop', assistantText: maskedText(payload.last_assistant_message, RESPONSE_LIMIT), asksQuestion: asksQuestion(payload.last_assistant_message) };
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
        edit: name === 'PreToolUse' ? editRecord(tool, payload.tool_input) : undefined,
        detail: detailOf(payload.tool_input),
        ...agent(),
      };
    }
    case 'PermissionRequest':
      return { ...base, type: 'wait', waitKind: 'approval', activity: 'response', toolActivity: activityOf(str(payload.tool_name), rawDetailOf(payload.tool_input)), detail: detailOf(payload.tool_input), ...agent() };
    case 'Notification':
      return payload.notification_type === 'permission_prompt' ? { ...base, type: 'wait', waitKind: 'approval', activity: 'response' } : null;
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
