// 사무실 방 배치와 아바타 이동 목표. 순수 함수만 둔다(Node 테스트 가능). 좌표는 타일 단위(x: 오른쪽, y: 안쪽).
export const FLOOR = { w: 12, d: 10 };

export const ROOMS = {
  library: { x: 0, y: 0, w: 4, d: 3 },
  work: { x: 4, y: 0, w: 8, d: 4.4 },
  server: { x: 0, y: 3, w: 2.8, d: 7 },
  hall: { x: 3, y: 4.4, w: 9, d: 1.2 },
  meeting: { x: 7, y: 6, w: 5, d: 4 },
  lounge: { x: 3, y: 7, w: 4, d: 3 },
};

const TEAM_COUNT = 5;
const MEMBER_MAX = 4;
const DESK_W = 1.6;

function checkTeam(i) {
  if (!Number.isInteger(i) || i < 0 || i >= TEAM_COUNT) throw new RangeError(`teamIndex ${i}`);
}

export function deskZone(teamIndex) {
  checkTeam(teamIndex);
  return { x: ROOMS.work.x + DESK_W * teamIndex, y: 0.4, w: DESK_W, d: 3.8 };
}

export function memberSeat(teamIndex, memberIndex) {
  checkTeam(teamIndex);
  if (!Number.isInteger(memberIndex) || memberIndex < 0 || memberIndex >= MEMBER_MAX) throw new RangeError(`memberIndex ${memberIndex}`);
  const z = deskZone(teamIndex);
  return { x: z.x + 0.4 + 0.8 * (memberIndex % 2), y: 3.1 + 0.6 * Math.floor(memberIndex / 2) };
}

const SPOTS = {
  read: (i) => ({ x: 0.6 + 0.75 * i, y: 2.2, pose: 'stand' }),
  write: (i) => {
    const z = deskZone(i);
    return { x: z.x + z.w / 2, y: 2.0, pose: 'type' };
  },
  run: (i) => ({ x: 1.8, y: 4.2 + 1.2 * i, pose: 'stand' }),
  wait: (i) => ({ x: 7.6 + 0.9 * i, y: 6.4, pose: 'stand' }),
  idle: (i) => ({ x: 3.8 + 1.6 * i, y: 5.0, pose: 'stand' }),
  off: (i) => ({ x: 3.5 + 0.7 * i, y: 9.4, pose: 'sleep' }),
};

export function targetFor(status, teamIndex) {
  const spot = SPOTS[status];
  if (!spot) throw new Error(`unknown status: ${status}`);
  checkTeam(teamIndex);
  return spot(teamIndex);
}

// 팀원이 들어오고 나가는 입구(바닥 오른쪽 가장자리 복도).
export const ENTRANCE = { x: FLOOR.w, y: ROOMS.hall.y + ROOMS.hall.d / 2 };

const MEMBER_OFFSETS = [[0.35, 0.3], [-0.35, 0.3], [0.35, -0.3], [-0.35, -0.3]];

// 팀원의 목표: 일하는 중(write)이면 팀 책상 자리, 그 밖에는 팀장 자리 곁에 비켜 선다.
export function memberTarget(status, teamIndex, memberIndex) {
  if (status === 'write') return { ...memberSeat(teamIndex, memberIndex), pose: 'type' };
  const base = targetFor(status, teamIndex);
  if (!MEMBER_OFFSETS[memberIndex]) throw new RangeError(`memberIndex ${memberIndex}`);
  const [dx, dy] = MEMBER_OFFSETS[memberIndex];
  return { x: base.x + dx, y: base.y + dy, pose: base.pose };
}
