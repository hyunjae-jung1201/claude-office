#!/usr/bin/env node
// 이 PC 의 팀을 config.json 의 mirrors 에 적힌 다른 PC 의 Claude Office 설정에 맞추고, 그쪽 서비스를 다시 시작한다.
// 사용: node scripts/sync-teams.js [--dry-run]
//   config.json:  "mirrors": [{ "name": "PC1", "ssh": "사용자@주소", "root": "/절대/경로/claude-office", "key": "~/.ssh/키(선택)" }]
//   name 은 그 PC 에서 이 PC 를 부르는 이름(그쪽 config 의 remotes[].name 과 같다).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMirror } from '../src/mirror.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry-run');
const localPath = process.env.CLAUDE_OFFICE_CONFIG ?? join(root, 'config.json');
const local = JSON.parse(readFileSync(localPath, 'utf8'));
const mirrors = local.mirrors ?? [];
if (mirrors.length === 0) { console.log('config.json 에 mirrors 가 없어 맞출 곳이 없습니다.'); process.exit(0); }

const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const sshBase = (m) => ['-i', expand(m.key ?? '~/.ssh/claude_office_ed25519'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', m.ssh];
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

let failed = 0;
for (const m of mirrors) {
  try {
    if (!m.name || !m.ssh || !m.root?.startsWith('/')) throw new Error('mirrors 항목에 name, ssh, root(절대 경로)가 필요합니다');
    const cfgPath = `${m.root}/config.json`;
    const remote = JSON.parse(execFileSync('ssh', [...sshBase(m), `cat ${quote(cfgPath)}`], { encoding: 'utf8', timeout: 30_000 }));
    const next = mergeMirror(remote, local, m.name);
    const names = (cfg) => new Set((cfg.projects ?? []).filter((p) => p.host === m.name).map((p) => p.name));
    const before = names(remote);
    const after = names(next);
    const added = [...after].filter((n) => !before.has(n));
    const removed = [...before].filter((n) => !after.has(n));
    const changed = canon(remote.projects) !== canon(next.projects) || canon(remote.remotes) !== canon(next.remotes);
    console.log(`[${m.name}] 이 PC 팀 ${after.size}개 · 추가 ${added.join(', ') || '없음'} · 삭제 ${removed.join(', ') || '없음'}${changed ? '' : ' · 변경 없음'}`);
    if (!changed || dry) continue;
    execFileSync('ssh', [...sshBase(m), `cat > ${quote(cfgPath + '.tmp')} && mv ${quote(cfgPath + '.tmp')} ${quote(cfgPath)} && systemctl --user restart claude-office`], { input: JSON.stringify(next, null, 2) + '\n', timeout: 30_000 });
    console.log(`[${m.name}] 설정을 맞추고 서비스를 다시 시작했습니다.`);
  } catch (e) {
    failed += 1;
    console.error(`[${m.name ?? '?'}] 맞추지 못했습니다: ${String(e.message).split('\n')[0]}`);
  }
}
process.exit(failed ? 1 : 0);
