import { maskSecrets } from './mask.js';

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const DETAIL_LIMIT = 200;
const PRE_MASK_LIMIT = DETAIL_LIMIT * 4; // 마스킹 전에 먼저 자른다(입력 크기 제한)

export function toolCategory(toolName) {
  if (READ_TOOLS.has(toolName)) return 'read';
  if (toolName === 'Bash') return 'run';
  return 'write';
}

function detailOf(input) {
  if (!input || typeof input !== 'object') return undefined;
  const v = input.command ?? input.file_path ?? input.notebook_path ?? input.path ?? input.pattern
    ?? input.url ?? input.query ?? input.description;
  if (typeof v !== 'string' || !v) return undefined;
  // 자르는 경계에 걸친 토큰 조각이 가려지지 않은 채 남지 않도록 마지막 단어를 버린다.
  const cut = v.length > PRE_MASK_LIMIT ? v.slice(0, PRE_MASK_LIMIT).replace(/\S*$/, '') : v;
  return maskSecrets(cut).slice(0, DETAIL_LIMIT);
}

const str = (v) => (typeof v === 'string' && v ? v : undefined);

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
    case 'Stop': return { ...base, type: 'stop' };
    case 'UserPromptSubmit': {
      const prompt = str(payload.prompt);
      if (prompt?.startsWith('<task-notification>')) return null;
      return { ...base, type: 'prompt' };
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      const tool = str(payload.tool_name);
      if (!tool) return null;
      return {
        ...base,
        type: name === 'PreToolUse' ? 'tool' : 'toolDone',
        category: toolCategory(tool),
        detail: detailOf(payload.tool_input),
        ...agent(),
      };
    }
    case 'PermissionRequest':
      return { ...base, type: 'wait', detail: detailOf(payload.tool_input), ...agent() };
    case 'Notification':
      return payload.notification_type === 'permission_prompt' ? { ...base, type: 'wait' } : null;
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
