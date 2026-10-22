#!/usr/bin/env node
// Claude Code hook: stdin의 hook JSON을 로컬 서버로 보낸다. 실패해도 조용히 종료 코드 0.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { TOKEN_HEADER, readToken } from './token.js';

// 요약기·역할자가 띄운 claude 세션의 hook은 무시한다(재귀·루프 방지)
if (process.env.CLAUDE_OFFICE_SUMMARIZER || process.env.CLAUDE_OFFICE_ROLE) process.exit(0);

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
    let hookEvent;
    try { hookEvent = JSON.parse(input)?.hook_event_name; } catch { /* 본문 형식은 서버가 판단한다 */ }
    const url = new URL('/event', base);
    const req = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', ...(readToken() ? { [TOKEN_HEADER]: readToken() } : {}) }, timeout: 1000 },
      (res) => {
        // 200 이면 서버가 이 세션에 전할 역할자 의견을 실어 보낸 것. 이 훅이 UserPromptSubmit 일 때만, 새 객체에
        // additionalContext 문자열 하나만 담아 출력한다(서버 응답의 다른 필드 — 권한 결정 등 — 는 절대 전달하지 않는다).
        if (res.statusCode !== 200) { res.resume(); res.on('end', done); res.on('error', done); return; }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (body.length < 20_000) body += c; });
        res.on('error', done);
        res.on('end', () => {
          try {
            const ctx = JSON.parse(body)?.hookSpecificOutput?.additionalContext;
            if (hookEvent === 'UserPromptSubmit' && typeof ctx === 'string' && ctx) {
              process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx.slice(0, 10_000) } }));
            }
          } catch { /* 형식이 다르면 무시 */ }
          done();
        });
      },
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
