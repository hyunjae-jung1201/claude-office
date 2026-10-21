import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSummarizer } from '../src/summarizer.js';

const ev = (extra = {}) => ({ sessionId: 's', cwd: '/w/a', ts: 0, type: 'tool', category: 'run', detail: 'wget https://x/train.zip', ...extra });

test('요약 결과를 줄바꿈 제거 후 20자로 자른다', async () => {
  const s = createSummarizer({ run: async () => '학습에 필요한\n데이터를 내려받는 중입니다 정말로 길게', minIntervalMs: 0 });
  const out = await s.summarize(ev());
  assert.ok(!out.includes('\n'));
  assert.ok(out.length <= 20, out);
  assert.ok(out.endsWith('…'));
});

test('짧은 결과는 그대로', async () => {
  const s = createSummarizer({ run: async () => '학습 데이터 다운 중', minIntervalMs: 0 });
  assert.equal(await s.summarize(ev()), '학습 데이터 다운 중');
});

test('run에는 마스킹된 detail만 들어간다', async () => {
  const seen = [];
  const s = createSummarizer({ run: async (prompt) => { seen.push(prompt); return '다운 중'; }, minIntervalMs: 0 });
  // 이벤트 정규화 이후의 detail이라 이미 마스킹돼 있지만, 요약기도 한 번 더 가린다
  await s.summarize(ev({ detail: 'curl -H "Authorization: Bearer abc123def456ghi789jkl" x' }));
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].includes('abc123def456ghi789jkl'));
});

test('같은 프로젝트·같은 category가 minIntervalMs 안에 오면 run 없이 규칙 문구', async () => {
  let calls = 0;
  let now = 0;
  const s = createSummarizer({ run: async () => { calls++; return '요약'; }, minIntervalMs: 5000, now: () => now });
  assert.equal(await s.summarize(ev()), '요약');
  now = 3000;
  assert.equal(await s.summarize(ev()), 'wget 실행 중'); // ruleLabel(run, 'wget …')
  assert.equal(calls, 1);
  now = 6000;
  assert.equal(await s.summarize(ev()), '요약');
  assert.equal(calls, 2);
});

test('다른 category이면 간격 제한에 걸리지 않는다', async () => {
  let calls = 0;
  const s = createSummarizer({ run: async () => { calls++; return '요약'; }, minIntervalMs: 5000, now: () => 0 });
  await s.summarize(ev({ category: 'run' }));
  await s.summarize(ev({ category: 'read', detail: '/w/a/f.txt' }));
  assert.equal(calls, 2);
});

test('run이 실패하면 규칙 문구', async () => {
  const s = createSummarizer({ run: async () => { throw new Error('boom'); }, minIntervalMs: 0 });
  assert.equal(await s.summarize(ev({ category: 'read', detail: '/w/a/f.txt' })), 'f.txt 읽는 중');
});

test('run이 8초 안에 끝나지 않으면 규칙 문구', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = createSummarizer({ run: () => new Promise(() => {}), minIntervalMs: 0 });
  const p = s.summarize(ev({ category: 'read', detail: '/w/a/f.txt' }));
  t.mock.timers.tick(8000);
  assert.equal(await p, 'f.txt 읽는 중');
});

test('빈 응답이면 규칙 문구', async () => {
  const s = createSummarizer({ run: async () => '  \n ', minIntervalMs: 0 });
  assert.equal(await s.summarize(ev()), 'wget 실행 중');
});

test('wait 이벤트는 호출 없이 규칙 문구 (승인 상태는 즉시 보여야 한다)', async () => {
  let calls = 0;
  const s = createSummarizer({ run: async () => { calls++; return 'x'; }, minIntervalMs: 0 });
  assert.equal(await s.summarize({ sessionId: 's', cwd: '/c', ts: 0, type: 'wait', detail: 'rm -f out.txt' }), '승인 기다리는 중');
  assert.equal(calls, 0);
});

test('CLAUDE_OFFICE_SUMMARIZER=1이면 hook.js는 아무것도 보내지 않는다', async () => {
  const http = await import('node:http');
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.writeHead(204).end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const hook = fileURLToPath(new URL('../src/hook.js', import.meta.url));
  const code = await new Promise((resolve) => {
    const c = spawn(process.execPath, [hook], { env: { ...process.env, CLAUDE_OFFICE_SUMMARIZER: '1', CLAUDE_OFFICE_URL: `http://127.0.0.1:${port}` } });
    c.stdin.end('{"session_id":"s"}');
    c.on('close', resolve);
  });
  server.close();
  assert.equal(code, 0);
  assert.equal(hits, 0);
});
