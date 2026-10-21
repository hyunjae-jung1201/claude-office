import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveMonitor } from '../src/live.js';

function setup(opts = {}) {
  let t = 1_000_000;
  let sessions = [];
  const events = [];
  const monitor = createLiveMonitor({ list: () => sessions, emit: (e) => events.push(e), now: () => t, ...opts });
  return { monitor, events, set: (s) => { sessions = s; }, advance: (ms) => { t += ms; } };
}
const S = (status = 'idle', o = {}) => ({ sessionId: 's1', name: '팀', cwd: '/home', status, ...o });

test('새 세션과 상태 변화는 live 이벤트, 같은 상태는 반복하지 않는다', () => {
  const { monitor, events, set } = setup();
  set([S('idle')]); monitor.poll(); monitor.poll();
  set([S('shell')]); monitor.poll();
  assert.deepEqual(events.map((e) => [e.type, e.liveStatus, e.sessionName, e.cwd]), [['live', 'idle', '팀', '/home'], ['live', 'shell', '팀', '/home']]);
});

test('상태가 같아도 30초가 지나면 하트비트를 다시 보낸다', () => {
  const { monitor, events, set, advance } = setup();
  set([S()]); monitor.poll();
  advance(29_000); monitor.poll();
  assert.equal(events.length, 1);
  advance(2_000); monitor.poll();
  assert.equal(events.length, 2);
});

test('한 번 안 보인 것(파일을 다시 쓰는 중 등)으로는 gone을 보내지 않고, 연속 2번 안 보이면 gone', () => {
  const { monitor, events, set } = setup();
  set([S()]); monitor.poll();
  set([]); monitor.poll();
  assert.deepEqual(events.map((e) => e.liveStatus), ['idle']);
  set([S()]); monitor.poll(); // 돌아오면 카운트 초기화(하트비트 간격 안이라 이벤트 없음)
  set([]); monitor.poll();
  assert.deepEqual(events.map((e) => e.liveStatus), ['idle']);
  monitor.poll();
  assert.deepEqual(events.map((e) => e.liveStatus), ['idle', 'gone']);
  monitor.poll();
  assert.equal(events.length, 2); // gone은 한 번만
});

test('이름·폴더가 없는 항목도 처리하고(cwd 기본값 /), 목록 오류가 나도 예외를 던지지 않는다', () => {
  const { monitor, events, set } = setup();
  set([{ sessionId: 'x' }]); monitor.poll();
  assert.deepEqual([events[0].cwd, events[0].liveStatus], ['/', 'idle']);
  const bad = createLiveMonitor({ list: () => { throw new Error('boom'); }, emit: () => {} });
  assert.doesNotThrow(() => bad.poll());
});
