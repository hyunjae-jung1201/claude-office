#!/usr/bin/env node
// 다른 PC 가 ssh 로 밀어 넣는 세션 기록 줄(remote-tail.cjs 의 출력)을 받아 이 PC 의 Claude Office 서버(/ingest)로 넘긴다.
// 사용: <다른 PC>에서  node src/remote-tail.cjs | ssh 이_PC "node ~/projects/claude-office/src/ingest.js <원격이름>"
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { TOKEN_HEADER, readToken } from './token.js';

const name = process.argv[2];
if (!name) { console.error('사용: node src/ingest.js <원격이름>'); process.exit(2); }

function resolveBase() {
  if (process.env.CLAUDE_OFFICE_URL) return process.env.CLAUDE_OFFICE_URL;
  try {
    const cfg = process.env.CLAUDE_OFFICE_CONFIG || new URL('../config.json', import.meta.url);
    const { port } = JSON.parse(readFileSync(cfg, 'utf8'));
    if (Number.isInteger(port)) return `http://127.0.0.1:${port}`;
  } catch { /* 설정이 없으면 기본값 */ }
  return 'http://127.0.0.1:9410';
}
const base = resolveBase();

const FLUSH_MS = 250;
const MAX_LINES = 200;
let batch = [];
let pending = 0;
let timer = null;
let warned = false;

function post(lines) {
  pending += 1;
  const done = () => { pending -= 1; if (ended && pending === 0) process.exit(0); };
  try {
    const req = http.request(new URL(`/ingest?remote=${encodeURIComponent(name)}`, base), { method: 'POST', headers: { 'content-type': 'application/x-ndjson', ...(readToken() ? { [TOKEN_HEADER]: readToken() } : {}) }, timeout: 3000 }, (res) => { res.resume(); res.on('end', done); res.on('error', done); });
    req.on('timeout', () => { req.destroy(); });
    req.on('error', () => { if (!warned) { warned = true; console.error('Claude Office 서버에 보내지 못했습니다(서버가 꺼져 있을 수 있음). 계속 시도합니다.'); } done(); });
    req.end(lines.join('\n'));
  } catch { done(); }
}

function flush() {
  clearTimeout(timer);
  timer = null;
  if (batch.length === 0) return;
  const lines = batch;
  batch = [];
  post(lines);
}

let ended = false;
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  batch.push(line);
  if (batch.length >= MAX_LINES) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}).on('close', () => {
  ended = true;
  flush();
  if (pending === 0) process.exit(0);
  setTimeout(() => process.exit(0), 4000).unref();
});
