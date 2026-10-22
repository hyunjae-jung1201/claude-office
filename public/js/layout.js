// 사무실 방 배치와 아바타 이동 목표. 순수 함수만 둔다(Node 테스트 가능). 좌표는 타일 단위(x: 오른쪽, y: 안쪽).
export const FLOOR = { w: 20, d: 14 };

export const ROOMS = {
  // 윗줄(뒷벽): 읽기·쓰기·조사
  library: { x: 0, y: 0, w: 3.4, d: 4 },
  work: { x: 3.4, y: 0, w: 7, d: 4 },
  docs: { x: 10.4, y: 0, w: 3.2, d: 4 },
  planning: { x: 13.6, y: 0, w: 3.2, d: 4 },
  research: { x: 16.8, y: 0, w: 3.2, d: 4 },
  // 복도: 지시를 기다리는 자리(벤치)
  hall: { x: 3.4, y: 4, w: 13, d: 1.4 },
  // 가운데 줄: 실행
  server: { x: 0, y: 5.4, w: 3.4, d: 4 },
  lab: { x: 3.4, y: 5.4, w: 3.2, d: 4 },
  build: { x: 6.6, y: 5.4, w: 3.2, d: 4 },
  git: { x: 9.8, y: 5.4, w: 3.2, d: 4 },
  data: { x: 13, y: 5.4, w: 3.2, d: 4 },
  meeting: { x: 16.2, y: 5.4, w: 3.8, d: 4 },
  // 아랫줄: 소통과 휴식
  briefing: { x: 0, y: 9.8, w: 3.4, d: 4.2 },
  consult: { x: 3.4, y: 9.8, w: 3.2, d: 4.2 },
  lounge: { x: 6.6, y: 9.8, w: 6.8, d: 4.2 },
  sleep: { x: 13.4, y: 9.8, w: 6.6, d: 4.2 },
};

export const ROOM_NAMES = {
  library: '자료실', work: '작업실', docs: '문서실', planning: '기획실', research: '리서치실', hall: '지시 대기 구역',
  server: '서버실', lab: '테스트 랩', build: '빌드실', git: '형상관리실', data: '데이터 창고', meeting: '회의실',
  briefing: '브리핑룸', consult: '상담실', lounge: '휴게실', sleep: '수면실',
};

const TEAM_COUNT = 5;
const MEMBER_MAX = 4;
const DESK_W = 1.4;

// 상태만 알 때의 기본 방
const STATUS_ROOM = { read: 'library', write: 'work', run: 'server', wait: 'meeting', idle: 'hall', off: 'sleep' };
export function roomFor(status) {
  const r = STATUS_ROOM[status];
  if (!r) throw new Error(`unknown status: ${status}`);
  return r;
}

function checkTeam(i) {
  if (!Number.isInteger(i) || i < 0 || i >= TEAM_COUNT) throw new RangeError(`teamIndex ${i}`);
}

export function deskZone(teamIndex) {
  checkTeam(teamIndex);
  return { x: ROOMS.work.x + DESK_W * teamIndex, y: 0.4, w: DESK_W, d: 3.6 };
}

export function memberSeat(teamIndex, memberIndex) {
  checkTeam(teamIndex);
  if (!Number.isInteger(memberIndex) || memberIndex < 0 || memberIndex >= MEMBER_MAX) throw new RangeError(`memberIndex ${memberIndex}`);
  const z = deskZone(teamIndex);
  return { x: z.x + 0.35 + 0.7 * (memberIndex % 2), y: 3.1 + 0.55 * Math.floor(memberIndex / 2) };
}

// 방마다 팀 번호(0~4)별 서 있는/앉는 자리. 가장자리에서 충분히 떨어져 있고 팀끼리 겹치지 않는다.
const row = (x0, dx, y) => (i) => ({ x: x0 + dx * i, y });
const grid = (x0, y0) => (i) => ({ x: x0 + 0.9 * (i % 3), y: y0 + 1.0 * Math.floor(i / 3) });
const SPOTS = {
  library: row(0.5, 0.6, 2.5),
  work: (i) => {
    const z = deskZone(i);
    return { x: z.x + z.w / 2, y: 2.0 };
  },
  docs: row(10.8, 0.6, 2.4),
  planning: row(14.0, 0.6, 2.4),
  research: row(17.2, 0.6, 2.2),
  hall: row(4.2, 1.5, 4.7),
  server: (i) => ({ x: 1.9, y: 6.2 + 0.7 * i }),
  lab: grid(3.9, 6.9),
  build: grid(7.1, 6.9),
  git: grid(10.3, 6.9),
  data: grid(13.5, 6.9),
  meeting: row(16.8, 0.7, 6.4),
  briefing: row(0.5, 0.6, 11.8),
  consult: row(3.9, 0.6, 11.8),
  lounge: row(7.3, 1.2, 13.0),
  sleep: row(14.1, 1.2, 12.9),
};
const POSE = { work: 'type', docs: 'type', research: 'type', hall: 'sit', lounge: 'sit', sleep: 'sleep' };

export function targetFor(status, teamIndex, room = roomFor(status)) {
  if (!SPOTS[room]) throw new Error(`unknown room: ${room}`);
  checkTeam(teamIndex);
  return { ...SPOTS[room](teamIndex), pose: POSE[room] ?? 'stand' };
}

// 팀원이 들어오고 나가는 입구(바닥 오른쪽 가장자리 복도).
export const ENTRANCE = { x: FLOOR.w, y: ROOMS.hall.y + ROOMS.hall.d / 2 };

const MEMBER_OFFSETS = [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];

// 팀원의 목표: 작업실이면 팀 책상 자리, 그 밖의 방에서는 팀장 자리 곁에 비켜 선다.
export function memberTarget(status, teamIndex, memberIndex, room = roomFor(status)) {
  if (room === 'work') return { ...memberSeat(teamIndex, memberIndex), pose: 'type' };
  const base = targetFor(status, teamIndex, room);
  if (!MEMBER_OFFSETS[memberIndex]) throw new RangeError(`memberIndex ${memberIndex}`);
  const [dx, dy] = MEMBER_OFFSETS[memberIndex];
  return { x: base.x + dx, y: base.y + dy, pose: base.pose };
}
