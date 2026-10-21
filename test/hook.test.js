import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../src/hook.js', import.meta.url));

function runHook(input, env = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
    child.stdin.end(input);
    child.on('close', (code) => resolve({ code, ms: Date.now() - started }));
  });
}

test('서버가 꺼져 있어도 종료 코드 0이고 1.5초 안에 끝난다', async () => {
  const { code, ms } = await runHook('{"session_id":"s1"}', { CLAUDE_OFFICE_URL: 'http://127.0.0.1:1' });
  assert.equal(code, 0);
  assert.ok(ms < 1500, `took ${ms}ms`);
});

test('서버가 있으면 stdin JSON이 /event 본문으로 도착한다', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received = { method: req.method, url: req.url, body };
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const payload = '{"session_id":"s1","hook_event_name":"SessionStart","cwd":"/x"}';
  const { code } = await runHook(payload, { CLAUDE_OFFICE_URL: `http://127.0.0.1:${port}` });
  server.close();
  assert.equal(code, 0);
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/event');
  assert.equal(received.body, payload);
});

test('응답 없는 서버에도 1.5초 안에 끝난다 (타임아웃 1초)', async () => {
  const server = http.createServer(() => {}); // never responds
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const { code, ms } = await runHook('{"a":1}', { CLAUDE_OFFICE_URL: `http://127.0.0.1:${port}` });
  server.closeAllConnections?.();
  server.close();
  assert.equal(code, 0);
  assert.ok(ms < 1500, `took ${ms}ms`);
});

// ---- 최종 검토: 포트는 config.json 한 곳에서만 정한다
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLAUDE_OFFICE_URL이 없으면 설정 파일의 port로 보낸다', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { received = body; res.writeHead(204).end(); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const cfg = join(mkdtempSync(join(tmpdir(), 'office-hook-')), 'config.json');
  writeFileSync(cfg, JSON.stringify({ port, projects: [] }));
  const { code } = await runHook('{"session_id":"s9"}', { CLAUDE_OFFICE_URL: '', CLAUDE_OFFICE_CONFIG: cfg });
  server.close();
  assert.equal(code, 0);
  assert.equal(received, '{"session_id":"s9"}');
});
