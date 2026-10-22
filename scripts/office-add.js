#!/usr/bin/env node
// 사용: node scripts/office-add.js <폴더> [이름]   (config.json에 프로젝트 추가, 최대 6개)
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addProject } from '../src/config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [folder, name] = process.argv.slice(2);
if (!folder) {
  console.error('사용법: office-add.js <폴더> [이름]');
  process.exit(2);
}
try {
  const p = addProject(process.env.CLAUDE_OFFICE_CONFIG ?? join(root, 'config.json'), resolve(folder), name);
  console.log(`추가됨: ${p.name} → ${p.path}`);
  // config.json 에 mirrors 가 있으면 다른 PC 의 설정에도 같이 반영한다(실패해도 추가 자체는 유지)
  const sync = spawnSync(process.execPath, [join(root, 'scripts', 'sync-teams.js')], { encoding: 'utf8' });
  process.stdout.write(sync.stdout ?? '');
  process.stderr.write(sync.stderr ?? '');
} catch (e) {
  console.error(`추가하지 못했습니다: ${e.message}`);
  process.exit(1);
}
