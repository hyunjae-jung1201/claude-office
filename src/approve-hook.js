#!/usr/bin/env node
// Claude Code PermissionRequest hook: 승인 요청을 Claude Office 서버(/approval)에 올려 두고, 사무실 화면에서 허용/거절하면 그 결정을 Claude Code 에 돌려준다.
// 결정이 없으면(시간 초과·화면이 없음·서버가 꺼짐) 아무것도 출력하지 않아 원래의 승인 창이 그대로 쓰인다. 항상 종료 코드 0.
import http from 'node:http';
import { readFileSync } from 'node:fs';

if (process.env.CLAUDE_OFFICE_SUMMARIZER || process.env.CLAUDE_OFFICE_ROLE) process.exit(0);

function readConfig() {
  try {
    return JSON.parse(readFileSync(process.env.CLAUDE_OFFICE_CONFIG || new URL('../config.json', import.meta.url), 'utf8'));
  } catch { return {}; }
}
const cfg = readConfig();
const base = process.env.CLAUDE_OFFICE_URL || (Number.isInteger(cfg.port) ? `http://127.0.0.1:${cfg.port}` : 'http://127.0.0.1:9410');
const waitMs = ((Number.isFinite(cfg.approvals?.waitSeconds) ? cfg.approvals.waitSeconds : 45) + 8) * 1000;

const done = () => process.exit(0);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    const req = http.request(new URL('/approval', base), { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); res.on('end', done); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 10_000) body += c; });
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          if (r?.behavior === 'allow') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));
          else if (r?.behavior === 'deny') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: typeof r.message === 'string' ? r.message.slice(0, 200) : '거절했습니다', interrupt: false } } }));
        } catch { /* 형식이 다르면 결정 없음 */ }
        done();
      });
      res.on('error', done);
    });
    req.on('error', done);
    req.end(input);
    setTimeout(done, waitMs).unref();
  } catch { done(); }
});
process.stdin.on('error', done);
