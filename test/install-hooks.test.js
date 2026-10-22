import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHookSettings, describeChanges, HOOK_EVENTS } from '../scripts/install-hooks.js';

const CMD = 'node /home/me/claude-office/src/hook.js';
const commandsOf = (settings, event) => (settings.hooks?.[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));

test('빈 설정에도 대상 이벤트마다 hook이 추가된다', () => {
  const out = buildHookSettings({}, CMD);
  for (const e of HOOK_EVENTS) assert.deepEqual(commandsOf(out, e), [CMD], e);
});

test('기존 hook과 다른 설정은 그대로 유지하고 추가만 한다', () => {
  const existing = {
    model: 'opus',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'check-log.sh' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
      CustomEvent: [{ hooks: [{ type: 'command', command: 'x' }] }],
    },
  };
  const out = buildHookSettings(existing, CMD);
  assert.equal(out.model, 'opus');
  assert.deepEqual(commandsOf(out, 'Stop'), ['check-log.sh', CMD]);
  assert.deepEqual(commandsOf(out, 'PreToolUse'), ['guard.sh', CMD]);
  assert.deepEqual(out.hooks.CustomEvent, existing.hooks.CustomEvent);
  assert.equal(out.hooks.PreToolUse[0].matcher, 'Bash');
});

test('두 번 적용해도 항목 수가 같다 (멱등)', () => {
  const once = buildHookSettings({}, CMD);
  const twice = buildHookSettings(once, CMD);
  assert.deepEqual(twice, once);
});

test('입력 객체를 바꾸지 않는다', () => {
  const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] } };
  const snapshot = JSON.stringify(existing);
  buildHookSettings(existing, CMD);
  assert.equal(JSON.stringify(existing), snapshot);
});

test('도구 이벤트에는 matcher "*", 그 밖의 이벤트에는 matcher가 없다, timeout이 설정된다', () => {
  const out = buildHookSettings({}, CMD);
  const mine = (e) => out.hooks[e].find((g) => g.hooks.some((h) => h.command === CMD));
  assert.equal(mine('PreToolUse').matcher, '*');
  assert.equal(mine('PostToolUse').matcher, '*');
  assert.equal('matcher' in mine('Stop'), false);
  assert.ok(mine('Stop').hooks[0].timeout <= 2);
});

test('describeChanges는 추가될 항목만 한 줄씩 알려 준다', () => {
  const before = buildHookSettings({}, CMD);
  assert.deepEqual(describeChanges(before, buildHookSettings(before, CMD)), []);
  const lines = describeChanges({}, buildHookSettings({}, CMD));
  assert.equal(lines.length, HOOK_EVENTS.length);
  assert.ok(lines.every((l) => l.includes(CMD)));
});

test('필요한 이벤트가 모두 들어 있다', () => {
  for (const e of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop']) {
    assert.ok(HOOK_EVENTS.includes(e), e);
  }
});

test('--approvals: PermissionRequest 에 승인 훅(긴 timeout)을 추가하고, 이미 있으면 다시 넣지 않는다', async () => {
  const { buildApprovalHookSettings } = await import('../scripts/install-hooks.js');
  const before = { hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'node /x/hook.js', timeout: 2 }] }] }, other: 1 };
  const after = buildApprovalHookSettings(before, 'node /x/approve-hook.js', 60);
  const groups = after.hooks.PermissionRequest;
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], before.hooks.PermissionRequest[0]); // 기존 항목 그대로
  assert.deepEqual(groups[1].hooks[0], { type: 'command', command: 'node /x/approve-hook.js', timeout: 60 });
  assert.equal(after.other, 1);
  assert.deepEqual(buildApprovalHookSettings(after, 'node /x/approve-hook.js', 60), after); // 멱등
});
