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

test('아주 긴 명령도 빠르게 처리되고 detail은 200자 이하이며 비밀이 새지 않는다', () => {
  const t0 = Date.now();
  const ev = normalizeEvent({
    session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'sk-aaaaaaaaaaaaaaaaaaaa '.repeat(5000) },
  }, NOW);
  assert.ok(Date.now() - t0 < 500);
  assert.ok(ev.detail.length <= 200);
  assert.ok(!ev.detail.includes('sk-'));
});
test('자르는 경계에 걸친 토큰의 일부가 detail에 남지 않는다', () => {
  const ev = normalizeEvent({
    session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'x '.repeat(399) + 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
  }, NOW);
  assert.ok(!ev.detail.includes('ghp_'));
});

test('AskUserQuestion/ExitPlanMode PreToolUse는 wait(답변/계획 승인)이고, PermissionRequest는 approval', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse' };
  const ask = normalizeEvent({ ...base, tool_name: 'AskUserQuestion', tool_input: {} }, NOW);
  assert.deepEqual([ask.type, ask.waitKind], ['wait', 'answer']);
  const plan = normalizeEvent({ ...base, tool_name: 'ExitPlanMode', tool_input: {} }, NOW);
  assert.deepEqual([plan.type, plan.waitKind], ['wait', 'plan']);
  const perm = normalizeEvent({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' } }, NOW);
  assert.deepEqual([perm.type, perm.waitKind], ['wait', 'approval']);
});

// ---- 역할자 검토용 보강 필드
test('편집 도구는 toolName과 마스킹하지 않은 filePath를 가진다, 읽기 도구는 filePath가 없다', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse' };
  const edit = normalizeEvent({ ...base, tool_name: 'Edit', tool_input: { file_path: '/r/src/0123456789abcdef0123456789abcdef.js' } }, NOW);
  assert.deepEqual([edit.toolName, edit.filePath], ['Edit', '/r/src/0123456789abcdef0123456789abcdef.js']);
  const nb = normalizeEvent({ ...base, tool_name: 'NotebookEdit', tool_input: { notebook_path: '/r/a.ipynb' } }, NOW);
  assert.equal(nb.filePath, '/r/a.ipynb');
  const write = normalizeEvent({ ...base, tool_name: 'Write', tool_input: { file_path: '/r/new.md' } }, NOW);
  assert.equal(write.filePath, '/r/new.md');
  const read = normalizeEvent({ ...base, tool_name: 'Read', tool_input: { file_path: '/r/a.js' } }, NOW);
  assert.equal(read.toolName, 'Read');
  assert.equal(read.filePath, undefined);
  const done = normalizeEvent({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/r/a.js' } }, NOW);
  assert.equal(done.toolName, 'Edit');
});

test('filePath는 1000자까지만, 문자열이 아니면 없다', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Edit' };
  assert.equal(normalizeEvent({ ...base, tool_input: { file_path: '/' + 'a'.repeat(3000) } }, NOW).filePath, undefined);
  assert.equal(normalizeEvent({ ...base, tool_input: { file_path: 42 } }, NOW).filePath, undefined);
  assert.equal(normalizeEvent({ ...base, tool_input: null }, NOW).filePath, undefined);
});

test('prompt는 마스킹된 promptText(300자), 하위 에이전트 알림은 여전히 null', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'UserPromptSubmit' };
  const ev = normalizeEvent({ ...base, prompt: '로그인을 고쳐줘 sk-abcdefghijklmnopqrstuvwx1234 ' + 'x'.repeat(500) }, NOW);
  assert.equal(ev.type, 'prompt');
  assert.ok(ev.promptText.length <= 300);
  assert.ok(!ev.promptText.includes('sk-abcdefghijklmnopqrstuvwx1234'));
  assert.ok(ev.promptText.startsWith('로그인을 고쳐줘'));
  assert.equal(normalizeEvent({ ...base, prompt: '<task-notification>x' }, NOW), null);
  assert.equal(normalizeEvent({ ...base }, NOW).promptText, undefined);
});

test('stop은 마스킹된 assistantText(2000자)를 가진다', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'Stop' };
  const ev = normalizeEvent({ ...base, last_assistant_message: '완료했습니다. token=abcd1234efgh ' + 'y'.repeat(3000) }, NOW);
  assert.ok(ev.assistantText.length <= 2000);
  assert.ok(!ev.assistantText.includes('abcd1234efgh'));
  assert.equal(normalizeEvent(base, NOW).assistantText, undefined);
});
