import { maskSecrets } from './mask.js';

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const DETAIL_LIMIT = 200;

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
  return maskSecrets(v).slice(0, DETAIL_LIMIT);
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
