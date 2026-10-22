// 사무실 건물: 바닥 마감, 벽, 방 13개의 가구와 소품, 방 이름판. 좌표는 layout.js 의 타일 좌표(왼쪽 위 모서리 + 크기)를 쓴다.
// 방향: "퇴근 시간 무렵의 작은 회사" — 따뜻한 조명, 나무·카펫·콘크리트 같은 실제 마감재, 책상 위 잡동사니와 낙서.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOOR, ROOMS, ROOM_NAMES, TEAM_COUNT, deskZone } from './layout.js';
import * as T from './textures.js';

export const wx = (x) => x - FLOOR.w / 2;
export const wz = (y) => y - FLOOR.d / 2;

const WALL_H = 2.6;
const GREEN = '#2fbf71'; // 사용자의 응답이 필요하다는 표시색
const BRASS = '#b79a62';
const BOOKS = ['#c4553f', '#d9a441', '#4f7f9c', '#6f8f6a', '#8a5f8f', '#b9744f', '#3f5a7a', '#a86a5a'];
const NOTES = ['#ffd166', '#ff8fa3', '#8fd3ff', '#b8f2a8', '#ffb86b'];

export function buildOffice(scene) {
  const existing = new Set(scene.children); // 조명처럼 이미 있던 것은 건드리지 않는다
  const leds = [];
  const spinners = [];
  const belts = [];
  const deskAccents = [];

  // ---------------------------------------------------------------- 재료·도형 도우미
  const matCache = new Map();
  const std = (color, o = {}) => {
    const plain = !o.map && !o.emissive && !o.transparent;
    const key = plain ? `${color}|${o.rough ?? ''}|${o.metal ?? ''}` : null;
    if (key && matCache.has(key)) return matCache.get(key);
    const shiny = (o.metal ?? 0) > 0.15 || (o.rough ?? 1) < 0.45; // 금속·유리·광택 바닥만 비싼 재료를 쓴다
    const extra = {
      ...(o.map ? { map: o.map } : {}),
      ...(o.emissive ? { emissive: o.emissive, emissiveIntensity: o.ei ?? 0.8 } : {}),
      ...(o.transparent ? { transparent: true, opacity: o.opacity ?? 0.6 } : {}),
    };
    const m = shiny
      ? new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.5, metalness: o.metal ?? 0, ...extra })
      : new THREE.MeshLambertMaterial({ color, ...extra });
    if (key) matCache.set(key, m);
    return m;
  };
  const put = (mesh, shadow = true) => {
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    return mesh;
  };
  const geoBox = (w, h, d, r) => {
    const rad = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
    // 작은 소품은 그냥 상자(삼각형 수를 아끼고, 어차피 작아서 모서리가 안 보인다)
    return rad > 0.012 && Math.min(w, h, d) > 0.07 ? new RoundedBoxGeometry(w, h, d, 1, rad) : new THREE.BoxGeometry(w, h, d);
  };
  // 타일 좌표(왼쪽 위 모서리 x,y + 크기 w,d)로 모서리가 둥근 상자를 놓는다. elev 는 바닥에서의 높이.
  const box = (x, y, w, d, h, color, elev = 0, o = {}) => {
    const m = put(new THREE.Mesh(geoBox(w, h, d, o.r ?? 0.035), o.material ?? std(color, o)), o.shadow !== false);
    m.position.set(wx(x + w / 2), elev + h / 2, wz(y + d / 2));
    if (o.rot) m.rotation.y = o.rot;
    scene.add(m);
    return m;
  };
  const cyl = (cx, cy, r, h, color, elev = 0, o = {}) => {
    const m = put(new THREE.Mesh(new THREE.CylinderGeometry(o.r2 ?? r, r, h, o.seg ?? 20), o.material ?? std(color, o)));
    m.position.set(wx(cx), elev + h / 2, wz(cy));
    scene.add(m);
    return m;
  };
  const ball = (cx, cy, r, color, elev, o = {}) => {
    const m = put(new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), o.material ?? std(color, o)));
    m.position.set(wx(cx), elev, wz(cy));
    if (o.sy) m.scale.y = o.sy;
    scene.add(m);
    return m;
  };
  const flat = (cx, cy, w, h, elev, material, rotY = 0) => { // 세로 판(화면·액자·보드)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.position.set(wx(cx), elev, wz(cy));
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  };
  const basic = (map) => new THREE.MeshBasicMaterial({ map });
  const glow = (c, ei = 0.9) => std(c, { emissive: c, ei });

  // ---------------------------------------------------------------- 소품
  const plant = (x, y, kind = 0) => {
    const pots = ['#c9704f', '#8a8f9a', '#d9c7a3'];
    cyl(x + 0.2, y + 0.2, 0.17, 0.3, pots[kind % 3], 0, { r2: 0.13 });
    cyl(x + 0.2, y + 0.2, 0.12, 0.02, '#3a2c20', 0.29);
    const leaf = ['#4f8f6a', '#5aa27a', '#3f7a5a'];
    if (kind % 2 === 0) { // 둥근 잎 덤불
      ball(x + 0.2, y + 0.2, 0.3, leaf[0], 0.65, { sy: 0.9 });
      ball(x + 0.08, y + 0.12, 0.2, leaf[1], 0.55);
      ball(x + 0.3, y + 0.28, 0.18, leaf[2], 0.52);
    } else { // 길쭉한 잎
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const leafM = put(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.62, 5), std(leaf[k % 3])));
        leafM.position.set(wx(x + 0.2 + Math.cos(a) * 0.1), 0.62, wz(y + 0.2 + Math.sin(a) * 0.1));
        leafM.rotation.z = Math.cos(a) * 0.35;
        leafM.rotation.x = Math.sin(a) * 0.35;
        scene.add(leafM);
      }
    }
  };
  const mug = (x, y, elev, color = '#e8e2d4') => {
    cyl(x, y, 0.045, 0.09, color, elev);
    cyl(x, y, 0.036, 0.01, '#5a3a22', elev + 0.085);
  };
  const monitor = (cx, cy, elev, tex, w = 0.42, h = 0.27) => { // 모니터: 받침 + 베젤 + 화면
    cyl(cx, cy, 0.07, 0.025, '#2a2f3d', elev);
    box(cx - 0.015, cy - 0.015, 0.03, 0.03, 0.12, '#2a2f3d', elev + 0.02, { r: 0.005 });
    box(cx - w / 2 - 0.02, cy - 0.025, w + 0.04, 0.04, h + 0.04, '#20242f', elev + 0.12, { r: 0.012 });
    flat(cx, cy + 0.0, w, h, elev + 0.12 + (h + 0.04) / 2, basic(tex), 0).position.z += 0.025;
  };
  const keyboard = (x, y, elev) => box(x, y, 0.34, 0.11, 0.02, '#3a3f4d', elev, { r: 0.008 });
  const chair = (x, y, color = '#3f5a7a', rot = 0) => {
    const g = new THREE.Group();
    g.position.set(wx(x), 0, wz(y));
    g.rotation.y = rot;
    const add = (geo, mat, px, py, pz) => { const m = put(new THREE.Mesh(geo, mat)); m.position.set(px, py, pz); g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 5), std('#2a2f3d'), 0, 0.04, 0);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), std('#4a4f5d', { metal: 0.6, rough: 0.4 }), 0, 0.2, 0);
    add(geoBox(0.42, 0.07, 0.4, 0.03), std(color), 0, 0.4, 0);
    add(geoBox(0.4, 0.4, 0.06, 0.03), std(color), 0, 0.64, 0.19);
    scene.add(g);
    return g;
  };
  const picture = (at, onSideWall, elev, w, h, tex) => { // 액자: 뒷벽(y=0) 또는 옆벽(x=0)에 건다
    const frame = put(new THREE.Mesh(new THREE.BoxGeometry(w + 0.07, h + 0.07, 0.04), std('#e8e0cf')), false);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(tex));
    if (onSideWall) {
      frame.position.set(wx(0.06), elev, wz(at)); frame.rotation.y = Math.PI / 2;
      face.position.set(wx(0.09), elev, wz(at)); face.rotation.y = Math.PI / 2;
    } else {
      frame.position.set(wx(at), elev, wz(0.06));
      face.position.set(wx(at), elev, wz(0.09));
    }
    scene.add(frame, face);
  };
  const lampFloor = (x, y, color = '#ffd9a0') => {
    cyl(x, y, 0.1, 0.03, '#2a2f3d', 0);
    cyl(x, y, 0.015, 1.25, '#3a3f4d', 0.03);
    cyl(x, y, 0.2, 0.26, '#f3e6c8', 1.22, { r2: 0.13, material: std(color, { emissive: color, ei: 0.55 }) });
  };
  const sticky = (x, elev, rot = 0) => box(x, 0.075, 0.12, 0.01, 0.12, NOTES[Math.floor(x * 7) % 5], elev, { r: 0.002, rot });

  // ---------------------------------------------------------------- 바닥 판과 바깥
  const slab = put(new THREE.Mesh(new THREE.BoxGeometry(FLOOR.w + 0.5, 0.4, FLOOR.d + 0.5), std('#4b4034', { rough: 0.9 })), false);
  slab.position.set(0, -0.2, 0);
  scene.add(slab);
  const groundTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, 'rgba(40,46,74,0.95)');
    grad.addColorStop(0.55, 'rgba(26,31,52,0.7)');
    grad.addColorStop(1, 'rgba(15,20,36,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.42;
  scene.add(ground);

  // 바깥 데크(앞쪽·오른쪽)와 화분: 건물이 허공에 떠 있지 않게
  const deckTex = T.cached('deck', () => T.planks('#7d6347', 21));
  for (const [x, y, w, d] of [[-0.25, 13.25, FLOOR.w + 1.9, 1.35], [20.25, 0.0, 1.35, FLOOR.d + 0.25]]) {
    const m = put(new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), std('#ffffff', { map: T.repeated(deckTex, w / 2, d / 2) })), false);
    m.position.set(wx(x + w / 2), -0.04, wz(y + d / 2));
    scene.add(m);
  }
  const bush = (x, y, s = 1) => {
    box(x - 0.3 * s, y - 0.3 * s, 0.6 * s, 0.6 * s, 0.34 * s, '#5b4a3a', 0, { r: 0.05 });
    ball(x, y, 0.34 * s, '#4f8f6a', 0.55 * s, { sy: 0.85 });
    ball(x - 0.2 * s, y + 0.05, 0.22 * s, '#5aa27a', 0.45 * s);
    ball(x + 0.22 * s, y - 0.05, 0.2 * s, '#3f7a5a', 0.42 * s);
  };
  for (const x of [1.2, 4.6, 8.1, 11.9, 15.3, 18.7]) bush(x, 13.9, 0.9 + ((x * 3) % 3) * 0.1);
  for (const y of [1.5, 6.5, 9.2, 12.3]) bush(20.9, y, 0.85);
  // 오른쪽 문: 아바타가 드나드는 입구(우측 복도 끝)
  box(19.55, 4.15, 0.45, 1.0, 0.012, '#7a3a3a', 0, { r: 0.004 }); // 현관 매트
  for (const y of [4.0, 5.2]) box(20.1, y, 0.12, 0.12, 1.9, '#8a6a4a', 0, { r: 0.02 });
  box(20.1, 3.95, 0.12, 1.37, 0.12, '#8a6a4a', 1.9, { r: 0.02 });

  // ---------------------------------------------------------------- 방 바닥
  const floorSpec = {
    library: () => T.cached('f-wood-lib', () => T.planks('#8a5f3a', 31)),
    research: () => T.cached('f-carpet-blue', () => T.carpet('#56667f', 32)),
    work: () => T.cached('f-wood-work', () => T.planks('#b99565', 33)),
    docs: () => T.cached('f-wood-docs', () => T.planks('#a47a4c', 34)),
    planning: () => T.cached('f-carpet-warm', () => T.carpet('#8a6f5f', 35)),
    server: () => T.cached('f-raised', () => T.raisedFloor('#3b3e50')),
    data: () => T.cached('f-concrete-a', () => T.concrete('#6a6e78', 36)),
    lab: () => T.cached('f-tiles', () => T.tiles('#dfe5e1', '#9aa8a2')),
    build: () => T.cached('f-concrete-b', () => T.concrete('#7a766c', 37)),
    git: () => T.cached('f-carpet-grey', () => T.carpet('#575d6c', 38)),
    briefing: () => T.cached('f-carpet-dark', () => T.carpet('#43485c', 39)),
    response: () => T.cached('f-carpet-green', () => T.carpet('#4e7a62', 40)),
    lounge: () => T.cached('f-terrazzo', () => T.terrazzo('#c8b89c', 41)),
  };
  const scale = { server: 2.2, data: 2.4, build: 2.4, lab: 2.4, research: 2.2, git: 2.2, briefing: 2.2, response: 2.2, planning: 2.2, lounge: 2.4 };
  for (const [id, r] of Object.entries(ROOMS)) {
    const s = scale[id] ?? 2.8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), std('#ffffff', { rough: id === 'lab' ? 0.35 : 0.9, map: T.repeated(floorSpec[id](), r.w / s, r.d / s) }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(r.x + r.w / 2), 0.008, wz(r.y + r.d / 2));
    m.receiveShadow = true;
    scene.add(m);
    // 방 사이 문턱: 놋쇠 줄눈(응답 대기실만 초록 불빛)
    const edge = id === 'response' ? glow(GREEN, 0.9) : std(BRASS, { metal: 0.7, rough: 0.4 });
    for (const [x, y, w, d] of [[r.x, r.y, r.w, 0.045], [r.x, r.y + r.d - 0.045, r.w, 0.045], [r.x, r.y, 0.045, r.d], [r.x + r.w - 0.045, r.y, 0.045, r.d]]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), edge);
      line.position.set(wx(x + w / 2), 0.016, wz(y + d / 2));
      scene.add(line);
    }
  }
  // 복도(방 사이 띠)
  const hall = T.cached('f-hall', () => T.terrazzo('#bfb3a0', 42));
  for (const [cx, cy, w, d] of [[FLOOR.w / 2, 4.6, FLOOR.w, 1.2], [FLOOR.w / 2, 9.2, FLOOR.w, 0.4]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std('#ffffff', { rough: 0.55, map: T.repeated(hall, w / 2.6, d / 2.6) }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(cx), 0.004, wz(cy));
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---------------------------------------------------------------- 벽(뒤·왼쪽)과 창문
  const plaster = T.cached('wall', () => T.plasterWall('#d6cdbb', 51));
  const wallMat = (len) => std('#ffffff', { map: T.repeated(plaster, len / 2, 1), rough: 0.95 });
  const wallPiece = (w, h, d, color, px, py, pz, o = {}) => {
    const m = put(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.material ?? std(color, o)), false);
    m.position.set(px, py, pz);
    scene.add(m);
  };
  // 뒷벽(y=0): 위 회벽, 아래 세이지색 판넬, 걸레받이, 위쪽 몰딩
  wallPiece(FLOOR.w + 0.2, WALL_H, 0.2, null, -0.1, WALL_H / 2, -FLOOR.d / 2 - 0.1, { material: wallMat(FLOOR.w) });
  wallPiece(FLOOR.w + 0.2, 0.9, 0.06, '#7f9a90', -0.1, 0.45, -FLOOR.d / 2 + 0.03, { rough: 0.7 });
  wallPiece(FLOOR.w + 0.2, 0.09, 0.08, '#e8e0d0', -0.1, 0.94, -FLOOR.d / 2 + 0.04);
  wallPiece(FLOOR.w + 0.2, 0.12, 0.09, '#4a3d33', -0.1, 0.06, -FLOOR.d / 2 + 0.045);
  wallPiece(FLOOR.w + 0.3, 0.1, 0.28, '#efe8d8', -0.1, WALL_H + 0.02, -FLOOR.d / 2 - 0.1);
  // 왼쪽 벽(x=0)
  wallPiece(0.2, WALL_H, FLOOR.d, null, -FLOOR.w / 2 - 0.1, WALL_H / 2, 0, { material: wallMat(FLOOR.d) });
  wallPiece(0.06, 0.9, FLOOR.d, '#7f9a90', -FLOOR.w / 2 + 0.03, 0.45, 0, { rough: 0.7 });
  wallPiece(0.08, 0.09, FLOOR.d, '#e8e0d0', -FLOOR.w / 2 + 0.04, 0.94, 0);
  wallPiece(0.09, 0.12, FLOOR.d, '#4a3d33', -FLOOR.w / 2 + 0.045, 0.06, 0);
  wallPiece(0.28, 0.1, FLOOR.d + 0.3, '#efe8d8', -FLOOR.w / 2 - 0.1, WALL_H + 0.02, 0.1);

  const duskTex = T.cached('dusk', () => T.dusk(61));
  const windowAt = (px, pz, w, h, side, py = 1.55) => {
    const g = new THREE.Group();
    g.position.set(px, py, pz);
    if (side) g.rotation.y = Math.PI / 2;
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(duskTex)));
    const add = (geo, mat, x, y, z) => { const mm = put(new THREE.Mesh(geo, mat), false); mm.position.set(x, y, z); g.add(mm); };
    const fm = std('#f3eee2', { rough: 0.5 });
    add(new THREE.BoxGeometry(w + 0.14, 0.07, 0.1), fm, 0, h / 2 + 0.035, 0.03);
    add(new THREE.BoxGeometry(w + 0.14, 0.07, 0.1), fm, 0, -h / 2 - 0.035, 0.03);
    add(new THREE.BoxGeometry(0.07, h, 0.1), fm, -w / 2 - 0.035, 0, 0.03);
    add(new THREE.BoxGeometry(0.07, h, 0.1), fm, w / 2 + 0.035, 0, 0.03);
    add(new THREE.BoxGeometry(0.035, h, 0.06), fm, 0, 0, 0.02);
    add(new THREE.BoxGeometry(w, 0.035, 0.06), fm, 0, 0, 0.02);
    add(new THREE.BoxGeometry(w + 0.3, 0.05, 0.22), std('#efe8d8'), 0, -h / 2 - 0.09, 0.1); // 창턱
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(w - 0.02, 0.035, 0.03), std('#e9e1cf', { rough: 0.6 }), 0, h / 2 - 0.05 - k * 0.07, 0.06); // 반쯤 내린 블라인드
    scene.add(g);
  };
  for (const cx of [5.0, 8.0, 10.0, 12.0, 15.2]) windowAt(wx(cx), -FLOOR.d / 2 + 0.1, 1.3, 1.0, false);
  for (const cy of [7.0, 11.0]) windowAt(-FLOOR.w / 2 + 0.1, wz(cy), 1.3, 1.0, true);

  // 벽 장식: 시계, 액자
  const clock = new THREE.Group();
  clock.position.set(wx(9.0), 2.1, wz(0.1));
  const rim = put(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 28), std('#2d3340')), false);
  rim.rotation.x = Math.PI / 2;
  clock.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.19, 28), std('#f4efe2'));
  face.position.z = 0.03;
  clock.add(face);
  for (const [len, rot] of [[0.13, 0.9], [0.17, -0.5]]) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.014, len, 0.01), std('#2d3340'));
    hand.position.set(-Math.sin(rot) * len / 2, Math.cos(rot) * len / 2, 0.04);
    hand.rotation.z = rot;
    clock.add(hand);
  }
  scene.add(clock);
  const posters = [T.poster(71, '#e8637a', '#f5a524'), T.poster(72, '#4c8dff', '#8b5cf6'), T.poster(73, '#13a58a', '#f2d16b'), T.poster(74, '#c9704f', '#e8d7b0')];
  picture(11.1, false, 1.95, 0.42, 0.58, posters[0]);
  picture(3.85, false, 1.8, 0.36, 0.5, posters[1]);
  picture(6.2, false, 1.8, 0.36, 0.5, posters[2]);
  picture(14.15, false, 1.75, 0.4, 0.55, posters[3]);
  const map = T.cached('map', () => T.mapBoard(75));
  picture(16.5, false, 1.75, 0.55, 0.38, map);
  picture(1.0, true, 1.75, 0.5, 0.36, map);

  // ---------------------------------------------------------------- 자료실: 책장·독서 구석
  // 열린 책장: 뒤판·양옆·선반 판 위에 책을 세운다
  box(0.3, 0.15, 2.9, 0.05, 2.05, '#6a4326', 0, { r: 0.01 });
  for (const sx of [0.3, 3.15]) box(sx, 0.15, 0.05, 0.6, 2.05, '#7a4f2e', 0, { r: 0.01 });
  box(0.3, 0.15, 2.9, 0.6, 0.05, '#7a4f2e', 2.0, { r: 0.01 });
  for (let row = 0; row < 3; row++) {
    box(0.35, 0.2, 2.8, 0.55, 0.035, '#8a5a35', 0.12 + row * 0.62, { r: 0.004 });
    let x = 0.42;
    for (let i = 0; i < 14 && x < 3.05; i++) {
      const h = 0.34 + ((i * 7 + row * 3) % 5) * 0.045;
      const w = 0.1 + ((i * 5 + row) % 3) * 0.035;
      const lean = (i + row) % 9 === 0;
      box(x, 0.32, w, 0.3, h, BOOKS[(i * 3 + row) % BOOKS.length], 0.155 + row * 0.62, { r: 0.006, rot: lean ? 0.12 : 0 });
      x += w + 0.03;
    }
  }
  box(0.42, 0.4, 0.5, 0.3, 0.05, '#e8e0cf', 2.05, { r: 0.01 }); // 책장 위에 쌓은 서류철
  cyl(1.9, 3.0, 0.85, 0.012, '#8a4f4f', 0, { seg: 40 }); // 둥근 러그
  cyl(1.9, 3.0, 0.6, 0.014, '#b9744f', 0, { seg: 40 });
  box(1.5, 3.2, 0.6, 0.55, 0.45, '#5f7f6f', 0, { r: 0.12 }); // 안락의자
  box(1.5, 3.62, 0.6, 0.14, 0.78, '#5f7f6f', 0, { r: 0.08 });
  lampFloor(2.5, 3.5);

  // ---------------------------------------------------------------- 리서치실
  const screens = [T.codeScreen(81, '#7fb6ff'), T.chartScreen(82), T.codeScreen(83, '#f5a524')];
  [3.6, 4.65, 5.7].forEach((x, i) => {
    box(x, 0.5, 0.92, 0.7, 0.04, '#d6dbe6', 0.7, { r: 0.015 });
    for (const lx of [x + 0.04, x + 0.84]) box(lx, 0.56, 0.04, 0.58, 0.7, '#8b93a8', 0, { r: 0.01, metal: 0.4 });
    monitor(x + 0.46, 0.68, 0.74, screens[i]);
    keyboard(x + 0.29, 0.92, 0.74);
    if (i === 1) mug(x + 0.8, 0.9, 0.74, '#d9553f');
    else box(x + 0.7, 0.85, 0.16, 0.2, 0.025, '#fff9e8', 0.74, { r: 0.004, rot: 0.2 });
    chair(x + 0.46, 1.55, ['#4f6a8f', '#6a8a6a', '#8f6a5a'][i], (i - 1) * 0.3);
  });
  cyl(4.0, 2.7, 0.03, 0.55, '#7a8bb0', 0.0); // 지구본
  ball(4.0, 2.7, 0.2, '#4c7fb0', 0.78, { rough: 0.5 });

  // ---------------------------------------------------------------- 작업실: 팀 책상
  const deskTops = ['#dcc08f', '#cfb27e', '#e1c99d', '#d5ba88', '#dcc08f', '#c9ad7c'];
  const wsScreens = [T.codeScreen(91, '#7fe0c8'), T.codeScreen(92, '#8fb2ff'), T.chartScreen(93)];
  for (let i = 0; i < TEAM_COUNT; i++) {
    const z = deskZone(i);
    const dx = z.x + 0.09;
    box(dx, 0.5, 0.96, 0.7, 0.045, deskTops[i], 0.7, { r: 0.015 });
    box(dx + 0.04, 0.54, 0.05, 0.6, 0.7, '#6d5a42', 0, { r: 0.01 });
    box(dx + 0.87, 0.54, 0.05, 0.6, 0.7, '#6d5a42', 0, { r: 0.01 });
    box(dx + 0.1, 0.56, 0.76, 0.03, 0.34, '#6d5a42', 0.34, { r: 0.006 });
    monitor(dx + 0.4, 0.7, 0.745, wsScreens[i % 3]);
    keyboard(dx + 0.22, 0.97, 0.745);
    mug(dx + 0.8, 0.95, 0.745, ['#e8e2d4', '#d9553f', '#4f7f9c', '#e8b44a', '#8a5f8f', '#e8e2d4'][i]);
    if (i % 2 === 0) box(dx + 0.62, 0.9, 0.14, 0.18, 0.03, '#fff9e8', 0.745, { r: 0.004, rot: 0.35 });
    sticky(dx + 0.12, 1.1 + (i % 2) * 0.05, (i - 2) * 0.05);
    // 팀 색 명패(팀 색이 바뀌면 scene 이 색을 입힌다)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.02), new THREE.MeshBasicMaterial({ color: '#e8637a' }));
    strip.position.set(wx(dx + 0.48), 0.8, wz(1.215));
    scene.add(strip);
    deskAccents.push(strip);
    chair(z.x + 0.58, 2.28, ['#3f5a7a', '#5a6a4a', '#7a4f4f', '#4a4f6a', '#6a5a3f', '#4f6a6a'][i], (i % 3 - 1) * 0.35);
  }
  // 책상 앞 러그: 팀원 자리를 깔아 준다
  box(6.95, 2.62, 6.4, 1.15, 0.012, '#365a5c', 0, { r: 0.004 });
  box(7.02, 2.69, 6.26, 1.01, 0.014, '#2d4a4c', 0, { r: 0.004 });
  for (let k = 0; k < 18; k++) box(7.1 + k * 0.34, 2.75, 0.12, 0.02, 0.016, k % 3 ? '#b79a62' : '#d9c7a3', 0, { r: 0.002 });
  plant(13.0, 3.3, 1);
  plant(6.8, 3.4, 0);

  // ---------------------------------------------------------------- 문서실
  [13.75, 14.8, 15.85].forEach((x, i) => {
    box(x, 0.5, 0.92, 0.7, 0.045, '#c4a87a', 0.7, { r: 0.015 });
    box(x + 0.04, 0.54, 0.05, 0.6, 0.7, '#6d5a42', 0, { r: 0.01 });
    box(x + 0.83, 0.54, 0.05, 0.6, 0.7, '#6d5a42', 0, { r: 0.01 });
    box(x + 0.12, 0.66, 0.34, 0.46, 0.012, '#ffffff', 0.745, { r: 0.002, rot: 0.1 * (i - 1) });
    box(x + 0.17, 0.72, 0.34, 0.46, 0.012, '#f7f2e2', 0.757, { r: 0.002, rot: -0.07 });
    box(x + 0.55, 0.8, 0.22, 0.14, 0.05, '#7a4f2e', 0.745, { r: 0.012 });
    cyl(x + 0.7, 0.62, 0.05, 0.03, '#2a2f3d', 0.745);
    cyl(x + 0.7, 0.62, 0.012, 0.3, '#3a3f4d', 0.77);
    cyl(x + 0.7, 0.62, 0.11, 0.14, '#ffe9a8', 1.05, { r2: 0.05, material: std('#ffe9a8', { emissive: '#ffd98a', ei: 0.9 }) });
    chair(x + 0.46, 1.5, ['#8f6a5a', '#6a8a8f', '#8a7a5a'][i], 0.2 * (i - 1));
  });
  box(16.35, 0.2, 0.4, 0.5, 0.95, '#8a93a0', 0, { r: 0.02, metal: 0.3 }); // 서류함
  for (let k = 0; k < 3; k++) box(16.4, 0.7, 0.3, 0.02, 0.2, '#9aa3b0', 0.07 + k * 0.3, { r: 0.006 });
  plant(13.7, 3.3, 0);

  // ---------------------------------------------------------------- 기획실
  flat(18.4, 0.1, 2.6, 1.3, 1.45, basic(T.cached('kanban', () => T.kanban(101))));
  box(17.08, 0.06, 2.64, 0.05, 1.34, '#cfd4de', 0.78, { r: 0.012, metal: 0.4 }); // 보드 틀(뒤)
  box(17.15, 0.05, 2.5, 0.03, 0.03, '#8b93a8', 0.75, { r: 0.008 }); // 마커 받침
  for (const [x, c] of [[17.5, '#e8637a'], [17.65, '#4c8dff'], [17.8, '#13a58a']]) cyl(x, 0.13, 0.012, 0.11, c, 0.78, { seg: 8 }).rotation.z = Math.PI / 2;
  box(17.3, 1.0, 1.9, 0.7, 0.04, '#e4d3b0', 0.38, { r: 0.015 }); // 낮은 탁자
  for (const [x, y] of [[17.4, 1.05], [18.95, 1.05], [17.4, 1.58], [18.95, 1.58]]) cyl(x + 0.05, y + 0.05, 0.03, 0.38, '#6d5a42', 0);
  box(17.6, 1.2, 0.35, 0.24, 0.02, '#c9d3e6', 0.42, { r: 0.006 });
  mug(18.5, 1.3, 0.42, '#e8b44a');
  mug(18.7, 1.5, 0.42, '#d9553f');
  for (const [x, y, c] of [[17.0, 1.35, '#c9704f'], [19.5, 1.35, '#6f8f6a'], [18.2, 2.2, '#4f7f9c']]) cyl(x + 0.1, y + 0.1, 0.17, 0.3, c, 0); // 스툴
  plant(19.4, 3.2, 1);

  // ---------------------------------------------------------------- 서버실
  for (const y0 of [5.5, 6.7, 7.9]) {
    box(0.1, y0, 0.95, 1.05, 1.85, '#232838', 0, { r: 0.03 });
    box(0.95, y0 + 0.05, 0.05, 0.95, 1.75, '#2f3547', 0.05, { r: 0.01 });
    for (let j = 0; j < 6; j++) {
      const on = (j + Math.round(y0)) % 3 ? '#35e0a1' : '#7a8cff';
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: on }));
      led.position.set(wx(1.01), 0.3 + j * 0.27, wz(y0 + 0.22));
      scene.add(led);
      leds.push({ led, phase: j * 0.7 + y0 });
      box(1.0, y0 + 0.36, 0.03, 0.55, 0.06, '#1a1e2b', 0.27 + j * 0.27, { r: 0.004 });
      for (let k = 0; k < 4; k++) box(1.03, y0 + 0.4 + k * 0.13, 0.012, 0.02, 0.04, '#4a5068', 0.275 + j * 0.27, { r: 0.002 });
    }
    for (let k = 0; k < 3; k++) cyl(0.2, y0 + 0.2 + k * 0.3, 0.018, 1.0, ['#e8b44a', '#4c8dff', '#e8637a'][k], 1.85, { seg: 6 }).rotation.x = 0.1; // 늘어진 케이블
  }
  box(2.2, 5.45, 0.9, 0.8, 1.5, '#d9d9d2', 0, { r: 0.04 }); // 항온기
  cyl(2.65, 5.52, 0.3, 0.03, '#2a2f3d', 0.9).rotation.x = Math.PI / 2;
  box(2.35, 5.5, 0.6, 0.02, 0.12, '#2a2f3d', 1.25, { r: 0.004 });
  box(1.1, 8.4, 0.9, 0.4, 0.3, '#2f3547', 0, { r: 0.04 }); // UPS
  box(1.25, 8.58, 0.25, 0.02, 0.08, '#35e0a1', 0.15, { r: 0.002, material: glow('#35e0a1', 1.0) });

  // ---------------------------------------------------------------- 데이터 창고
  box(3.6, 5.4, 2.8, 0.5, 1.5, '#2d3a55', 0, { r: 0.025 });
  for (let r = 0; r < 3; r++) {
    box(3.62, 5.42, 2.76, 0.46, 0.03, '#1a2338', 0.45 + r * 0.45, { r: 0.004 });
    for (let k = 0; k < 6; k++) {
      box(3.72 + k * 0.44, 5.82, 0.34, 0.08, 0.28, k % 2 ? '#4a78c0' : '#3a8f78', 0.15 + r * 0.45, { r: 0.012 });
      box(3.84 + k * 0.44, 5.9, 0.1, 0.01, 0.025, '#e8ecf8', 0.28 + r * 0.45, { r: 0.002, material: glow('#e8ecf8', 0.6) });
    }
  }
  box(5.7, 8.0, 0.6, 0.6, 0.5, '#a97c4a', 0, { r: 0.03 });
  box(5.85, 8.05, 0.5, 0.5, 0.45, '#c09054', 0.5, { r: 0.03, rot: 0.2 });
  box(5.1, 8.2, 0.5, 0.5, 0.4, '#b98450', 0, { r: 0.03, rot: -0.15 });
  for (const [dx, dy, r] of [[0, 0, 0.3], [0.35, 0.05, 0.25], [-0.3, 0.08, 0.22]]) ball(4.2 + dx, 8.3 + dy, r, '#e8ecf8', 1.8, { transparent: true, opacity: 0.8 });

  // ---------------------------------------------------------------- 테스트 랩
  box(6.75, 5.35, 2.9, 0.62, 0.05, '#f0f2ee', 0.82, { r: 0.015, rough: 0.3 });
  box(6.8, 5.4, 2.8, 0.52, 0.8, '#6a7d86', 0, { r: 0.02 });
  const glassMat = std('#dfe9ee', { transparent: true, opacity: 0.55, rough: 0.1 });
  [['#35e0a1', 7.0], ['#f5a524', 7.45], ['#7a8cff', 7.9]].forEach(([c, x]) => {
    cyl(x, 5.7, 0.085, 0.24, '#dfe9ee', 0.87, { material: glassMat });
    cyl(x, 5.7, 0.07, 0.12, c, 0.87, { material: std(c, { emissive: c, ei: 0.5 }) });
    cyl(x, 5.7, 0.035, 0.12, '#dfe9ee', 1.11, { material: glassMat });
  });
  monitor(8.85, 5.7, 0.87, T.cached('lab-screen', () => T.chartScreen(111)), 0.46, 0.3);
  box(8.1, 5.55, 0.4, 0.22, 0.04, '#cfd8d8', 0.87, { r: 0.01 }); // 시험관 꽂이
  for (let k = 0; k < 4; k++) cyl(8.17 + k * 0.09, 5.66, 0.02, 0.2, ['#e8637a', '#f5a524', '#35e0a1', '#7a8cff'][k], 0.9, { seg: 8 });
  box(7.0, 8.0, 1.3, 0.45, 0.78, '#cfd8d8', 0, { r: 0.03, rough: 0.4 }); // 보조 캐비닛
  box(7.0, 7.98, 1.3, 0.04, 0.08, '#7a8cff', 0.78, { r: 0.004 });

  // ---------------------------------------------------------------- 빌드실
  box(10.0, 5.5, 2.8, 0.55, 0.3, '#3a3f4d', 0, { r: 0.03 });
  for (let k = 0; k < 8; k++) {
    const stripe = box(10.05 + k * 0.36, 5.53, 0.14, 0.49, 0.02, '#f5a524', 0.3, { r: 0.003 });
    belts.push({ mesh: stripe, x0: 10.05, len: 2.8 - 0.14, off: k * 0.36 });
  }
  box(10.0, 5.46, 2.8, 0.05, 0.12, '#2a2f3d', 0.3, { r: 0.01 });
  box(10.0, 6.0, 2.8, 0.05, 0.12, '#2a2f3d', 0.3, { r: 0.01 });
  box(11.7, 6.2, 0.5, 0.5, 0.5, '#a97c4a', 0, { r: 0.03, rot: 0.15 });
  box(12.25, 6.25, 0.4, 0.4, 0.4, '#c09054', 0, { r: 0.03, rot: -0.2 });
  const gear = cyl(10.6, 5.35, 0.3, 0.1, '#e8a030', 1.25);
  gear.rotation.x = Math.PI / 2;
  spinners.push(gear);
  for (let k = 0; k < 8; k++) { // 톱니
    const tooth = put(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), std('#e8a030')));
    tooth.position.set(Math.cos((k / 8) * Math.PI * 2) * 0.3, 0, Math.sin((k / 8) * Math.PI * 2) * 0.3);
    gear.add(tooth);
  }
  for (let k = 0; k < 6; k++) box(9.85 + k * 0.5, 8.78, 0.3, 0.12, 0.012, k % 2 ? '#f5a524' : '#2a2f3d', 0, { r: 0.002, rot: -0.6 }); // 바닥 안전선
  box(12.4, 7.6, 0.4, 0.3, 0.9, '#6a7580', 0, { r: 0.03 }); // 제어함
  cyl(12.6, 7.78, 0.04, 0.02, '#e8637a', 0.9, { material: glow('#e8637a', 0.9) });

  // ---------------------------------------------------------------- 형상관리실
  flat(14.6, 5.3, 2.6, 1.3, 1.45, basic(T.cached('git', () => T.gitGraph(121)))).position.z += 0.07;
  box(13.28, 5.25, 2.64, 0.06, 1.34, '#2a2f3d', 0.78, { r: 0.012 });
  box(15.5, 5.7, 0.62, 0.6, 1.25, '#6b7280', 0, { r: 0.035, metal: 0.4 }); // 금고
  cyl(15.81, 6.0, 0.14, 0.04, '#c9ccd4', 0.75, { material: std('#c9ccd4', { metal: 0.8, rough: 0.3 }) }).rotation.x = Math.PI / 2;
  box(13.4, 8.0, 0.5, 0.45, 0.85, '#7e8794', 0, { r: 0.02, metal: 0.3 }); // 서랍장
  for (let k = 0; k < 3; k++) box(13.43, 8.43, 0.44, 0.02, 0.2, '#9aa3b0', 0.08 + k * 0.27, { r: 0.006 });
  box(14.1, 8.1, 0.45, 0.35, 0.28, '#d9c7a3', 0, { r: 0.02 }); // 서류 상자

  // ---------------------------------------------------------------- 브리핑룸
  flat(18.2, 5.35, 2.4, 1.2, 1.4, basic(T.cached('brief', () => T.chartScreen(131))));
  box(16.95, 5.28, 2.5, 0.05, 1.3, '#20242f', 0.75, { r: 0.012 });
  box(17.75, 6.05, 0.75, 0.5, 1.0, '#6a4a2f', 0, { r: 0.03 }); // 연단
  box(17.82, 6.12, 0.6, 0.3, 0.05, '#2a2f3d', 1.0, { r: 0.01 });
  cyl(17.95, 6.3, 0.035, 0.2, '#c9ccd4', 1.0, { seg: 8 });
  plant(19.4, 8.1, 1);
  plant(16.3, 8.1, 0);

  // ---------------------------------------------------------------- 응답 대기실(초록 불빛의 조용한 구석)
  for (let i = 0; i < 5; i++) {
    const bx = 1.2 + 1.3 * i;
    box(bx - 0.55, 11.2, 1.1, 0.5, 0.32, '#3d7a5c', 0, { r: 0.06 });
    box(bx - 0.55, 11.1, 1.1, 0.14, 0.7, '#346a50', 0, { r: 0.05 });
    box(bx - 0.2, 11.28, 0.38, 0.3, 0.1, ['#e8d7b0', '#d9a441', '#c9704f', '#e8d7b0', '#8fb2a0'][i], 0.32, { r: 0.05, rot: (i - 2) * 0.1 });
  }
  box(0.3, 9.56, 7.4, 0.05, 0.03, GREEN, 0, { material: glow(GREEN, 1.0), r: 0.005 });
  box(7.0, 12.25, 0.5, 0.5, 0.42, '#d9c7a3', 0, { r: 0.04 });
  mug(7.2, 12.45, 0.42, '#8fb2a0');
  plant(0.4, 9.9, 1);
  plant(6.6, 9.8, 0);

  // ---------------------------------------------------------------- 휴게실
  box(9.0, 12.0, 5.6, 0.95, 0.42, '#c2764f', 0, { r: 0.08 }); // 소파: 테라코타색
  box(9.0, 12.0, 5.6, 0.26, 0.95, '#b06844', 0, { r: 0.07 });
  box(9.0, 12.0, 0.28, 0.95, 0.68, '#b06844', 0, { r: 0.07 });
  box(14.32, 12.0, 0.28, 0.95, 0.68, '#b06844', 0, { r: 0.07 });
  for (let k = 0; k < 5; k++) box(9.45 + k * 1.05, 12.28, 0.86, 0.6, 0.12, k % 2 ? '#c2764f' : '#d8a25c', 0.42, { r: 0.05 });
  for (const [x, c, rot] of [[9.45, '#e8d7b0', 0.2], [13.9, '#6f8f6a', -0.2]]) box(x, 12.3, 0.34, 0.12, 0.34, c, 0.45, { r: 0.07, rot });
  cyl(11.2, 11.15, 0.9, 0.012, '#d9c7a3', 0, { seg: 40 }); // 러그
  cyl(11.2, 11.15, 0.7, 0.014, '#8f6f5a', 0, { seg: 40 });
  box(10.4, 10.85, 1.6, 0.7, 0.04, '#e4d3b0', 0.34, { r: 0.015 });
  for (const [x, y] of [[10.5, 10.95], [11.8, 10.95], [10.5, 11.4], [11.8, 11.4]]) cyl(x + 0.05, y + 0.05, 0.03, 0.34, '#6d5a42', 0);
  box(10.6, 10.95, 0.42, 0.3, 0.04, '#c4553f', 0.38, { r: 0.008, rot: 0.15 });
  box(10.68, 11.0, 0.42, 0.3, 0.04, '#4f7f9c', 0.42, { r: 0.008, rot: -0.1 });
  mug(11.5, 11.15, 0.38, '#e8e2d4');
  // 카페 카운터: 커피머신, 컵, 스툴
  box(9.0, 9.55, 3.0, 0.62, 0.92, '#5a4636', 0, { r: 0.03 });
  box(8.95, 9.5, 3.1, 0.72, 0.05, '#d9c7a3', 0.92, { r: 0.015, rough: 0.5 });
  box(9.3, 9.62, 0.5, 0.4, 0.42, '#2d3340', 0.97, { r: 0.04 });
  box(9.36, 9.7, 0.38, 0.04, 0.1, '#161a24', 1.15, { r: 0.006 });
  cyl(9.55, 9.95, 0.018, 0.14, '#e8637a', 0.97, { material: glow('#e8637a', 1.0) });
  for (const x of [10.5, 10.8, 11.1]) mug(x, 9.9, 0.97, '#f4efe2');
  for (const x of [9.5, 10.5, 11.5]) { cyl(x, 10.35, 0.15, 0.04, '#8f6f5a', 0.58); cyl(x, 10.35, 0.025, 0.58, '#3a3f4d', 0); }
  box(12.2, 9.55, 0.62, 0.55, 1.45, '#d9dde0', 0, { r: 0.04, metal: 0.2 }); // 냉장고
  box(12.78, 9.6, 0.03, 0.04, 0.4, '#8b93a8', 0.7, { r: 0.006 });
  box(12.95, 9.5, 0.7, 0.6, 1.5, '#c4553f', 0, { r: 0.04 }); // 자판기
  box(13.05, 9.64, 0.38, 0.02, 0.7, '#161a24', 0.55, { r: 0.006, material: glow('#7fb6ff', 0.5) });
  for (let r = 0; r < 4; r++) box(13.1, 9.64, 0.28, 0.02, 0.05, ['#f5a524', '#35e0a1', '#e8637a', '#8fb2ff'][r], 0.6 + r * 0.15, { r: 0.004 });
  // 침대(꺼진 세션): 담요와 베개
  for (let i = 0; i < TEAM_COUNT; i++) {
    const bx = 15.1 + 0.9 * i;
    box(bx - 0.4, 11.25, 0.8, 1.55, 0.16, '#4a3d33', 0, { r: 0.04 });
    box(bx - 0.37, 11.3, 0.74, 1.45, 0.14, ['#a7b8d8', '#cdb7a3', '#9fc0b4', '#d6b4b4', '#b9b2d8', '#c7cf9f'][i], 0.16, { r: 0.05 });
    box(bx - 0.3, 11.35, 0.6, 0.3, 0.1, '#f4efe2', 0.3, { r: 0.06 });
    box(bx - 0.37, 11.95, 0.74, 0.8, 0.03, ['#6a7fa8', '#a98a6a', '#6f9a88', '#b27a7a', '#8a82b8', '#97a56a'][i], 0.3, { r: 0.015 });
  }
  box(19.55, 9.9, 0.3, 0.3, 0.55, '#6d5a42', 0, { r: 0.02 });
  cyl(19.7, 10.05, 0.13, 0.2, '#ffd9a0', 0.58, { r2: 0.08, material: std('#ffd9a0', { emissive: '#ffd28a', ei: 0.9 }) });
  plant(8.3, 9.75, 1);
  plant(14.5, 9.75, 0);
  plant(19.2, 12.3, 1);

  // ---------------------------------------------------------------- 방 이름: 화면 위에 띄우지 않고 사무실 안에 그린다
  // 윗줄 방은 뒷벽의 작은 명판, 나머지는 바닥에 칠한 글씨(아바타·가구에 가려질 뿐 화면을 가리지 않는다)
  const textTex = (text, { fg, halo = null }) => { // 글자 폭에 맞춘 캔버스: { tex, aspect }
    const c = document.createElement('canvas');
    const g0 = c.getContext('2d');
    const font = '800 64px "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif';
    g0.font = font;
    const w = Math.ceil(g0.measureText(text).width) + 48;
    const h = 96;
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (halo) { g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = halo; g.strokeText(text, w / 2, h / 2 + 3); }
    g.fillStyle = fg;
    g.fillText(text, w / 2, h / 2 + 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { tex: t, aspect: w / h };
  };
  const FLOOR_LABEL_AT = { // 바닥 글씨 위치(복도 쪽이나 가구 없는 자리)
    server: [2.3, 8.35], data: [4.6, 7.4], lab: [8.2, 7.4], build: [11.4, 7.4], git: [15.0, 8.35], briefing: [18.2, 8.35],
    response: [2.6, 10.2], lounge: [16.6, 10.4],
  };
  for (const id of Object.keys(ROOMS)) {
    const r = ROOMS[id];
    const text = ROOM_NAMES[id];
    if (r.y === 0) { // 뒷벽 명판(벽에 붙은 놋쇠 문패)
      const { tex, aspect } = textTex(text, { fg: '#3a3328' });
      const ph = 0.36;
      const pw = ph * aspect + 0.1;
      const cx = wx(r.x + r.w / 2);
      const plate = put(new THREE.Mesh(new THREE.BoxGeometry(pw, ph + 0.06, 0.04), std('#efe8d8')), false);
      plate.position.set(cx, WALL_H - 0.3, wz(0.12));
      scene.add(plate);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(ph * aspect, ph), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      face.position.set(cx, WALL_H - 0.3, wz(0.142));
      scene.add(face);
      const rail = put(new THREE.Mesh(new THREE.BoxGeometry(pw + 0.04, 0.03, 0.05), std(BRASS, { metal: 0.6, rough: 0.4 })), false);
      rail.position.set(cx, WALL_H - 0.3 - (ph + 0.06) / 2 - 0.02, wz(0.12));
      scene.add(rail);
      continue;
    }
    const [x, y] = FLOOR_LABEL_AT[id];
    const green = id === 'response';
    const { tex, aspect } = textTex(text, { fg: green ? 'rgba(220,255,232,0.92)' : 'rgba(255,248,230,0.9)', halo: 'rgba(20,16,10,0.55)' });
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62 * aspect, 0.62),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.rotation.order = 'YXZ';
    decal.rotation.set(-Math.PI / 2, Math.PI / 4, 0); // 글씨 줄이 화면 가로 방향이 되게 눕힌다
    decal.position.set(wx(x), 0.03, wz(y));
    scene.add(decal);
  }

  // 움직이거나 색이 바뀌는 것(LED·컨베이어·톱니·팀 명패)만 빼고, 같은 재료의 정적 물체는 하나로 합쳐 그린다(그리기 호출 수천 → 백여 개)
  const keep = new Set([...leds.map((l) => l.led), ...belts.map((b) => b.mesh), ...spinners, ...deskAccents]);
  scene.updateMatrixWorld(true);
  const groups = new Map();
  const merged = [];
  const visit = (obj) => {
    if (keep.has(obj)) return;
    if (obj.isMesh && !Array.isArray(obj.material)) {
      const key = `${obj.material.uuid}|${obj.castShadow ? 1 : 0}`;
      const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      geo.applyMatrix4(obj.matrixWorld);
      if (!groups.has(key)) groups.set(key, { material: obj.material, cast: obj.castShadow, geos: [] });
      groups.get(key).geos.push(geo);
      merged.push(obj);
      return;
    }
    for (const c of obj.children) visit(c);
  };
  for (const c of [...scene.children]) if (!existing.has(c)) visit(c);
  for (const obj of merged) { obj.parent?.remove(obj); obj.geometry.dispose(); }
  for (const { material, cast, geos } of groups.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    scene.add(mesh);
    for (const g of geos) g.dispose();
  }

  return { leds, spinners, belts, deskAccents };
}

// 방별 은은한 조명: 따뜻한 전구색을 기본으로, 기계가 있는 방만 차가운 빛
export const LAMPS = [
  ['#7f8dff', 1.6, 7.2, 12], ['#ffcf94', 9.5, 2.0, 12], ['#ffe1b8', 3.5, 2.0, 8], ['#d6f1ff', 9.5, 7.1, 9], ['#ffb870', 4.0, 11.3, 9], ['#ffb870', 14.0, 11.5, 12], ['#ffc49a', 17.8, 6.0, 9],
];
