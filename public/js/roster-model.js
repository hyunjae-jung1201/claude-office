// 왼쪽 목록(아바타 이름·하는 일)에 쓸 줄을 스냅샷에서 만든다. 순수 함수(Node 테스트 가능).
import { ROOM_NAMES, TEAM_COUNT as TEAM_MAX } from './layout.js';

const IDLE_TEXT = { idle: '쉬는 중', off: '꺼져 있음', wait: '응답을 기다리는 중' };
const str = (v) => (typeof v === 'string' ? v : '');

export function rosterRows(snapshot) {
  const rows = [];
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams.slice(0, TEAM_MAX) : [];
  teams.forEach((t, i) => {
    if (!t || typeof t.name !== 'string') return;
    const wait = t.room === 'response';
    const status = wait ? 'wait' : str(t.status) || 'idle';
    rows.push({
      key: `t${i}`, kind: 'team', name: t.name, color: str(t.color) || '#8a94a6', status, wait,
      text: str(t.label) || IDLE_TEXT[status] || '', place: ROOM_NAMES[t.room] ?? '', badge: t.badge ?? null, finishedAt: t.finishedAt ?? null,
    });
    for (const m of Array.isArray(t.members) ? t.members : []) {
      rows.push({ key: `t${i}:m:${str(m.id)}`, kind: 'member', name: str(m.type) || '팀원', color: str(t.color) || '#8a94a6', status: str(m.status) || 'idle', wait: false, text: str(m.label), place: ROOM_NAMES[m.room] ?? '', badge: null });
    }
    for (const r of Array.isArray(t.roles) ? t.roles : []) {
      const status = r.status === 'running' ? 'write' : r.status === 'failed' ? 'failed' : 'idle';
      rows.push({ key: `t${i}:r:${str(r.id)}`, kind: 'role', name: str(r.name) || str(r.id), color: str(r.color) || '#8a94a6', status, wait: false, text: str(r.label), place: ROOM_NAMES[r.room] ?? '', badge: null });
    }
  });
  return rows;
}

// 'tN' | 'tN:m:<id>' | 'tN:r:<id>' → { team, kind, id? } (잘못된 값은 null)
export function parseRosterKey(key) {
  const m = typeof key === 'string' ? /^t(\d+)(?::([mr]):(.+))?$/.exec(key) : null;
  if (!m) return null;
  const team = Number(m[1]);
  return m[2] ? { team, kind: m[2] === 'm' ? 'member' : 'role', id: m[3] } : { team, kind: 'team' };
}
