// 방마다 지금 일이 벌어지고 있는지(소품이 반응하는 근거)를 스냅샷에서 계산한다. 순수 함수(Node 테스트 가능).
import { ROOMS } from './layout.js';

const WORKING = new Set(['read', 'write', 'run', 'wait']);
const TEST_ORDER = ['failed', 'running', 'done']; // 한 방에 여럿이면 앞쪽이 이긴다

export function roomActivity(snapshot) {
  const out = {};
  for (const id of Object.keys(ROOMS)) out[id] = { level: 0, waiting: 0, tests: null };
  const touch = (room, status) => { if (out[room] && WORKING.has(status)) out[room].level = 1; };
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
  for (const t of teams) {
    if (!t || typeof t !== 'object') continue;
    if (t.status !== 'off' && t.room === 'response') out.response.waiting += 1;
    if (t.status !== 'off') touch(t.room, t.status);
    for (const m of Array.isArray(t.members) ? t.members : []) if (m) touch(m.room, m.status);
    for (const r of Array.isArray(t.roles) ? t.roles : []) {
      if (!r || !r.room || !out[r.room]) continue;
      if (r.status === 'running') out[r.room].level = 1;
      if (r.id === 'tests' && TEST_ORDER.includes(r.status)) {
        const cur = out[r.room].tests;
        if (!cur || TEST_ORDER.indexOf(r.status) < TEST_ORDER.indexOf(cur)) out[r.room].tests = r.status;
      }
    }
  }
  return out;
}
