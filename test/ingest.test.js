import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INGEST = fileURLToPath(new URL('../src/ingest.js', import.meta.url));

function listen() {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { got.push({ url: req.url, type: req.headers['content-type'], body }); res.writeHead(204).end(); });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, got, port: server.address().port })));
}
const run = (args, input, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [INGEST, ...args], { env: { ...process.env, ...env } });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  child.stdin.end(input);
  child.on('close', (code) => resolve({ code, err }));
});

test('ingest.js: 표준입력의 줄을 묶어 /ingest?remote=이름 으로 보내고, 입력이 끝나면 종료 코드 0', async () => {
  const { server, got, port } = await listen();
  const r = await run(['PC1'], '{"a":1}\n{"b":2}\n', { CLAUDE_OFFICE_URL: `http://127.0.0.1:${port}` });
  server.close();
  assert.equal(r.code, 0);
  assert.ok(got.length >= 1);
  for (const g of got) { assert.equal(g.url, '/ingest?remote=PC1'); assert.equal(g.type, 'application/x-ndjson'); }
  assert.deepEqual(got.flatMap((g) => g.body.split('\n').filter(Boolean)), ['{"a":1}', '{"b":2}']); // 순서와 내용이 그대로
});

test('ingest.js: 서버가 꺼져 있어도 멈추지 않고 입력이 끝나면 종료하며, 이름이 없으면 오류 종료', async () => {
  const a = await run(['PC1'], '{"a":1}\n', { CLAUDE_OFFICE_URL: 'http://127.0.0.1:1' });
  assert.equal(a.code, 0);
  const b = await run([], '', { CLAUDE_OFFICE_URL: 'http://127.0.0.1:1' });
  assert.notEqual(b.code, 0);
});
