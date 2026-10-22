// 왼쪽 목록(아바타 이름·하는 일)에 쓸 줄을 스냅샷에서 만든다. 순수 함수(Node 테스트 가능).
import { ROOM_NAMES, TEAM_COUNT as TEAM_MAX } from './layout.js';

const IDLE_TEXT = { idle: '쉬는 중', off: '꺼져 있음', wait: '응답을 기다리는 중' };
const str = (v) => (typeof v === 'string' ? v : '');
// 두 색(#rrggbb)을 t(0~1) 비율로 섞는다. 이상한 값이면 두 번째 색.
export function mixHex(a, b, t) {
  const rgb = (h) => (/^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return typeof b === 'string' ? b : '#8a94a6';
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
// 역할·작업 아바타는 역할 색에 팀 색을 섞어, 같은 역할이라도 어느 팀 소속인지 보이게 한다
export const ROLE_TEAM_MIX = 0.45;

const num = (v) => (Number.isFinite(v) ? v : null);
const recentOf = (v) => (Array.isArray(v) ? v.filter((h) => h && Number.isFinite(h.at) && typeof h.label === 'string').map((h) => ({ at: h.at, label: h.label })) : []);

export const STATUS_COLOR = { read: '#4c8dff', write: '#13a58a', run: '#8b5cf6', wait: '#2fbf71', idle: '#8a94a6', off: '#5b6479', failed: '#e5484d' };

// 상태가 시작된 뒤 지난 시간
export function elapsed(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 10) return '방금 시작';
  if (s < 60) return `${s}초째`;
  if (s < 3600) return `${Math.floor(s / 60)}분째`;
  return `${Math.floor(s / 3600)}시간째`;
}

// 지난 시간 → 짧은 한국어 표현
export function ago(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 10) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

export function rosterRows(snapshot) {
  const rows = [];
  const teams = Array.isArray(snapshot?.teams) ? snapshot.teams.slice(0, TEAM_MAX) : [];
  teams.forEach((t, i) => {
    if (!t || typeof t.name !== 'string') return;
    const wait = t.room === 'response';
    const status = wait ? 'wait' : str(t.status) || 'idle';
    rows.push({
      key: `t${i}`, kind: 'team', name: t.name, color: str(t.color) || '#8a94a6', status, wait,
      text: str(t.label) || IDLE_TEXT[status] || '', place: ROOM_NAMES[t.room] ?? '', badge: t.badge ?? null, finishedAt: t.finishedAt ?? null, since: num(t.since), recent: recentOf(t.recent),
    });
    for (const m of Array.isArray(t.members) ? t.members : []) {
      rows.push({ key: `t${i}:m:${str(m.id)}`, kind: 'member', name: str(m.type) || '팀원', color: str(t.color) || '#8a94a6', teamColor: str(t.color) || '#8a94a6', status: str(m.status) || 'idle', wait: false, text: str(m.label), place: ROOM_NAMES[m.room] ?? '', badge: null, since: num(m.since), recent: recentOf(m.recent) });
    }
    for (const r of Array.isArray(t.roles) ? t.roles : []) {
      const status = r.status === 'running' ? 'write' : r.status === 'failed' ? 'failed' : 'idle';
      rows.push({ key: `t${i}:r:${str(r.id)}`, kind: 'role', name: str(r.name) || str(r.id), color: mixHex(str(r.color) || '#8a94a6', str(t.color) || '#8a94a6', ROLE_TEAM_MIX), teamColor: str(t.color) || '#8a94a6', status, wait: false, text: str(r.label), place: ROOM_NAMES[r.room] ?? '', badge: null, since: null, recent: [] });
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
