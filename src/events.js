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
      if (name === 'PreToolUse' && USER_WAIT_TOOLS[tool]) return { ...base, type: 'wait', waitKind: USER_WAIT_TOOLS[tool], ...agent() };
      return {
        ...base,
        type: name === 'PreToolUse' ? 'tool' : 'toolDone',
        category: toolCategory(tool),
        toolName: tool,
        filePath: editedPath(tool, payload.tool_input),
        detail: detailOf(payload.tool_input),
        ...agent(),
      };
    }
    case 'PermissionRequest':
      return { ...base, type: 'wait', waitKind: 'approval', detail: detailOf(payload.tool_input), ...agent() };
    case 'Notification':
      return payload.notification_type === 'permission_prompt' ? { ...base, type: 'wait', waitKind: 'approval' } : null;
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
