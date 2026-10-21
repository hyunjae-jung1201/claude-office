#!/usr/bin/env node
// 사용: node scripts/office-add.js <폴더> [이름]   (config.json에 프로젝트 추가, 최대 5개)
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
} catch (e) {
  console.error(`추가하지 못했습니다: ${e.message}`);
  process.exit(1);
}
