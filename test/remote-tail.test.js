import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, utimesSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../src/remote-tail.cjs', import.meta.url));
const line = (o) => JSON.stringify(o) + '\n';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startTail(root, extraEnv = {}) {
  // 이 PC의 실제 ~/.claude/sessions 가 섞이지 않도록 빈 임시 폴더를 쓴다
  const sessions = mkdtempSync(join(tmpdir(), 'tail-nosess-'));
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CLAUDE_PROJECTS_DIR: root, CLAUDE_SESSIONS_DIR: sessions, POLL_MS: '50', ...extraEnv } });
  const out = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  const stop = () => child.kill();
  process.once('exit', stop);
  return { out, stop };
}
const waitFor = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await sleep(30); } throw new Error('timeout'); };

const assistantTool = (name, input, id = 'tu1') => ({ type: 'assistant', sessionId: 'S1', cwd: '/home/me/accident', timestamp: '2026-10-21T06:00:01Z', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });

test('이미 있던 최근 세션은 init으로 알리고 과거 내용은 되풀이하지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'S1.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: '옛날 요청' } }) + line(assistantTool('Bash', { command: 'make' })));
  const t = startTail(root);
  const init = await waitFor(() => t.out.find((o) => o.k === 'init'));
  assert.equal(init.s, 'S1');
  assert.equal(init.c, '/home/me/accident');
  assert.equal(init.last, 'tool');
  assert.ok(init.age < 30);
  await sleep(200);
  assert.equal(t.out.filter((o) => o.k === 'prompt').length, 0);
  t.stop();
});

test('새로 추가된 줄만 요약해서 내보낸다 (내용 전체가 아니라 필요한 필드만)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'S1.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: '시작' } }));
  const t = startTail(root);
  await waitFor(() => t.out.find((o) => o.k === 'init'));
  appendFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: '로그인 화면을 고쳐줘 그리고 아주 긴 비밀 내용 '.repeat(20) } }));
  appendFileSync(f, line(assistantTool('Read', { file_path: '/home/me/accident/a.py', secret_extra: 'x'.repeat(5000) })));
  appendFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'y'.repeat(100000) }] } }));
  appendFileSync(f, line({ type: 'assistant', sessionId: 'S1', cwd: '/home/me/accident', message: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '...' }] } }));
  appendFileSync(f, line({ type: 'assistant', sessionId: 'S1', cwd: '/home/me/accident', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '끝' }] } }));
  appendFileSync(f, line({ type: 'system', sessionId: 'S1' }));
  await waitFor(() => t.out.find((o) => o.k === 'stop'));
  const kinds = t.out.filter((o) => o.k !== 'init' && o.k !== 'hello').map((o) => o.k);
  assert.deepEqual(kinds, ['prompt', 'tool', 'result', 'stop']); // thinking-only end_turn은 stop이 아님
  const tool = t.out.find((o) => o.k === 'tool');
  assert.deepEqual(tool.tools, [{ i: 'tu1', n: 'Read', d: '/home/me/accident/a.py' }]);
  assert.equal(t.out.find((o) => o.k === 'result').ids[0], 'tu1');
  assert.ok(t.out.find((o) => o.k === 'prompt').p.length <= 40);
  assert.ok(JSON.stringify(t.out).length < 3000, '긴 내용이 전송되면 안 된다');
  t.stop();
});

test('나중에 생긴 새 세션 파일은 처음부터 읽고, 하위 에이전트(sidechain)와 깊은 폴더는 무시한다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'), { recursive: true });
  const t = startTail(root);
  await sleep(200);
  writeFileSync(join(root, '-home-me', 'NEW.jsonl'), line({ type: 'user', sessionId: 'NEW', cwd: '/home/me/datasets', message: { content: '새 세션' } }) + line({ ...assistantTool('Bash', { command: 'ls' }), sessionId: 'NEW', isSidechain: true }));
  mkdirSync(join(root, '-home-me', 'NEW', 'subagents'), { recursive: true });
  writeFileSync(join(root, '-home-me', 'NEW', 'subagents', 'agent-1.jsonl'), line({ type: 'user', sessionId: 'NEW', cwd: '/x', message: { content: 'sub' } }));
  const p = await waitFor(() => t.out.find((o) => o.k === 'prompt'));
  assert.equal(p.s, 'NEW');
  assert.equal(p.c, '/home/me/datasets');
  await sleep(200);
  assert.equal(t.out.filter((o) => o.k === 'tool').length, 0);
  assert.equal(t.out.filter((o) => o.c === '/x').length, 0);
  t.stop();
});

test('오래된 파일(10분 이상 수정 없음)은 init을 내지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'OLD.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'OLD', cwd: '/home/me/x', message: { content: 'old' } }));
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  utimesSync(f, old, old);
  const t = startTail(root);
  await sleep(300);
  assert.equal(t.out.filter((o) => o.k !== 'hello').length, 0);
  t.stop();
});

test('실행 중인 세션 등록 정보(sessions/<pid>.json)의 이름을 n으로 붙인다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  const sess = mkdtempSync(join(tmpdir(), 'tail-sess-'));
  mkdirSync(join(root, '-home-me'));
  const f = join(root, '-home-me', 'S1.jsonl');
  writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me', message: { content: '시작' } }));
  writeFileSync(join(sess, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'S1', name: '사고 판별 모델', status: 'idle' }));
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CLAUDE_PROJECTS_DIR: root, CLAUDE_SESSIONS_DIR: sess, POLL_MS: '50' } });
  const out = [];
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  try {
    const init = await waitFor(() => out.find((o) => o.k === 'init'));
    assert.equal(init.n, '사고 판별 모델');
  } finally { child.kill(); }
});

test('살아 있는 세션의 상태를 live로 내보내고, 사라지면 gone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  const sess = mkdtempSync(join(tmpdir(), 'tail-sess-'));
  mkdirSync(join(root, '-home-me'));
  const regFile = join(sess, `${process.pid}.json`);
  const reg = (status) => JSON.stringify({ pid: process.pid, sessionId: 'S1', name: '사고 판별 모델', cwd: '/home/me', status });
  writeFileSync(regFile, reg('shell'));
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CLAUDE_PROJECTS_DIR: root, CLAUDE_SESSIONS_DIR: sess, POLL_MS: '50' } });
  const out = [];
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  try {
    const first = await waitFor(() => out.find((o) => o.k === 'live'));
    assert.deepEqual([first.s, first.n, first.st, first.c], ['S1', '사고 판별 모델', 'shell', '/home/me']);
    writeFileSync(regFile, reg('idle'));
    await waitFor(() => out.find((o) => o.k === 'live' && o.st === 'idle'));
    unlinkSync(regFile);
    await waitFor(() => out.find((o) => o.k === 'live' && o.st === 'gone'));
    assert.equal(out.filter((o) => o.k === 'live' && o.st === 'shell').length, 1); // 변화가 없으면 반복하지 않는다(하트비트는 30초 간격)
  } finally { child.kill(); }
});

// ---- 하위 에이전트 기록(<세션>/subagents/agent-*.jsonl)과 텍스트 포함 옵션
function tailEnv(root, extra = {}) {
  const sess = mkdtempSync(join(tmpdir(), 'tail-nosess-'));
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, CLAUDE_PROJECTS_DIR: root, CLAUDE_SESSIONS_DIR: sess, POLL_MS: '50', ...extra } });
  const out = [];
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  return { out, stop: () => child.kill() };
}
function agentSetup(root, { sid = 'S1', id = 'A1', meta = { agentType: 'Explore', description: '조사', finished: false }, lines = [], mtimeAgo = 0 } = {}) {
  mkdirSync(join(root, '-home-me', sid, 'subagents'), { recursive: true });
  const main = join(root, '-home-me', `${sid}.jsonl`);
  writeFileSync(main, line({ type: 'user', sessionId: sid, cwd: '/home/me/accident', message: { content: '시작' } }));
  const f = join(root, '-home-me', sid, 'subagents', `agent-${id}.jsonl`);
  const metaFile = join(root, '-home-me', sid, 'subagents', `agent-${id}.meta.json`);
  writeFileSync(f, lines.map(line).join(''));
  writeFileSync(metaFile, JSON.stringify(meta));
  if (mtimeAgo) { const t = new Date(Date.now() - mtimeAgo); utimesSync(f, t, t); utimesSync(metaFile, t, t); }
  return { f, metaFile };
}
const agentTool = (name, input, id = 'A1', tuid = 'tu9') => ({ type: 'assistant', isSidechain: true, agentId: id, sessionId: 'S1', cwd: '/home/me/accident', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: tuid, name, input }] } });

test('실행 중에 새로 생긴 하위 에이전트: astart → atool → (meta finished) astop 한 번', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  mkdirSync(join(root, '-home-me'));
  writeFileSync(join(root, '-home-me', 'S1.jsonl'), line({ type: 'user', sessionId: 'S1', cwd: '/home/me/accident', message: { content: '시작' } }));
  const t = tailEnv(root);
  try {
    await waitFor(() => t.out.find((o) => o.k === 'init'));
    const { metaFile } = agentSetup(root, { lines: [agentTool('Read', { file_path: '/home/me/accident/a.py' }), agentTool('Bash', { command: 'ls -la' }, 'A1', 'tu10')] });
    const start = await waitFor(() => t.out.find((o) => o.k === 'astart'));
    assert.deepEqual([start.s, start.a, start.t, start.c], ['S1', 'A1', 'Explore', '/home/me/accident']);
    await waitFor(() => t.out.filter((o) => o.k === 'atool').length >= 2);
    const tools = t.out.filter((o) => o.k === 'atool').flatMap((o) => o.tools.map((x) => [o.a, x.n, x.d]));
    assert.deepEqual(tools, [['A1', 'Read', '/home/me/accident/a.py'], ['A1', 'Bash', 'ls -la']]);
    writeFileSync(metaFile, JSON.stringify({ agentType: 'Explore', description: '조사', finished: true }));
    await waitFor(() => t.out.find((o) => o.k === 'astop'));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(t.out.filter((o) => o.k === 'astop').length, 1);
    assert.equal(t.out.filter((o) => o.k === 'tool' || o.k === 'prompt').length, 0); // 하위 에이전트 줄은 팀장의 도구 사용이 아니다
  } finally { t.stop(); }
});

test('이미 있던 하위 에이전트: 방금까지 일하던 것만 astart, 끝났거나 오래된 것은 알리지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tail-'));
  agentSetup(root, { id: 'LIVE', lines: [agentTool('Read', { file_path: '/x' }, 'LIVE')] });
  agentSetup(root, { sid: 'S2', id: 'DONE', meta: { agentType: 'x', finished: true }, lines: [agentTool('Read', { file_path: '/x' }, 'DONE')] });
  agentSetup(root, { sid: 'S3', id: 'OLD', lines: [agentTool('Read', { file_path: '/x' }, 'OLD')], mtimeAgo: 3600_000 });
  const t = tailEnv(root);
  try {
    await waitFor(() => t.out.find((o) => o.k === 'astart'));
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(t.out.filter((o) => o.k === 'astart').map((o) => o.a), ['LIVE']);
    assert.equal(t.out.filter((o) => o.k === 'atool').length, 0); // 과거 내용은 되풀이하지 않는다
  } finally { t.stop(); }
});

test('INCLUDE_TEXT=1이면 요청(300자)과 마지막 응답(2000자)을 담고, 기본은 40자·응답 없음', async () => {
  const mk = (env) => {
    const root = mkdtempSync(join(tmpdir(), 'tail-'));
    mkdirSync(join(root, '-home-me'));
    const f = join(root, '-home-me', 'S1.jsonl');
    writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me', message: { content: '시작' } }));
    return { f, t: startTail(root, env) };
  };
  const long = '가'.repeat(500);
  for (const [env, wantP, wantA] of [[{ INCLUDE_TEXT: '1' }, 300, 2000], [{}, 40, 0]]) {
    const { f, t } = mk(env);
    try {
      await waitFor(() => t.out.find((o) => o.k === 'init'));
      appendFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me', message: { content: long } }));
      appendFileSync(f, line({ type: 'assistant', sessionId: 'S1', cwd: '/home/me', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '나'.repeat(3000) }] } }));
      const stop = await waitFor(() => t.out.find((o) => o.k === 'stop'));
      const prompt = t.out.find((o) => o.k === 'prompt');
      assert.equal(prompt.p.length, wantP);
      assert.equal((stop.a ?? '').length, wantA);
    } finally { t.stop(); }
  }
});

test('INCLUDE_TEXT=1이면 편집 도구의 수정 전·후 내용(e)을 담고, 기본은 담지 않는다', async () => {
  for (const [env, want] of [[{ INCLUDE_TEXT: '1' }, true], [{}, false]]) {
    const root = mkdtempSync(join(tmpdir(), 'tail-'));
    mkdirSync(join(root, '-home-me'));
    const f = join(root, '-home-me', 'S1.jsonl');
    writeFileSync(f, line({ type: 'user', sessionId: 'S1', cwd: '/home/me', message: { content: '시작' } }));
    const t = startTail(root, env);
    try {
      await waitFor(() => t.out.find((o) => o.k === 'init'));
      appendFileSync(f, line(assistantTool('Edit', { file_path: '/home/me/a.js', old_string: 'one', new_string: 'two' }, 'tuE')));
      appendFileSync(f, line(assistantTool('Write', { file_path: '/home/me/n.md', content: 'x'.repeat(9000) }, 'tuW')));
      appendFileSync(f, line(assistantTool('Read', { file_path: '/home/me/a.js' }, 'tuR')));
      await waitFor(() => t.out.filter((o) => o.k === 'tool').length >= 3);
      const tools = t.out.filter((o) => o.k === 'tool').flatMap((o) => o.tools);
      const byName = Object.fromEntries(tools.map((x) => [x.n, x]));
      if (want) {
        assert.deepEqual([byName.Edit.e.file_path, byName.Edit.e.old_string, byName.Edit.e.new_string], ['/home/me/a.js', 'one', 'two']);
        assert.ok(byName.Write.e.content.length <= 4000);
      } else {
        assert.equal(byName.Edit.e, undefined);
      }
      assert.equal(byName.Read.e, undefined);
    } finally { t.stop(); }
  }
});
