#!/usr/bin/env node
// Claude Code hook: stdin의 hook JSON을 로컬 서버로 보낸다. 실패해도 조용히 종료 코드 0.
import http from 'node:http';
import { readFileSync } from 'node:fs';

// 요약기가 띄운 claude 세션의 hook은 무시한다(재귀·루프 방지)
if (process.env.CLAUDE_OFFICE_SUMMARIZER) process.exit(0);

// 서버 주소: 환경변수 > config.json의 port > 9410. 포트는 config.json 한 곳에서만 정한다.
function resolveBase() {
  if (process.env.CLAUDE_OFFICE_URL) return process.env.CLAUDE_OFFICE_URL;
  try {
    const cfg = process.env.CLAUDE_OFFICE_CONFIG || new URL('../config.json', import.meta.url);
    const { port } = JSON.parse(readFileSync(cfg, 'utf8'));
    if (Number.isInteger(port)) return `http://127.0.0.1:${port}`;
  } catch { /* 설정이 없거나 깨져 있으면 기본값 */ }
  return 'http://127.0.0.1:9410';
}
const base = resolveBase();

const done = () => process.exit(0);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    const url = new URL('/event', base);
    const req = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 1000 },
      (res) => { res.resume(); res.on('end', done); res.on('error', done); },
    );
    req.on('timeout', () => { req.destroy(); done(); });
    req.on('error', done);
    req.end(input);
    setTimeout(done, 1200).unref();
  } catch {
    done();
  }
});
process.stdin.on('error', done);
