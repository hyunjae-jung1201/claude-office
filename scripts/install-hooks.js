#!/usr/bin/env node
// Claude Code 전역 설정에 hook을 "추가만" 한다. 기본은 바뀔 내용만 보여 주고, --apply를 줄 때만 쓴다.
// 사용: node scripts/install-hooks.js [--apply] [--settings 파일] [--command "명령"]
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PermissionRequest', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop',
];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

const hasCommand = (group, command) => (group.hooks ?? []).some((h) => h.command === command);

export function buildHookSettings(existing, command) {
  const out = structuredClone(existing ?? {});
  out.hooks ??= {};
  for (const event of HOOK_EVENTS) {
    const groups = (out.hooks[event] ??= []);
    if (groups.some((g) => hasCommand(g, command))) continue;
    const group = { hooks: [{ type: 'command', command, timeout: 2 }] };
    if (TOOL_EVENTS.has(event)) group.matcher = '*';
    groups.push(group);
  }
  return out;
}

export function describeChanges(before, after) {
  const lines = [];
  for (const event of HOOK_EVENTS) {
    const had = new Set((before.hooks?.[event] ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command)));
    for (const g of after.hooks?.[event] ?? []) {
      for (const h of g.hooks ?? []) if (!had.has(h.command)) lines.push(`+ ${event}: ${h.command}`);
    }
  }
  return lines;
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const settingsPath = arg('--settings') ?? join(homedir(), '.claude', 'settings.json');
  const command = arg('--command') ?? `node ${join(root, 'src', 'hook.js')}`;

  const before = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  const after = buildHookSettings(before, command);
  const lines = describeChanges(before, after);

  if (lines.length === 0) return console.log(`변경 없음: ${settingsPath} 에 이미 설치돼 있습니다.`);
  console.log(`${settingsPath} 에 추가할 hook (기존 항목은 그대로 유지):`);
  lines.forEach((l) => console.log('  ' + l));

  if (!argv.includes('--apply')) return console.log('\n적용하려면 --apply 를 붙여 다시 실행하세요. (아직 아무것도 바꾸지 않았습니다)');

  if (existsSync(settingsPath)) {
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    let backup = `${settingsPath}.bak-${stamp}`;
    for (let n = 2; existsSync(backup); n++) backup = `${settingsPath}.bak-${stamp}-${n}`; // 같은 날 다시 실행해도 처음 백업을 덮어쓰지 않는다
    copyFileSync(settingsPath, backup);
    console.log(`백업: ${backup}`);
  }
  const tmp = `${settingsPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(after, null, 2) + '\n');
  renameSync(tmp, settingsPath); // 쓰는 도중 중단돼도 설정 파일이 깨지지 않게
  console.log('적용했습니다. 새로 시작하는 Claude Code 세션부터 반영됩니다.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
