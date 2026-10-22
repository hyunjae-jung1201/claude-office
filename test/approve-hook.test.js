import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../src/approve-hook.js', import.meta.url));
const PAYLOAD = JSON.stringify({ session_id: 's1', cwd: '/w', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });

const run = (env, input = PAYLOAD) => new Promise((resolve) => {
  const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stdin.end(input);
  child.on('close', (code) => resolve({ code, out }));
});
const serve = (handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });

test('서버가 허용(200 JSON)하면 Claude Code 가 읽는 PermissionRequest 결정을 출력한다', async () => {
  let got;
  const { s, url } = await serve((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got = { url: req.url, b }; res.writeHead(200, { 'content-type': 'application/json' }).end('{"behavior":"allow"}'); }); });
  const r = await run({ CLAUDE_OFFICE_URL: url });
  s.close();
  assert.equal(r.code, 0);
  assert.equal(got.url, '/approval');
  assert.equal(JSON.parse(got.b).tool_name, 'Bash');
  assert.deepEqual(JSON.parse(r.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
});

test('거절은 behavior deny + 메시지, interrupt 는 false', async () => {
  const { s, url } = await serve((req, res) => { req.resume(); req.on('end', () => res.writeHead(200).end('{"behavior":"deny","message":"사무실 화면에서 거절했습니다"}')); });
  const r = await run({ CLAUDE_OFFICE_URL: url });
  s.close();
  assert.deepEqual(JSON.parse(r.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: '사무실 화면에서 거절했습니다', interrupt: false } } });
});

test('결정이 없으면(204)·서버가 꺼져 있으면·이상한 응답이면 아무것도 출력하지 않고 종료 코드 0', async () => {
  const a = await serve((req, res) => { req.resume(); req.on('end', () => res.writeHead(204).end()); });
  const r1 = await run({ CLAUDE_OFFICE_URL: a.url }); a.s.close();
  assert.deepEqual([r1.code, r1.out], [0, '']);
  const r2 = await run({ CLAUDE_OFFICE_URL: 'http://127.0.0.1:1' });
  assert.deepEqual([r2.code, r2.out], [0, '']);
  const b = await serve((req, res) => { req.resume(); req.on('end', () => res.writeHead(200).end('{"behavior":"allow-everything"}')); });
  const r3 = await run({ CLAUDE_OFFICE_URL: b.url }); b.s.close();
  assert.deepEqual([r3.code, r3.out], [0, '']); // behavior 값은 allow/deny 만 인정
});

test('역할자·요약기가 띄운 세션의 훅은 무시한다', async () => {
  const { s, url } = await serve((req, res) => { req.resume(); req.on('end', () => res.writeHead(200).end('{"behavior":"allow"}')); });
  const r = await run({ CLAUDE_OFFICE_URL: url, CLAUDE_OFFICE_ROLE: '1' });
  s.close();
  assert.deepEqual([r.code, r.out], [0, '']);
});
