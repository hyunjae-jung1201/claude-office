import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeEvent, toolCategory } from '../src/events.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const NOW = 1_000_000;

test('toolCategory: 읽기/쓰기/실행 분류', () => {
  for (const t of ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']) assert.equal(toolCategory(t), 'read');
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'Task', 'Agent', 'mcp__x__y', 'Whatever']) assert.equal(toolCategory(t), 'write');
  assert.equal(toolCategory('Bash'), 'run');
});

test('Bash PreToolUse → tool/run, detail에 명령', () => {
  const ev = normalizeEvent(fx('pre-tool-bash'), NOW);
  assert.deepEqual(
    { type: ev.type, category: ev.category, sessionId: ev.sessionId, cwd: ev.cwd, ts: ev.ts, agentId: ev.agentId },
    { type: 'tool', category: 'run', sessionId: 'sess-1', cwd: '/work/a', ts: NOW, agentId: undefined },
  );
  assert.match(ev.detail, /wget https:\/\/example\.com\/train\.zip/);
});

test('PermissionRequest → wait', () => {
  const ev = normalizeEvent(fx('permission-request'), NOW);
  assert.equal(ev.type, 'wait');
  assert.equal(ev.detail, 'rm -f out.txt');
});

test('하위 에이전트 안의 도구 호출은 agentId/agentType을 가진다', () => {
  const ev = normalizeEvent(fx('subagent-tool'), NOW);
  assert.equal(ev.type, 'tool');
  assert.equal(ev.category, 'read');
  assert.equal(ev.agentId, 'a4502aa6e3dc370ca');
  assert.equal(ev.agentType, 'general-purpose');
  assert.equal(ev.detail, '/work/a/data/notes.txt');
});

test('세션/에이전트 수명 이벤트', () => {
  const base = { session_id: 's', cwd: '/c' };
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'SessionStart' }, NOW).type, 'start');
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'SessionEnd' }, NOW).type, 'end');
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'Stop' }, NOW).type, 'stop');
  const a = normalizeEvent({ ...base, hook_event_name: 'SubagentStart', agent_id: 'x', agent_type: 'Explore' }, NOW);
  assert.deepEqual([a.type, a.agentId, a.agentType], ['agentStart', 'x', 'Explore']);
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'SubagentStop', agent_id: 'x' }, NOW).type, 'agentStop');
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} }, NOW).type, 'toolDone');
});

test('사용자 프롬프트는 prompt, 하위 에이전트 완료 알림은 무시(null)', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'UserPromptSubmit' };
  assert.equal(normalizeEvent({ ...base, prompt: '로그인 고쳐줘' }, NOW).type, 'prompt');
  assert.equal(normalizeEvent({ ...base, prompt: '<task-notification>\n<task-id>x</task-id>' }, NOW), null);
});

test('필드 누락·알 수 없는 이벤트·이상한 입력은 null', () => {
  assert.equal(normalizeEvent({ cwd: '/c', hook_event_name: 'Stop' }, NOW), null);
  assert.equal(normalizeEvent({ session_id: 's', hook_event_name: 'Stop' }, NOW), null);
  assert.equal(normalizeEvent({ session_id: 's', cwd: '/c' }, NOW), null);
  assert.equal(normalizeEvent({ session_id: 's', cwd: '/c', hook_event_name: 'Mystery' }, NOW), null);
  for (const bad of [null, undefined, 'str', 42, [], true]) assert.equal(normalizeEvent(bad, NOW), null);
});

test('detail에는 비밀값이 없고 200자로 제한된다', () => {
  const ev = normalizeEvent({
    session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'curl -H "Authorization: Bearer abc123def456ghi789jkl" ' + 'x'.repeat(400) },
  }, NOW);
  assert.ok(!ev.detail.includes('abc123def456ghi789jkl'));
  assert.ok(ev.detail.length <= 200);
  const env = normalizeEvent({ session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/work/a/.env' } }, NOW);
  assert.ok(!env.detail.includes('.env'));
});
