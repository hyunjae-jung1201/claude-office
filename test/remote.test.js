import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectionToEvents, buildSshArgs } from '../src/remote.js';

const NOW = 5_000_000;
const base = { s: 'sess-1', c: '/home/me/accident', t: '2026-10-21T06:00:00Z' };
const fresh = () => ({ tools: new Map(), seen: new Set() });

test('첫 이벤트에는 세션 시작이 앞에 붙는다', () => {
  const evs = projectionToEvents({ ...base, k: 'prompt', p: '로그인 고쳐줘' }, fresh(), NOW);
  assert.deepEqual(evs.map((e) => e.type), ['start', 'prompt']);
  assert.ok(evs.every((e) => e.sessionId === 'sess-1' && e.cwd === '/home/me/accident' && e.ts === NOW));
});

test('같은 세션의 두 번째 이벤트에는 start가 없다', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'prompt', p: 'a' }, ctx, NOW);
  assert.deepEqual(projectionToEvents({ ...base, k: 'prompt', p: 'b' }, ctx, NOW).map((e) => e.type), ['prompt']);
});

test('하위 에이전트 완료 알림과 시스템 문구는 사용자 프롬프트가 아니다', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'stop' }, ctx, NOW);
  assert.deepEqual(projectionToEvents({ ...base, k: 'prompt', p: '<task-notification>\n<task-id>' }, ctx, NOW), []);
});

test('도구 사용은 category와 마스킹된 detail을 가진 tool 이벤트, 결과는 toolDone', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'stop' }, ctx, NOW);
  const evs = projectionToEvents({ ...base, k: 'tool', tools: [
    { i: 't1', n: 'Bash', d: 'curl -H "Authorization: Bearer abc123def456ghi789jkl" x' },
    { i: 't2', n: 'Read', d: '/home/me/accident/a.py' },
  ] }, ctx, NOW);
  assert.deepEqual(evs.map((e) => [e.type, e.category]), [['tool', 'run'], ['tool', 'read']]);
  assert.ok(!evs[0].detail.includes('abc123def456ghi789jkl'));
  const done = projectionToEvents({ ...base, k: 'result', ids: ['t2', 't1', 'unknown'] }, ctx, NOW);
  assert.deepEqual(done.map((e) => [e.type, e.category]), [['toolDone', 'read'], ['toolDone', 'run'], ['toolDone', 'write']]);
});

test('AskUserQuestion/ExitPlanMode는 wait', () => {
  const ctx = fresh();
  projectionToEvents({ ...base, k: 'stop' }, ctx, NOW);
  const evs = projectionToEvents({ ...base, k: 'tool', tools: [{ i: 'q', n: 'AskUserQuestion', d: '' }, { i: 'p', n: 'ExitPlanMode', d: '' }] }, ctx, NOW);
  assert.deepEqual(evs.map((e) => [e.type, e.waitKind]), [['wait', 'answer'], ['wait', 'plan']]);
});

test('init: 최근에 일하던 세션은 시작 후 바로 작업 상태, 오래됐으면 대기', () => {
  const working = projectionToEvents({ ...base, k: 'init', last: 'tool', age: 5, tools: [{ i: 't', n: 'Edit', d: '/x/a.py' }] }, fresh(), NOW);
  assert.deepEqual(working.map((e) => [e.type, e.category]), [['start', undefined], ['tool', 'write']]);
  const idle = projectionToEvents({ ...base, k: 'init', last: 'stop', age: 5 }, fresh(), NOW);
  assert.deepEqual(idle.map((e) => e.type), ['start']);
  const stale = projectionToEvents({ ...base, k: 'init', last: 'tool', age: 400, tools: [{ i: 't', n: 'Edit', d: 'x' }] }, fresh(), NOW);
  assert.deepEqual(stale.map((e) => e.type), ['start']);
});

test('필드가 없거나 이상한 입력은 빈 배열', () => {
  for (const bad of [null, undefined, 'x', 42, {}, { k: 'tool' }, { s: 's', c: '/x', k: 'mystery' }]) {
    assert.deepEqual(projectionToEvents(bad, fresh(), NOW), []);
  }
});

test('ssh 인자: 키 전용(BatchMode), 포트 포워딩 없음, 원격에서 node - 실행', () => {
  const args = buildSshArgs({ name: 'PC2', ssh: 'me@192.168.0.20', key: '/home/x/.ssh/k' });
  assert.deepEqual(args.slice(0, 2), ['-i', '/home/x/.ssh/k']);
  assert.ok(args.includes('BatchMode=yes') && args.includes('IdentitiesOnly=yes'));
  assert.deepEqual(args.slice(-3), ['me@192.168.0.20', 'node', '-']);
  assert.ok(!args.some((a) => /password/i.test(a)));
});

test('원격 세션 이름(n)이 이벤트의 sessionName으로 전달된다', () => {
  const evs = projectionToEvents({ ...base, n: '사고 판별 모델', k: 'prompt', p: 'x' }, fresh(), NOW);
  assert.ok(evs.length === 2 && evs.every((e) => e.sessionName === '사고 판별 모델'));
});

test('live: 세션 등록 정보 상태가 live 이벤트로 바뀐다 (start 없이)', () => {
  const evs = projectionToEvents({ s: 'S1', c: '/home/me', n: '사고 판별 모델', k: 'live', st: 'shell' }, fresh(), NOW);
  assert.deepEqual(evs.map((e) => [e.type, e.liveStatus, e.sessionName, e.sessionId]), [['live', 'shell', '사고 판별 모델', 'S1']]);
  assert.deepEqual(projectionToEvents({ s: 'S1', c: '/home/me', k: 'live' }, fresh(), NOW), []);
});

// ---- 하위 에이전트·텍스트 필드 → 이벤트
test('astart/atool/astop → agentStart/tool(agentId)/agentStop', () => {
  const ctx = fresh();
  const s = projectionToEvents({ s: 'S1', c: '/home/me', k: 'astart', a: 'A1', t: 'Explore' }, ctx, NOW);
  assert.deepEqual(s.map((e) => [e.type, e.agentId, e.agentType]), [['start', undefined, undefined], ['agentStart', 'A1', 'Explore']]);
  const t = projectionToEvents({ s: 'S1', c: '/home/me', k: 'atool', a: 'A1', t: 'Explore', tools: [{ i: 'x', n: 'Edit', d: '/home/me/a.js' }, { i: 'y', n: 'Bash', d: 'ls' }] }, ctx, NOW);
  assert.deepEqual(t.map((e) => [e.type, e.category, e.agentId, e.agentType, e.toolName, e.filePath]), [['tool', 'write', 'A1', 'Explore', 'Edit', '/home/me/a.js'], ['tool', 'run', 'A1', 'Explore', 'Bash', undefined]]);
  assert.deepEqual(projectionToEvents({ s: 'S1', c: '/home/me', k: 'astop', a: 'A1' }, ctx, NOW).map((e) => [e.type, e.agentId]), [['agentStop', 'A1']]);
  assert.deepEqual(projectionToEvents({ s: 'S1', c: '/home/me', k: 'astart' }, fresh(), NOW).filter((e) => e.type === 'agentStart'), []); // agentId 없으면 무시
});

test('편집 도구는 toolName·filePath, 요청·응답 텍스트는 마스킹된 promptText·assistantText로 전달된다', () => {
  const ctx = fresh();
  const evs = projectionToEvents({ s: 'S1', c: '/home/me', k: 'tool', tools: [{ i: 't', n: 'Write', d: '/home/me/new.md' }, { i: 'u', n: 'Read', d: '/home/me/r.md' }] }, ctx, NOW);
  assert.deepEqual(evs.filter((e) => e.type === 'tool').map((e) => [e.toolName, e.filePath]), [['Write', '/home/me/new.md'], ['Read', undefined]]);
  const p = projectionToEvents({ s: 'S1', c: '/home/me', k: 'prompt', p: '로그인 고쳐줘 token=abcd1234efgh' }, ctx, NOW).find((e) => e.type === 'prompt');
  assert.ok(p.promptText.startsWith('로그인 고쳐줘') && !p.promptText.includes('abcd1234efgh'));
  const st = projectionToEvents({ s: 'S1', c: '/home/me', k: 'stop', a: '끝. sk-abcdefghijklmnopqrstuvwx1234' }, ctx, NOW).find((e) => e.type === 'stop');
  assert.ok(st.assistantText.startsWith('끝.') && !st.assistantText.includes('sk-abcdefghijklmnopqrstuvwx1234'));
  assert.equal(projectionToEvents({ s: 'S1', c: '/home/me', k: 'prompt', p: '<task-notification>x' }, ctx, NOW).length, 0);
});

test('편집 도구의 상대 경로나 비정상 값은 filePath로 쓰지 않는다', () => {
  const ev = projectionToEvents({ s: 'S1', c: '/c', k: 'tool', tools: [{ i: 'a', n: 'Edit', d: 'relative/path.js' }, { i: 'b', n: 'Edit', d: '' }] }, fresh(), NOW).filter((e) => e.type === 'tool');
  assert.deepEqual(ev.map((e) => e.filePath), [undefined, undefined]);
});

test('세션 기록 경로의 도구에도 activity가 붙는다', () => {
  const ev = projectionToEvents({ s: 'S', c: '/c', k: 'tool', tools: [{ i: 'a', n: 'Bash', d: 'pytest -q' }, { i: 'b', n: 'WebSearch', d: 'x' }, { i: 'c', n: 'AskUserQuestion', d: '' }] }, fresh(), NOW).filter((e) => e.type !== 'start');
  assert.deepEqual(ev.map((e) => e.activity), ['lab', 'research', 'response']);
});

test('세션 기록의 편집 도구 e → 이벤트의 edit (마스킹·검증)', () => {
  const ev = projectionToEvents({ s: 'S', c: '/c', k: 'tool', tools: [
    { i: 'a', n: 'Edit', d: '/p/a.js', e: { file_path: '/p/a.js', old_string: 'x', new_string: 'y token=abcd1234efgh' } },
    { i: 'b', n: 'Write', d: '/p/b.md', e: { file_path: '/p/b.md', content: '내용' } },
    { i: 'c', n: 'Edit', d: 'rel.js', e: { file_path: 'rel.js', old_string: 'x', new_string: 'y' } },
  ] }, fresh(), NOW).filter((x) => x.type === 'tool');
  assert.deepEqual([ev[0].edit.kind, ev[0].edit.old], ['edit', 'x']);
  assert.ok(!ev[0].edit.new.includes('abcd1234efgh'));
  assert.deepEqual([ev[1].edit.kind, ev[1].edit.new], ['write', '내용']);
  assert.equal(ev[2].edit, undefined);
});

test('buildSshArgs: review 를 켠 원격만 텍스트 수집(INCLUDE_TEXT)을 요청한다', () => {
  const tail = (a) => a.slice(a.indexOf('me@192.168.0.20'));
  assert.deepEqual(tail(buildSshArgs({ name: 'PC2', ssh: 'me@192.168.0.20', key: '/k' })), ['me@192.168.0.20', 'node', '-']);
  assert.deepEqual(tail(buildSshArgs({ name: 'PC2', ssh: 'me@192.168.0.20', key: '/k', review: true })), ['me@192.168.0.20', 'env', 'INCLUDE_TEXT=1', 'node', '-']);
});

test('tools 배열에 null 같은 잘못된 항목이 있어도 던지지 않는다', () => {
  const ctx = { tools: new Map(), seen: new Set() };
  assert.doesNotThrow(() => projectionToEvents({ k: 'tool', s: 'a', c: '/x', tools: [null, 5, { n: 'Read', i: 'i1' }] }, ctx, 1));
  assert.doesNotThrow(() => projectionToEvents({ k: 'atool', s: 'a', c: '/x', a: 'ag', tools: [null] }, ctx, 1));
  assert.doesNotThrow(() => projectionToEvents({ k: 'tool', s: 'a', c: '/x', tools: 'x' }, ctx, 1));
});
