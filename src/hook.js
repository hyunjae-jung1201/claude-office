#!/usr/bin/env node
// Claude Code hook: stdin의 hook JSON을 로컬 서버로 보낸다. 실패해도 조용히 종료 코드 0.
import http from 'node:http';

const base = process.env.CLAUDE_OFFICE_URL || 'http://127.0.0.1:7410';

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
