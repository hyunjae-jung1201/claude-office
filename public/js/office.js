// 사무실 건물: 바닥, 벽, 방 16개의 가구와 이름표. 좌표는 layout.js 의 타일 좌표(왼쪽 위 모서리 + 크기)를 쓴다.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FLOOR, ROOMS, ROOM_NAMES, deskZone } from './layout.js';

export const wx = (x) => x - FLOOR.w / 2;
export const wz = (y) => y - FLOOR.d / 2;

const FLOOR_TINT = {
  library: '#2b3a60', work: '#244640', docs: '#40384f', planning: '#4a4030', research: '#25414f', hall: '#2a3149',
  server: '#34294f', lab: '#23454a', build: '#4a3a2a', git: '#3a3f2a', data: '#2a3a55', meeting: '#4b3c2c',
  briefing: '#3a3050', consult: '#2f4540', lounge: '#25453b', sleep: '#242a4a',
};
const BOOKS = ['#4c8dff', '#f26b6b', '#f5a524', '#13a58a', '#8b5cf6', '#e8637a'];
const WALL_H = 2.5;

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

  // ---- 바닥, 방 색, 방 경계선
  put(new THREE.Mesh(new THREE.BoxGeometry(FLOOR.w, 0.3, FLOOR.d), mat('#232a43')), { cast: false }).position.set(0, -0.15, 0);
  for (const [id, r] of Object.entries(ROOMS)) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat(FLOOR_TINT[id]));
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(r.x + r.w / 2), id === 'hall' ? 0.004 : 0.008, wz(r.y + r.d / 2));
    m.receiveShadow = true;
    scene.add(m);
    for (const [x, y, w, d] of [[r.x, r.y, r.w, 0.07], [r.x, r.y + r.d - 0.07, r.w, 0.07], [r.x, r.y, 0.07, r.d], [r.x + r.w - 0.07, r.y, 0.07, r.d]]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), mat('#56628f', { transparent: true, opacity: 0.55 }));
      line.position.set(wx(x + w / 2), 0.02, wz(y + d / 2));
      scene.add(line);
    }
  }
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
  for (const cx of [5.0, 7.0, 9.0, 11.6, 18.4]) window3(1.3, 1.0, wx(cx), 1.5, -FLOOR.d / 2 + 0.03, 0);
  for (const cy of [7.6, 12.4]) window3(1.3, 1.0, -FLOOR.w / 2 + 0.03, 1.5, wz(cy), Math.PI / 2);

  // ---- 자료실: 책장
  box(0.3, 0.15, 2.8, 0.6, 2.0, '#b98450');
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 11; i++) {
      const h = 0.34 + ((i * 7 + row * 3) % 5) * 0.04;
      box(0.45 + i * 0.22, 0.7, 0.15, 0.1, h, BOOKS[(i + row) % 6], 0.2 + row * 0.62);
    }
  }

  // ---- 작업실: 팀마다 책상·모니터·팀 색 표시·의자
  const deskAccents = [];
  for (let i = 0; i < 5; i++) {
    const z = deskZone(i);
    box(z.x + 0.2, 0.5, 1.0, 0.7, 0.75, '#e1c597');
    box(z.x + 0.5, 0.62, 0.4, 0.05, 0.34, '#26304d', 0.85);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.26), new THREE.MeshBasicMaterial({ color: '#7fe0c8' }));
    screen.position.set(wx(z.x + 0.7), 1.03, wz(0.62) + 0.03);
    scene.add(screen);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.06), mat('#e8637a'));
    strip.position.set(wx(z.x + 0.7), 0.77, wz(1.3) + 0.03);
    scene.add(strip);
    deskAccents.push(strip);
    box(z.x + 0.45, 2.15, 0.5, 0.45, 0.4, '#7a8bb0');
  }

  // ---- 문서실: 글 쓰는 책상, 종이 더미, 스탠드
  for (const x of [10.55, 11.6, 12.65]) {
    box(x, 0.5, 0.9, 0.7, 0.72, '#c9b78f');
    box(x + 0.15, 0.7, 0.35, 0.45, 0.06, '#ffffff', 0.72);
    box(x + 0.55, 0.62, 0.2, 0.2, 0.05, '#7a6a4a', 0.72);
    cyl(x + 0.65, 0.72, 0.05, 0.28, '#7a6a4a', 0.77);
    ball(x + 0.65, 0.72, 0.1, '#ffe9a8', 1.1, glow('#ffe9a8', 1.1));
  }

  // ---- 기획실: 화이트보드와 포스트잇, 낮은 탁자
  box(13.9, 0.08, 2.6, 0.06, 1.3, '#e8ecf8', 0.8);
  const NOTES = ['#ffd166', '#ff8fa3', '#8fd3ff', '#b8f2a8', '#ffb86b'];
  for (let k = 0; k < 9; k++) box(14.1 + (k % 5) * 0.46, 0.14, 0.26, 0.02, 0.26, NOTES[k % 5], 1.0 + Math.floor(k / 5) * 0.4);
  box(14.2, 1.0, 2.0, 0.7, 0.7, '#d8b98a');
  box(14.5, 1.2, 0.5, 0.3, 0.03, '#ffffff', 0.7);

  // ---- 리서치실: 컴퓨터 책상 세 개와 지구본
  for (const x of [17.0, 18.05, 19.1]) {
    box(x, 0.5, 0.9, 0.7, 0.72, '#b9c4d8');
    box(x + 0.25, 0.62, 0.4, 0.05, 0.34, '#26304d', 0.78);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), new THREE.MeshBasicMaterial({ color: '#7fb6ff' }));
    s.position.set(wx(x + 0.45), 1.0, wz(0.62) + 0.03);
    scene.add(s);
  }
  cyl(17.2, 1.05, 0.04, 0.2, '#7a8bb0', 0.72);
  ball(17.2, 1.05, 0.17, '#4c8dff', 1.05);

  // ---- 지시 대기 구역: 팀마다 벤치
  for (let i = 0; i < 5; i++) {
    const bx = 4.2 + 1.5 * i;
    box(bx - 0.5, 4.5, 1.0, 0.5, 0.3, '#3c4b7c');
    box(bx - 0.5, 4.46, 1.0, 0.1, 0.62, '#2f3b66');
  }

  // ---- 서버실: 랙과 깜빡이는 LED
  for (const y0 of [5.8, 7.0, 8.2]) {
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

  // ---- 테스트 랩: 실험대, 플라스크, 통과 모니터
  box(3.55, 5.55, 2.9, 0.6, 0.85, '#3d5a66');
  [['#35e0a1', 3.8], ['#f5a524', 4.3], ['#8b5cf6', 4.75]].forEach(([c, x]) => {
    cyl(x, 5.85, 0.09, 0.26, c, 0.85, glow(c, 0.5));
    ball(x, 5.85, 0.1, c, 1.15, glow(c, 0.5));
  });
  box(5.4, 5.7, 0.5, 0.05, 0.36, '#26304d', 0.88);
  const labScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.26), new THREE.MeshBasicMaterial({ color: '#35e0a1' }));
  labScreen.position.set(wx(5.65), 1.18, wz(5.76) + 0.03);
  scene.add(labScreen);

  // ---- 빌드실: 컨베이어 벨트(줄무늬가 움직임), 상자, 돌아가는 톱니
  box(6.8, 5.7, 2.8, 0.55, 0.35, '#2b3350');
  for (let k = 0; k < 8; k++) {
    const stripe = box(6.85 + k * 0.36, 5.72, 0.12, 0.51, 0.02, '#f5a524', 0.355);
    belts.push({ mesh: stripe, x0: 6.85, len: 2.8 - 0.12, off: k * 0.36 });
  }
  box(8.5, 6.1, 0.5, 0.5, 0.5, '#b9854f', 0.35);
  box(9.05, 6.2, 0.4, 0.4, 0.4, '#c99a5b', 0.35);
  const gear = cyl(7.4, 5.55, 0.3, 0.1, '#f5a524', 1.2);
  gear.rotation.x = Math.PI / 2;
  spinners.push(gear);

  // ---- 형상관리실: 브랜치 판과 금고
  box(10.1, 5.5, 2.6, 0.05, 1.3, '#1d2540', 0.8);
  box(10.25, 5.56, 2.3, 0.02, 0.05, '#4c8dff', 1.45);
  box(10.7, 5.56, 1.2, 0.02, 0.05, '#13a58a', 1.15);
  box(11.4, 5.56, 1.0, 0.02, 0.05, '#f5a524', 1.75);
  for (const [x, e, c] of [[10.3, 1.45, '#4c8dff'], [11.2, 1.45, '#4c8dff'], [11.9, 1.15, '#13a58a'], [12.3, 1.45, '#f5a524']]) ball(x, 5.58, 0.07, c, e + 0.025, glow(c, 0.9));
  box(12.3, 5.8, 0.55, 0.6, 1.3, '#6b7280');

  // ---- 데이터 창고: 드라이브 선반, 상자 더미, 구름
  box(13.2, 5.6, 2.8, 0.5, 1.4, '#26344f');
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) box(13.3 + k * 0.44, 6.0, 0.34, 0.08, 0.28, k % 2 ? '#4c8dff' : '#35e0a1', 0.15 + r * 0.45);
  box(15.1, 8.3, 0.6, 0.6, 0.5, '#b9854f');
  box(15.3, 8.35, 0.5, 0.5, 0.45, '#c99a5b', 0.5);
  for (const [dx, dy, r] of [[0, 0, 0.3], [0.35, 0.05, 0.25], [-0.3, 0.08, 0.22]]) ball(14.6 + dx, 8.8 + dy, r, '#e8ecf8', 1.8, mat('#e8ecf8', { transparent: true, opacity: 0.85 }));

  // ---- 회의실: 탁자와 의자
  box(17.0, 7.3, 2.4, 1.4, 0.75, '#dbb27a');
  box(17.8, 7.65, 1.0, 0.65, 0.02, '#ffffff', 0.76);
  for (const cx of [17.3, 18.3, 19.1]) {
    box(cx, 6.85, 0.4, 0.35, 0.42, '#7a8bb0');
    box(cx, 8.8, 0.4, 0.35, 0.42, '#7a8bb0');
  }

  // ---- 브리핑룸: 연단과 왼쪽 벽의 큰 화면
  box(1.3, 10.6, 0.7, 0.5, 1.0, '#7a6a4a');
  box(0.04, 10.4, 0.05, 2.6, 1.3, '#cfe0ff', 0.8, glow('#3b64c0', 0.9));
  box(0.5, 13.2, 0.5, 0.5, 0.45, '#7a8bb0');
  plant(2.6, 13.3);

  // ---- 상담실: 책상, 맞은편 의자 두 개, 화분
  box(4.5, 10.2, 1.4, 0.6, 0.7, '#d8b98a');
  box(4.6, 11.0, 0.45, 0.45, 0.42, '#7a8bb0');
  box(5.35, 11.0, 0.45, 0.45, 0.42, '#7a8bb0');
  plant(6.0, 13.3);

  // ---- 휴게실: 소파, 탁자, 카페 카운터와 커피 머신
  box(6.9, 12.7, 5.6, 0.95, 0.45, '#3d9b7d');
  box(6.9, 12.7, 5.6, 0.28, 0.95, '#2f8268');
  box(6.9, 12.7, 0.28, 0.95, 0.7, '#2f8268');
  box(12.22, 12.7, 0.28, 0.95, 0.7, '#2f8268');
  box(8.6, 11.3, 1.6, 0.7, 0.4, '#d8b98a');
  box(7.0, 9.95, 3.0, 0.6, 0.9, '#5a4a3a');
  box(7.4, 10.0, 0.5, 0.4, 0.45, '#26304d', 0.9);
  ball(7.65, 10.25, 0.05, '#ff6b6f', 1.4, glow('#ff6b6f', 1.2));
  for (const x of [8.5, 8.8, 9.1]) cyl(x, 10.25, 0.06, 0.12, '#ffffff', 0.9);
  plant(12.7, 10.2);
  plant(6.8, 10.8);

  // ---- 수면실: 침대 5개(팀마다 하나)와 은은한 등
  for (let i = 0; i < 5; i++) {
    const bx = 14.1 + 1.2 * i;
    box(bx - 0.55, 12.3, 1.1, 1.5, 0.18, '#3a3f66');
    box(bx - 0.5, 12.35, 1.0, 1.4, 0.14, '#8aa0d8', 0.18);
    box(bx - 0.4, 12.4, 0.8, 0.3, 0.12, '#e8ecf8', 0.32);
  }
  ball(19.6, 10.6, 0.12, '#ffd28a', 0.8, glow('#ffd28a', 1.3));
  box(19.5, 10.5, 0.2, 0.2, 0.6, '#5a4a3a');

  // ---- 방 이름표
  const roomLabel = (id) => {
    const r = ROOMS[id];
    const el = document.createElement('div');
    el.className = 'room';
    el.textContent = ROOM_NAMES[id];
    const o = new CSS2DObject(el);
    const onWall = r.y === 0; // 뒷벽에 붙은 방은 이름표를 벽 위쪽에 둬서 아바타·가구에 가려지지 않게 한다
    o.position.set(wx(r.x + r.w / 2), onWall ? WALL_H - 0.15 : 0.05, onWall ? wz(0.1) : wz(id === 'hall' ? r.y + r.d - 0.2 : r.y + 0.35));
    scene.add(o);
  };
  Object.keys(ROOMS).forEach(roomLabel);

  return { leds, spinners, belts, deskAccents };
}

// 방별 은은한 조명(색이 방의 분위기를 만든다)
export const LAMPS = [
  ['#8b5cf6', 1.7, 7.5, 14], ['#2bd4b0', 6.9, 2.0, 9], ['#4fd1c5', 5.0, 7.4, 8], ['#ffa94d', 8.2, 7.4, 8],
  ['#7aa2ff', 11.4, 7.4, 6], ['#ffb870', 9.6, 12.0, 10], ['#6f7fe8', 16.7, 12.0, 8], ['#ffd28a', 18.2, 7.6, 7],
];
