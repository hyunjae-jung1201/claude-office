import WebSocket from 'ws';

// 받은 스냅샷을 모아 두고, 조건을 만족하는 스냅샷을 기다린다.
export async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const seen = [];
  const waiters = [];
  ws.on('message', (data) => {
    const snap = JSON.parse(String(data));
    seen.push(snap);
    for (const w of [...waiters]) if (w.pred(snap)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(snap); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return {
    ws,
    seen,
    waitFor(pred, ms = 2000) {
      const hit = seen.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting for snapshot')); }, ms).unref();
      });
    },
    close: () => ws.close(),
  };
}
