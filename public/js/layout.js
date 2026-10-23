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
const STATUS_ROOM = { read: 'library', write: 'work', run: 'work', wait: 'response', idle: 'lounge', off: 'lounge' };
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
  // 팀원 책상 두 줄(앉는 자리): 팀장 책상 뒤쪽 줄 아래로 y 2.6, 3.6
  return { x: z.x + 0.3 + 0.55 * (memberIndex % 2), y: 2.6 + 1.0 * Math.floor(memberIndex / 2) };
}

// 방마다 팀 번호(0~4)별 서 있는/앉는 자리. 가장자리에서 충분히 떨어져 있고 팀끼리 겹치지 않는다.
const row = (x0, dx, y) => (i) => ({ x: x0 + dx * i, y });
const grid = (x0, y0) => (i) => ({ x: x0 + 0.9 * (i % 3), y: y0 + 1.0 * Math.floor(i / 3) });
const SPOTS = {
  library: row(0.5, 0.5, 1.15), // 책장 앞(뒷벽)
  // 리서치실: 둥근 토론 탁자 2개, 탁자마다 세 명이 둘러앉아 마주 본다(face = 탁자 쪽)
  research: (i) => [
    { x: 3.72, y: 1.45, face: Math.PI / 2 }, { x: 5.02, y: 1.45, face: -Math.PI / 2 }, { x: 4.37, y: 2.15, face: Math.PI },
    { x: 4.95, y: 2.45, face: Math.PI / 2 }, { x: 6.25, y: 2.45, face: -Math.PI / 2 }, { x: 5.6, y: 3.1, face: Math.PI },
  ][i],
  work: (i) => {
    const z = deskZone(i);
    return { x: z.x + z.w / 2, y: 1.55 }; // 팀장 책상 바로 앞 의자
  },
  // 문서실: 긴 공동 작업 탁자 하나, 양쪽에 세 명씩 마주 앉는다(윗줄은 남쪽, 아랫줄은 북쪽을 본다)
  docs: (i) => ({ x: 14.45 + 0.75 * (i % 3), y: i < 3 ? 0.95 : 2.6, face: i < 3 ? 0 : Math.PI }),
  planning: row(17.2, 0.48, 0.6), // 칸반 보드 앞
  server: (i) => ({ x: 1.68, y: 5.9 + 0.55 * i }), // 서버 랙 앞 서비스 선반
  data: row(3.8, 0.5, 6.35), // 서류 캐비닛 앞
  lab: row(7.0, 0.5, 6.4), // 실험대 앞
  build: row(10.25, 0.46, 6.55), // 컨베이어 앞
  git: (i) => (i < 4 ? { x: 13.5 + 0.46 * i, y: 5.85 } : { x: 14.0 + 0.55 * (i - 4), y: 6.6 }), // 보드 앞(다섯째·여섯째는 금고를 피해 한 줄 뒤)
  briefing: row(16.6, 0.6, 6.8), // 연단 옆
  response: row(1.2, 1.3, 11.5), // 벤치에 앉아 사용자의 응답을 기다린다
  lounge: row(9.5, 0.95, 12.2), // 소파에 앉아 쉰다
};
const BEDS = row(15.1, 0.9, 12.0); // 휴게실 침대(꺼진 세션)
// 방마다 하는 일(자세): 작업실·리서치·문서는 타자, 자료실·데이터 창고는 책/서류를 꺼내 읽고, 기획실은 보드에 쓰고, 서버실은 서서 콘솔을 치고,
// 테스트 랩은 시약을 섞고, 빌드실은 장비를 손보고, 형상관리실은 보드를 가리키고, 브리핑룸은 발표한다.
// (타자 type 은 서서 하는 일: 서버실 선반 앞)
const POSE = {
  work: 'sitType', docs: 'sitType', research: 'sitType', response: 'sit', lounge: 'sit',
  library: 'browse', data: 'browse', planning: 'write', server: 'type', lab: 'mix', build: 'tinker', git: 'point', briefing: 'present',
};
// 일하는 대상 쪽을 바라보는 방향(yaw). 뒷벽(-y) = Math.PI, 왼쪽(-x) = -Math.PI/2. 없으면 자세의 기본 방향.
const FACE = { library: Math.PI, data: Math.PI, planning: Math.PI, server: -Math.PI / 2, lab: Math.PI, build: Math.PI, git: Math.PI, briefing: Math.PI };

export function targetFor(status, teamIndex, room = roomFor(status)) {
  if (!SPOTS[room]) throw new Error(`unknown room: ${room}`);
  checkTeam(teamIndex);
  if (room === 'lounge' && status === 'off') return { ...BEDS(teamIndex), pose: 'sleep' };
  const spot = SPOTS[room](teamIndex);
  return { ...spot, pose: POSE[room] ?? 'stand', ...(spot.face === undefined && FACE[room] !== undefined ? { face: FACE[room] } : {}) };
}

// 팀원이 들어오고 나가는 입구(바닥 오른쪽 가장자리, 위쪽 복도 끝).
export const ENTRANCE = { x: FLOOR.w, y: 4.6 };

const MEMBER_OFFSETS = [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];

// 팀원의 목표: 작업실이면 팀 책상 자리, 그 밖의 방에서는 팀장 자리 곁에 비켜 선다.
export function memberTarget(status, teamIndex, memberIndex, room = roomFor(status)) {
  if (room === 'work') return { ...memberSeat(teamIndex, memberIndex), pose: 'sitType' };
  const base = targetFor(status, teamIndex, room);
  if (!MEMBER_OFFSETS[memberIndex]) throw new RangeError(`memberIndex ${memberIndex}`);
  const [dx, dy] = MEMBER_OFFSETS[memberIndex];
  return { x: base.x + dx, y: base.y + dy, pose: base.pose, ...(base.face !== undefined ? { face: base.face } : {}) };
}

// ---- 칸막이 벽과 출입구: 가운데 줄·아랫줄 방의 윗변에 낮은 벽이 서 있고, 방마다 문(틈)이 하나 있다.
// 아바타는 벽을 뚫지 않고 문 앞을 거쳐 이동한다(route).
export const DOOR_W = 1.2;
export const DOOR_LINES = [
  { y: 5.2, doors: [0.95, 4.3, 7.5, 10.7, 13.9, 17.3] }, // 서버실·데이터 창고·테스트 랩·빌드실·형상관리실·브리핑룸
  { y: 9.4, doors: [2.0, 16.2] }, // 응답 대기실·휴게실
];

// from → to 로 가는 길에 칸막이 벽을 비껴가야 하면 문 앞뒤의 경유점을 돌려준다(없으면 빈 배열). 목적지 자체는 포함하지 않는다.
export function route(from, to) {
  const pts = [];
  let cur = { x: from.x, y: from.y };
  const south = to.y > from.y;
  const lines = [...DOOR_LINES].sort((a, b) => (south ? a.y - b.y : b.y - a.y));
  for (const { y, doors } of lines) {
    if ((cur.y < y) === (to.y < y)) continue; // 이 벽을 건너지 않는다
    const cx = cur.x + ((to.x - cur.x) * (y - cur.y)) / (to.y - cur.y);
    if (doors.some((d) => Math.abs(cx - d) <= DOOR_W / 2 - 0.1)) continue; // 곧장 가도 문 틈으로 지난다
    const detour = (x) => Math.abs(cur.x - x) + Math.abs(x - to.x);
    const door = doors.reduce((best, x) => (detour(x) < detour(best) ? x : best), doors[0]);
    const s = south ? 1 : -1;
    pts.push({ x: door, y: y - s * 0.45 }, { x: door, y: y + s * 0.45 });
    cur = { x: door, y: y + s * 0.45 };
  }
  return pts;
}

// 검토자 회의 자리: 검토를 끝낸 역할자가 기획실 낮은 탁자(17.3~19.2 × 1.0~1.7) 둘레에 선다. 팀마다 살짝 어긋나게.
const MEETING = [[17.15, 1.5], [19.4, 1.5], [17.85, 2.2], [18.8, 2.2]];
export function meetingSpot(teamIndex, slot) {
  checkTeam(teamIndex);
  const [x, y] = MEETING[((slot % 4) + 4) % 4];
  return { x: x + 0.06 * (teamIndex % 3), y: y + 0.05 * Math.floor(teamIndex / 3) };
}
