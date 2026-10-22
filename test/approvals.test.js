import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApprovals } from '../src/approvals.js';

const mk = (over = {}) => {
  let t = 1000;
  const changes = [];
  const a = createApprovals({ now: () => t, waitMs: 5000, onChange: () => changes.push(t), ...over });
  return { a, changes, advance: (ms) => { t += ms; } };
};
const REQ = { sessionId: 's1', team: 'A', tool: 'Bash', detail: 'npm test' };

test('요청은 목록에 올라가고, decide 하면 그 결정으로 약속이 풀리며 목록에서 사라진다', async () => {
  const { a, changes } = mk();
  const { id, promise } = a.request(REQ);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.deepEqual(a.list().map((x) => [x.id, x.team, x.tool, x.detail, x.at, x.expiresAt]), [[id, 'A', 'Bash', 'npm test', 1000, 6000]]);
  assert.equal(a.decide(id, 'allow'), true);
  assert.deepEqual(await promise, { behavior: 'allow' });
  assert.equal(a.list().length, 0);
  assert.equal(a.decide(id, 'deny'), false); // 이미 처리됨
  assert.ok(changes.length >= 2);
});

test('거절은 메시지를 담고, 모르는 결정값·모르는 id 는 무시한다', async () => {
  const { a } = mk();
  const { id, promise } = a.request(REQ);
  assert.equal(a.decide(id, 'maybe'), false);
  assert.equal(a.decide('0'.repeat(32), 'allow'), false);
  assert.equal(a.decide(id, 'deny'), true);
  const r = await promise;
  assert.equal(r.behavior, 'deny');
  assert.match(r.message, /사무실/);
});

test('시간이 지나면(waitMs) 결정 없이(null) 끝난다', async () => {
  const { a } = mk({ waitMs: 20 });
  const { promise } = a.request(REQ);
  assert.equal(await promise, null);
  assert.equal(a.list().length, 0);
});

test('cancelSession: 같은 세션의 대기를 모두 결정 없이 끝낸다(터미널에서 먼저 답한 경우)', async () => {
  const { a } = mk();
  const x = a.request(REQ);
  const y = a.request({ ...REQ, sessionId: 's2' });
  a.cancelSession('s1');
  assert.equal(await x.promise, null);
  assert.deepEqual(a.list().map((v) => v.id), [y.id]);
  a.close();
  assert.equal(await y.promise, null);
});

test('detail 은 마스킹·길이 제한을 거치고, 대기는 20개까지만', () => {
  const { a } = mk();
  const { id } = a.request({ ...REQ, detail: `curl -H "token=abcd1234efghijkl" ${'x'.repeat(5000)}` });
  const d = a.list().find((v) => v.id === id).detail;
  assert.ok(!d.includes('abcd1234efghijkl'));
  assert.ok(d.length <= 1500);
  for (let i = 0; i < 30; i++) a.request({ ...REQ, sessionId: `n${i}` });
  assert.ok(a.list().length <= 20);
});
