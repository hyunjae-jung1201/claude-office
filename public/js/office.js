// 사무실 건물: 바닥, 벽, 방 13개의 가구와 이름표. 좌표는 layout.js 의 타일 좌표(왼쪽 위 모서리 + 크기)를 쓴다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FLOOR, ROOMS, ROOM_NAMES, TEAM_COUNT, deskZone } from './layout.js';

export const wx = (x) => x - FLOOR.w / 2;
export const wz = (y) => y - FLOOR.d / 2;

const FLOOR_TINT = {
  library: '#2b3a60', research: '#25414f', work: '#244640', docs: '#40384f', planning: '#4a4030',
  server: '#34294f', data: '#2a3a55', lab: '#23454a', build: '#4a3a2a', git: '#3a3f2a', briefing: '#3a3050',
  response: '#1f4a37', lounge: '#25453b',
};
const BOOKS = ['#4c8dff', '#f26b6b', '#f5a524', '#13a58a', '#8b5cf6', '#e8637a'];
const WALL_H = 2.5;
const GREEN = '#2fbf71'; // 사용자의 응답이 필요하다는 표시색

export function buildOffice(scene) {
  const leds = [];
  const spinners = [];
  const belts = [];
  const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const glow = (c, i = 0.8) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: i });
  const put = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };
  // 타일 좌표(왼쪽 위 모서리 x,y + 크기 w,d)로 상자를 놓는다. elev 는 바닥에서의 높이.
  const box = (x, y, w, d, h, color, elev = 0, material = null) => {
    const m = put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material ?? mat(color)));
    m.position.set(wx(x + w / 2), elev + h / 2, wz(y + d / 2));
    return m;
  };
  const cyl = (cx, cy, r, h, color, elev = 0, material = null) => {
    const m = put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), material ?? mat(color)));
    m.position.set(wx(cx), elev + h / 2, wz(cy));
    return m;
  };
  const ball = (cx, cy, r, color, elev, material = null) => {
    const m = put(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), material ?? mat(color)));
    m.position.set(wx(cx), elev, wz(cy));
    return m;
  };
  const plant = (x, y) => {
    box(x, y, 0.4, 0.4, 0.3, '#b98450');
    ball(x + 0.2, y + 0.2, 0.32, '#4fb08f', 0.62);
    ball(x + 0.1, y + 0.1, 0.2, '#3d9b7d', 0.55);
  };
  const screen = (cx, cy, w, h, elev, color) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }));
    s.position.set(wx(cx), elev, wz(cy));
    scene.add(s);
  };

  // ---- 바닥, 방 색, 방 경계선
  put(new THREE.Mesh(new THREE.BoxGeometry(FLOOR.w, 0.3, FLOOR.d), mat('#232a43')), { cast: false }).position.set(0, -0.15, 0);
  for (const [id, r] of Object.entries(ROOMS)) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat(FLOOR_TINT[id]));
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(r.x + r.w / 2), 0.008, wz(r.y + r.d / 2));
    m.receiveShadow = true;
    scene.add(m);
    const edge = id === 'response' ? GREEN : '#56628f';
    for (const [x, y, w, d] of [[r.x, r.y, r.w, 0.07], [r.x, r.y + r.d - 0.07, r.w, 0.07], [r.x, r.y, 0.07, r.d], [r.x + r.w - 0.07, r.y, 0.07, r.d]]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), mat(edge, { transparent: true, opacity: id === 'response' ? 0.8 : 0.55 }));
      line.position.set(wx(x + w / 2), 0.02, wz(y + d / 2));
      scene.add(line);
    }
  }
  // 복도 바닥(방 사이): 약간 밝은 띠
  const corridor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.w, 1.2), mat('#2a3149'));
  corridor.rotation.x = -Math.PI / 2;
  corridor.position.set(0, 0.004, wz(4.6));
  corridor.receiveShadow = true;
  scene.add(corridor);
  const grid = new THREE.GridHelper(Math.max(FLOOR.w, FLOOR.d), Math.max(FLOOR.w, FLOOR.d), '#aab7e8', '#aab7e8');
  grid.material.opacity = 0.05;
  grid.material.transparent = true;
  grid.scale.set(FLOOR.w / Math.max(FLOOR.w, FLOOR.d), 1, FLOOR.d / Math.max(FLOOR.w, FLOOR.d));
  grid.position.y = 0.012;
  scene.add(grid);

  // ---- 뒷벽 두 면과 창문(밤 풍경)
  put(new THREE.Mesh(new THREE.BoxGeometry(FLOOR.w + 0.2, WALL_H, 0.2), mat('#3b4569')), { cast: false }).position.set(-0.1, WALL_H / 2, -FLOOR.d / 2 - 0.1);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.2, WALL_H, FLOOR.d), mat('#30385c')), { cast: false }).position.set(-FLOOR.w / 2 - 0.1, WALL_H / 2, 0);
  const window3 = (w, h, px, py, pz, ry) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), glow('#16254a', 0.75));
    g.material.emissive.set('#3b64c0');
    g.position.set(px, py, pz);
    g.rotation.y = ry;
    scene.add(g);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.04), mat('#5b6896'));
    frame.position.set(px, py, pz - 0.02 * Math.cos(ry));
    frame.rotation.y = ry;
    scene.add(frame);
  };
  for (const cx of [5.0, 8.0, 10.0, 12.0, 15.2]) window3(1.3, 1.0, wx(cx), 1.5, -FLOOR.d / 2 + 0.03, 0);
  for (const cy of [7.0, 11.0]) window3(1.3, 1.0, -FLOOR.w / 2 + 0.03, 1.5, wz(cy), Math.PI / 2);

  // ---- 자료실: 책장
  box(0.3, 0.15, 2.8, 0.6, 2.0, '#b98450');
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 11; i++) {
      const h = 0.34 + ((i * 7 + row * 3) % 5) * 0.04;
      box(0.45 + i * 0.22, 0.7, 0.15, 0.1, h, BOOKS[(i + row) % 6], 0.2 + row * 0.62);
    }
  }

  // ---- 리서치실: 컴퓨터 책상 세 개와 지구본 (자료실 바로 옆)
  for (const x of [3.6, 4.65, 5.7]) {
    box(x, 0.5, 0.9, 0.7, 0.72, '#b9c4d8');
    box(x + 0.25, 0.62, 0.4, 0.05, 0.34, '#26304d', 0.78);
    screen(x + 0.45, 0.65, 0.34, 0.24, 1.0, '#7fb6ff');
  }
  cyl(3.8, 1.05, 0.04, 0.2, '#7a8bb0', 0.72);
  ball(3.8, 1.05, 0.17, '#4c8dff', 1.05);

  // ---- 작업실: 팀마다 책상·모니터·팀 색 표시·의자
  const deskAccents = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    const z = deskZone(i);
    box(z.x + 0.2, 0.5, 1.0, 0.7, 0.75, '#e1c597');
    box(z.x + 0.5, 0.62, 0.4, 0.05, 0.34, '#26304d', 0.85);
    screen(z.x + 0.7, 0.65, 0.36, 0.26, 1.03, '#7fe0c8');
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.06), mat('#e8637a'));
    strip.position.set(wx(z.x + 0.7), 0.77, wz(1.3) + 0.03);
    scene.add(strip);
    deskAccents.push(strip);
    box(z.x + 0.45, 2.15, 0.5, 0.45, 0.4, '#7a8bb0');
  }

  // ---- 문서실: 글 쓰는 책상, 종이 더미, 스탠드 (작업실 바로 옆)
  for (const x of [13.75, 14.8, 15.85]) {
    box(x, 0.5, 0.9, 0.7, 0.72, '#c9b78f');
    box(x + 0.15, 0.7, 0.35, 0.45, 0.06, '#ffffff', 0.72);
    box(x + 0.55, 0.62, 0.2, 0.2, 0.05, '#7a6a4a', 0.72);
    cyl(x + 0.65, 0.72, 0.05, 0.28, '#7a6a4a', 0.77);
    ball(x + 0.65, 0.72, 0.1, '#ffe9a8', 1.1, glow('#ffe9a8', 1.1));
  }

  // ---- 기획실: 화이트보드와 포스트잇, 낮은 탁자 (문서실 바로 옆)
  box(17.1, 0.08, 2.6, 0.06, 1.3, '#e8ecf8', 0.8);
  const NOTES = ['#ffd166', '#ff8fa3', '#8fd3ff', '#b8f2a8', '#ffb86b'];
  for (let k = 0; k < 9; k++) box(17.3 + (k % 5) * 0.46, 0.14, 0.26, 0.02, 0.26, NOTES[k % 5], 1.0 + Math.floor(k / 5) * 0.4);
  box(17.4, 1.0, 2.0, 0.7, 0.7, '#d8b98a');
  box(17.7, 1.2, 0.5, 0.3, 0.03, '#ffffff', 0.7);

  // ---- 서버실: 랙과 깜빡이는 LED (자료실 아래)
  for (const y0 of [5.5, 6.7, 7.9]) {
    box(0.1, y0, 0.95, 1.05, 1.75, '#2a3150');
    for (let j = 0; j < 5; j++) {
      const on = (j + Math.round(y0)) % 3 ? '#35e0a1' : '#8b5cf6';
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: on }));
      led.position.set(wx(1.06), 0.35 + j * 0.3, wz(y0 + 0.25));
      scene.add(led);
      leds.push({ led, phase: j * 0.7 + y0 });
      box(1.0, y0 + 0.4, 0.03, 0.55, 0.08, '#3a4470', 0.32 + j * 0.3);
    }
  }

  // ---- 데이터 창고: 드라이브 선반, 상자 더미, 구름 (서버실 옆, 테스트 랩 앞)
  box(3.6, 5.4, 2.8, 0.5, 1.4, '#26344f');
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) box(3.7 + k * 0.44, 5.82, 0.34, 0.08, 0.28, k % 2 ? '#4c8dff' : '#35e0a1', 0.15 + r * 0.45);
  box(5.7, 8.0, 0.6, 0.6, 0.5, '#b9854f');
  box(5.85, 8.05, 0.5, 0.5, 0.45, '#c99a5b', 0.5);
  for (const [dx, dy, r] of [[0, 0, 0.3], [0.35, 0.05, 0.25], [-0.3, 0.08, 0.22]]) ball(4.9 + dx, 8.3 + dy, r, '#e8ecf8', 1.8, mat('#e8ecf8', { transparent: true, opacity: 0.85 }));

  // ---- 테스트 랩: 실험대, 플라스크, 통과 모니터 (작업실 맞은편)
  box(6.75, 5.35, 2.9, 0.6, 0.85, '#3d5a66');
  [['#35e0a1', 7.0], ['#f5a524', 7.5], ['#8b5cf6', 7.95]].forEach(([c, x]) => {
    cyl(x, 5.65, 0.09, 0.26, c, 0.85, glow(c, 0.5));
    ball(x, 5.65, 0.1, c, 1.15, glow(c, 0.5));
  });
  box(8.6, 5.5, 0.5, 0.05, 0.36, '#26304d', 0.88);
  screen(8.85, 5.56, 0.4, 0.26, 1.18, '#35e0a1');

  // ---- 빌드실: 컨베이어 벨트(줄무늬가 흐름), 상자, 돌아가는 톱니 (테스트 랩 옆)
  box(10.0, 5.5, 2.8, 0.55, 0.35, '#2b3350');
  for (let k = 0; k < 8; k++) {
    const stripe = box(10.05 + k * 0.36, 5.52, 0.12, 0.51, 0.02, '#f5a524', 0.355);
    belts.push({ mesh: stripe, x0: 10.05, len: 2.8 - 0.12, off: k * 0.36 });
  }
  box(11.7, 6.0, 0.5, 0.5, 0.5, '#b9854f', 0.35);
  box(12.25, 6.1, 0.4, 0.4, 0.4, '#c99a5b', 0.35);
  const gear = cyl(10.6, 5.35, 0.3, 0.1, '#f5a524', 1.2);
  gear.rotation.x = Math.PI / 2;
  spinners.push(gear);

  // ---- 형상관리실: 브랜치 판과 금고 (빌드실 옆)
  box(13.3, 5.3, 2.6, 0.05, 1.3, '#1d2540', 0.8);
  box(13.45, 5.36, 2.3, 0.02, 0.05, '#4c8dff', 1.45);
  box(13.9, 5.36, 1.2, 0.02, 0.05, '#13a58a', 1.15);
  box(14.6, 5.36, 1.0, 0.02, 0.05, '#f5a524', 1.75);
  for (const [x, e, c] of [[13.5, 1.45, '#4c8dff'], [14.4, 1.45, '#4c8dff'], [15.1, 1.15, '#13a58a'], [15.5, 1.45, '#f5a524']]) ball(x, 5.38, 0.07, c, e + 0.025, glow(c, 0.9));
  box(15.5, 5.7, 0.55, 0.6, 1.3, '#6b7280');

  // ---- 브리핑룸: 큰 화면과 연단 (기획실 맞은편)
  box(16.9, 5.3, 2.6, 0.05, 1.2, '#cfe0ff', 0.8, glow('#3b64c0', 0.9));
  box(17.9, 6.1, 0.7, 0.5, 1.0, '#7a6a4a');
  plant(19.4, 8.3);

  // ---- 응답 대기실: 초록 조명의 대기 벤치 (사용자의 응답이 필요할 때 여기서 기다린다)
  for (let i = 0; i < 5; i++) {
    const bx = 1.2 + 1.3 * i;
    box(bx - 0.5, 11.2, 1.0, 0.5, 0.3, '#2e6b4c');
    box(bx - 0.5, 11.16, 1.0, 0.1, 0.62, '#245a3f');
  }
  box(0.3, 9.6, 7.4, 0.05, 0.04, GREEN, 0, glow(GREEN, 1.0)); // 바닥의 초록 줄
  box(7.0, 12.2, 0.4, 0.4, 0.3, '#b98450');
  ball(7.2, 12.4, 0.3, '#4fb08f', 0.62);

  // ---- 휴게실: 소파, 탁자, 카페 카운터 (응답 대기실 옆) + 오른쪽에 침대(꺼진 세션)
  box(9.0, 12.0, 5.6, 0.95, 0.45, '#3d9b7d');
  box(9.0, 12.0, 5.6, 0.28, 0.95, '#2f8268');
  box(9.0, 12.0, 0.28, 0.95, 0.7, '#2f8268');
  box(14.32, 12.0, 0.28, 0.95, 0.7, '#2f8268');
  box(10.4, 10.9, 1.6, 0.7, 0.4, '#d8b98a');
  box(9.0, 9.55, 3.0, 0.6, 0.9, '#5a4a3a');
  box(9.4, 9.6, 0.5, 0.4, 0.45, '#26304d', 0.9);
  ball(9.65, 9.85, 0.05, '#ff6b6f', 1.4, glow('#ff6b6f', 1.2));
  for (const x of [10.5, 10.8, 11.1]) cyl(x, 9.85, 0.06, 0.12, '#ffffff', 0.9);
  for (let i = 0; i < TEAM_COUNT; i++) {
    const bx = 15.1 + 0.9 * i;
    box(bx - 0.4, 11.3, 0.8, 1.5, 0.18, '#3a3f66');
    box(bx - 0.37, 11.33, 0.74, 1.44, 0.14, '#8aa0d8', 0.18);
    box(bx - 0.3, 11.38, 0.6, 0.3, 0.12, '#e8ecf8', 0.32);
  }
  ball(19.6, 10.0, 0.12, '#ffd28a', 0.8, glow('#ffd28a', 1.3));
  box(19.5, 9.9, 0.2, 0.2, 0.6, '#5a4a3a');
  plant(8.3, 9.7);
  plant(14.4, 9.7);

  // ---- 방 이름표
  const roomLabel = (id) => {
    const r = ROOMS[id];
    const el = document.createElement('div');
    el.className = 'room' + (id === 'response' ? ' room-response' : '');
    el.textContent = ROOM_NAMES[id];
    const o = new CSS2DObject(el);
    const onWall = r.y === 0; // 뒷벽에 붙은 방은 이름표를 벽 위쪽에 둬서 아바타·가구에 가려지지 않게 한다
    o.position.set(wx(r.x + r.w / 2), onWall ? WALL_H - 0.15 : 0.05, onWall ? wz(0.1) : wz(r.y + 0.3));
    scene.add(o);
  };
  Object.keys(ROOMS).forEach(roomLabel);

  return { leds, spinners, belts, deskAccents };
}

// 방별 은은한 조명(색이 방의 분위기를 만든다)
export const LAMPS = [
  ['#8b5cf6', 1.7, 7.2, 14], ['#2bd4b0', 10.1, 2.0, 9], ['#4fd1c5', 8.2, 7.1, 8], ['#ffa94d', 11.4, 7.1, 8],
  ['#7aa2ff', 14.6, 7.1, 6], ['#3ddc84', 4.0, 11.3, 9], ['#ffb870', 11.5, 11.7, 10], ['#6f7fe8', 17.4, 11.7, 8],
];
