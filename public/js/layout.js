// 사무실 방 배치와 아바타 이동 목표. 순수 함수만 둔다(Node 테스트 가능). 좌표는 타일 단위(x: 오른쪽, y: 안쪽).
//
// 배치 원칙: 관련 있는 방은 붙인다.
//   윗줄   읽기 ─ 만들기:   자료실 · 리서치실 │ 작업실 │ 문서실 · 기획실
//   복도   (입구는 오른쪽 끝)
//   가운데 인프라 ─ 검증:   서버실 · 데이터 창고 │ 테스트 랩 → 빌드실 → 형상관리실 │ 브리핑룸
//   아랫줄 기다림과 쉼:     응답 대기실 · 휴게실(소파 + 침대)
export const FLOOR = { w: 20, d: 13 };

export const ROOMS = {
  // 윗줄(뒷벽)
  library: { x: 0, y: 0, w: 3.4, d: 4 },
  research: { x: 3.4, y: 0, w: 3.2, d: 4 },
  work: { x: 6.6, y: 0, w: 7, d: 4 },
  docs: { x: 13.6, y: 0, w: 3.2, d: 4 },
  planning: { x: 16.8, y: 0, w: 3.2, d: 4 },
  // 가운데 줄 (위쪽 복도 y 4 ~ 5.2 로 모두 이어진다)
  server: { x: 0, y: 5.2, w: 3.4, d: 3.8 },
  data: { x: 3.4, y: 5.2, w: 3.2, d: 3.8 },
  lab: { x: 6.6, y: 5.2, w: 3.2, d: 3.8 },
  build: { x: 9.8, y: 5.2, w: 3.2, d: 3.8 },
  git: { x: 13, y: 5.2, w: 3.2, d: 3.8 },
  briefing: { x: 16.2, y: 5.2, w: 3.8, d: 3.8 },
  // 아랫줄
  response: { x: 0, y: 9.4, w: 8, d: 3.6 },
  lounge: { x: 8, y: 9.4, w: 12, d: 3.6 },
};

export const ROOM_NAMES = {
  library: '자료실', research: '리서치실', work: '작업실', docs: '문서실', planning: '기획실',
  server: '서버실', data: '데이터 창고', lab: '테스트 랩', build: '빌드실', git: '형상관리실', briefing: '브리핑룸',
  response: '응답 대기실', lounge: '휴게실',
};

export const TEAM_COUNT = 6;
const MEMBER_MAX = 4;
const DESK_W = ROOMS.work.w / TEAM_COUNT; // 작업실을 팀 수로 나눈 책상 폭

// 상태만 알 때의 기본 방. 꺼짐은 휴게실에서 자고(침대), 쉬는 중은 휴게실에서 쉰다(소파).
const STATUS_ROOM = { read: 'library', write: 'work', run: 'server', wait: 'response', idle: 'lounge', off: 'lounge' };
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
  return { x: z.x + 0.3 + 0.55 * (memberIndex % 2), y: 3.1 + 0.55 * Math.floor(memberIndex / 2) };
}

// 방마다 팀 번호(0~4)별 서 있는/앉는 자리. 가장자리에서 충분히 떨어져 있고 팀끼리 겹치지 않는다.
const row = (x0, dx, y) => (i) => ({ x: x0 + dx * i, y });
const grid = (x0, y0) => (i) => ({ x: x0 + 0.9 * (i % 3), y: y0 + 1.0 * Math.floor(i / 3) });
const SPOTS = {
  library: row(0.5, 0.5, 2.5),
  research: row(3.75, 0.46, 2.2),
  work: (i) => {
    const z = deskZone(i);
    return { x: z.x + z.w / 2, y: 2.0 };
  },
  docs: row(14.0, 0.5, 2.4),
  planning: row(17.2, 0.5, 2.4),
  server: (i) => ({ x: 1.9, y: 5.9 + 0.55 * i }),
  data: grid(3.9, 6.6),
  lab: grid(7.1, 6.6),
  build: grid(10.3, 6.6),
  git: grid(13.5, 6.6),
  briefing: row(16.5, 0.55, 7.4),
  response: row(1.2, 1.3, 11.5), // 벤치에 앉아 사용자의 응답을 기다린다
  lounge: row(9.5, 0.95, 12.2), // 소파에 앉아 쉰다
};
const BEDS = row(15.1, 0.9, 12.0); // 휴게실 침대(꺼진 세션)
const POSE = { work: 'type', docs: 'type', research: 'type', response: 'sit', lounge: 'sit' };

export function targetFor(status, teamIndex, room = roomFor(status)) {
  if (!SPOTS[room]) throw new Error(`unknown room: ${room}`);
  checkTeam(teamIndex);
  if (room === 'lounge' && status === 'off') return { ...BEDS(teamIndex), pose: 'sleep' };
  return { ...SPOTS[room](teamIndex), pose: POSE[room] ?? 'stand' };
}

// 팀원이 들어오고 나가는 입구(바닥 오른쪽 가장자리, 위쪽 복도 끝).
export const ENTRANCE = { x: FLOOR.w, y: 4.6 };

const MEMBER_OFFSETS = [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];

// 팀원의 목표: 작업실이면 팀 책상 자리, 그 밖의 방에서는 팀장 자리 곁에 비켜 선다.
export function memberTarget(status, teamIndex, memberIndex, room = roomFor(status)) {
  if (room === 'work') return { ...memberSeat(teamIndex, memberIndex), pose: 'type' };
  const base = targetFor(status, teamIndex, room);
  if (!MEMBER_OFFSETS[memberIndex]) throw new RangeError(`memberIndex ${memberIndex}`);
  const [dx, dy] = MEMBER_OFFSETS[memberIndex];
  return { x: base.x + dx, y: base.y + dy, pose: base.pose };
}
