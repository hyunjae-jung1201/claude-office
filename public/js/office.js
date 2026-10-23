// 사무실 건물: 바닥 마감, 벽, 방 13개의 가구와 소품, 방 이름판. 좌표는 layout.js 의 타일 좌표(왼쪽 위 모서리 + 크기)를 쓴다.
// 방향: "퇴근 시간 무렵의 작은 회사" — 따뜻한 조명, 나무·카펫·콘크리트 같은 실제 마감재, 책상 위 잡동사니와 낙서.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOOR, ROOMS, ROOM_NAMES, TEAM_COUNT, DOOR_W, DOOR_LINES, deskZone } from './layout.js';
import * as T from './textures.js';
import { dayState } from './daylight.js';

export const wx = (x) => x - FLOOR.w / 2;
export const wz = (y) => y - FLOOR.d / 2;

const WALL_H = 2.6;
const GREEN = '#2fbf71'; // 사용자의 응답이 필요하다는 표시색
const BRASS = '#b79a62';
// 방마다 고유한 테마색: 문턱 띠·벽 위 네온 띠·이름표 점에 쓴다(한눈에 어느 구역인지)
export const ROOM_THEME = { library: '#c98f4a', research: '#4c8dff', work: '#13a58a', docs: '#d9b35a', planning: '#ff7ab0', server: '#6a7cff', data: '#e8b44a', lab: '#35e0a1', build: '#ff8a3a', git: '#a56bff', briefing: '#4fc3ff', response: '#2fbf71', lounge: '#e8863a' };
const BOOKS = ['#c4553f', '#d9a441', '#4f7f9c', '#6f8f6a', '#8a5f8f', '#b9744f', '#3f5a7a', '#a86a5a'];
const NOTES = ['#ffd166', '#ff8fa3', '#8fd3ff', '#b8f2a8', '#ffb86b'];

export function buildOffice(scene) {
  const existing = new Set(scene.children); // 조명처럼 이미 있던 것은 건드리지 않는다
  const leds = [];
  const spinners = [];
  const belts = [];
  const deskAccents = [];
  const dynamic = []; // 시간·활동에 따라 색이 바뀌는 것(합치지 않는다)

  // ---------------------------------------------------------------- 재료·도형 도우미
  const matCache = new Map();
  // 실제 가구·마감재는 채도가 낮다: 발광·텍스처가 아닌 색은 채도를 줄이고 아주 조금 어둡게
  const tone = (color) => {
    if (typeof color !== 'string' || !color.startsWith('#') || color.toLowerCase() === '#ffffff') return color;
    const c = new THREE.Color(color);
    const hsl = {};
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s * 0.72, hsl.l * 0.96);
    return `#${c.getHexString()}`;
  };
  const std = (color, o = {}) => {
    if (!o.emissive && !o.map) color = tone(color);
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
    const rad = Math.min(r * 0.55, w / 2.2, h / 2.2, d / 2.2); // 장난감 같은 둥근 모서리를 줄인다
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
    const scr = flat(cx, cy + 0.0, w, h, elev + 0.12 + (h + 0.04) / 2, basic(tex), 0);
    scr.position.z += 0.025;
    return scr;
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
    research: () => T.cached('f-carpet-blue', () => T.carpet('#3f6ea6', 32)),
    work: () => T.cached('f-wood-work', () => T.planks('#b99565', 33)),
    docs: () => T.cached('f-wood-docs', () => T.planks('#d2b98e', 34)),
    planning: () => T.cached('f-carpet-warm', () => T.carpet('#c9774f', 35)),
    server: () => T.cached('f-raised', () => T.raisedFloor('#8d94a8')),
    data: () => T.cached('f-concrete-a', () => T.concrete('#6a6e78', 36)),
    lab: () => T.cached('f-tiles', () => T.tiles('#dfe5e1', '#9aa8a2')),
    build: () => T.cached('f-concrete-b', () => T.concrete('#58544e', 37)),
    git: () => T.cached('f-carpet-grey', () => T.carpet('#5d5086', 38)),
    briefing: () => T.cached('f-carpet-dark', () => T.carpet('#27345f', 39)),
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
    const edge = glow(ROOM_THEME[id] ?? BRASS, id === 'response' ? 0.9 : 0.55);
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

  const sky = T.skyPainter(61);
  sky.paint(dayState(18.3));
  const duskTex = sky.texture;
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
  // 리서치실: 둥근 토론 탁자 2개(탁자마다 노트북 셋), 마인드맵 화이트보드, 자료 더미 — 책상 줄이 아니라 둘러앉아 토론하는 곳
  const screens = [T.codeScreen(81, '#7fb6ff'), T.chartScreen(82), T.codeScreen(83, '#f5a524')];
  const laptop = (x, y, elev, yaw, tex) => { // 사용자는 yaw 방향을 본다: 화면은 먼 쪽에서 사용자를 향한다
    const g = new THREE.Group();
    g.position.set(wx(x), elev, wz(y));
    g.rotation.y = yaw;
    const base = put(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.014, 0.21), std('#2d3340')));
    const lid = put(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.012), std('#20242f')));
    lid.position.set(0, 0.1, 0.1);
    lid.rotation.x = -0.25;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.17), basic(tex));
    face.position.set(0, 0.1, 0.092);
    face.rotation.set(-0.25, Math.PI, 0);
    g.add(base, lid, face);
    scene.add(g);
  };
  const roundTable = (cx, cy, r, color = '#e8edf5') => {
    cyl(cx, cy, r, 0.04, color, 0.72, { seg: 36 });
    cyl(cx, cy, 0.05, 0.72, '#8b93a8', 0, { seg: 10 });
    cyl(cx, cy, 0.26, 0.03, '#6d7488', 0, { seg: 20 });
  };
  const resTables = [[4.37, 1.45, [0, 1, 2]], [5.6, 2.45, [3, 4, 5]]];
  const resSeats = [[-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2], [0, 1, Math.PI]]; // [dx, dy, 바라보는 방향]
  resTables.forEach(([cx, cy, ids], t) => {
    roundTable(cx, cy, 0.52);
    resSeats.forEach(([dx, dy, yaw], k) => {
      laptop(cx + dx * 0.27, cy + dy * 0.27, 0.74, yaw, screens[(t + k) % 3]);
      chair(cx + dx * 0.65, cy + dy * 0.65, ['#4f6a8f', '#6a8a6a', '#8f6a5a'][k], yaw - Math.PI);
      box(cx + dx * 0.4 - 0.08 + dy * 0.2, cy + dy * 0.4 - 0.08 - dx * 0.2, 0.16, 0.2, 0.012, k % 2 ? '#fff9e8' : '#d6e4f7', 0.745, { r: 0.002, rot: 0.3 * (k - 1) });
    });
    mug(cx, cy, 0.74, ['#d9553f', '#4f7f9c'][t]);
  });
  // 마인드맵 화이트보드(바퀴 달린 스탠드)
  {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#f6f8fb'; g.fillRect(0, 0, 256, 160);
    g.lineWidth = 3;
    const node = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    for (const [x, y, col] of [[60, 40, '#4c8dff'], [190, 36, '#f5a524'], [52, 116, '#13a58a'], [200, 118, '#e8637a']]) { g.strokeStyle = '#8b93a8'; g.beginPath(); g.moveTo(128, 80); g.lineTo(x, y); g.stroke(); node(x, y, 18, col); }
    node(128, 80, 26, '#232838');
    g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.fillText('WHY?', 128, 86);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    box(3.75, 0.32, 1.35, 0.05, 0.9, '#cfd4de', 0.62, { r: 0.012, metal: 0.3 });
    flat(4.42, 0.385, 1.25, 0.78, 1.07, new THREE.MeshBasicMaterial({ map: tex }), 0); // 뒤판(y 0.32~0.37)보다 앞면 바깥에 둔다
    for (const x of [3.82, 5.0]) { box(x, 0.28, 0.06, 0.2, 0.62, '#8b93a8', 0, { r: 0.01, metal: 0.4 }); cyl(x + 0.03, 0.3, 0.035, 0.04, '#2a2f3d', 0); }
  }

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
    const chairColors = ['#3f5a7a', '#5a6a4a', '#7a4f4f', '#4a4f6a', '#6a5a3f', '#4f6a6a'];
    chair(z.x + 0.58, 1.55, chairColors[i], (i % 3 - 1) * 0.12); // 팀장 의자: 책상 바로 앞
  }

  // ---------------------------------------------------------------- 문서실
  // 긴 공동 작업 탁자 하나(양쪽에 세 명씩), 가운데 줄지은 초록 램프, 종이 더미·바인더, 한쪽 벽의 복합기 코너 — 서로 마주 보고 문서를 함께 만든다
  box(13.95, 1.3, 2.7, 0.9, 0.05, '#c4a87a', 0.72, { r: 0.015 });
  for (const [x, y] of [[14.05, 1.38], [16.5, 1.38], [14.05, 2.1], [16.5, 2.1]]) box(x, y, 0.07, 0.07, 0.72, '#6d5a42', 0, { r: 0.01 });
  for (const x of [14.55, 15.3, 16.05]) { // 램프(초록 갓) 줄
    cyl(x, 1.75, 0.06, 0.02, '#2a2f3d', 0.77);
    cyl(x, 1.75, 0.012, 0.28, '#3a3f4d', 0.79);
    box(x - 0.12, 1.63, 0.24, 0.1, 0.1, '#2f6b4f', 1.06, { r: 0.02, material: std('#2f6b4f', { emissive: '#ffd98a', ei: 0.5 }) });
  }
  for (const [x, y, rot] of [[14.4, 1.38, 0.1], [15.15, 1.4, -0.08], [15.9, 1.38, 0.15], [14.45, 1.98, -0.1], [15.2, 1.96, 0.06], [15.95, 1.98, -0.12]]) { // 자리마다 종이 더미
    box(x, y, 0.3, 0.38, 0.012, '#ffffff', 0.77, { r: 0.002, rot });
    box(x + 0.03, y + 0.02, 0.28, 0.36, 0.012, '#f7f2e2', 0.784, { r: 0.002, rot: rot * -0.6 });
  }
  box(16.2, 1.5, 0.22, 0.3, 0.05, '#7a4f2e', 0.77, { r: 0.012 }); // 두꺼운 바인더
  box(16.24, 1.9, 0.2, 0.2, 0.05, '#3f5a7a', 0.77, { r: 0.012, rot: 0.3 });
  mug(14.2, 1.75, 0.77, '#e8e2d4');
  [14.45, 15.2, 15.95].forEach((x, k) => {
    chair(x, 0.95, ['#8f6a5a', '#6a8a8f', '#8a7a5a'][k], -Math.PI); // 윗줄: 남쪽(탁자)을 본다
    chair(x, 2.6, ['#8a7a5a', '#8f6a5a', '#6a8a8f'][k], 0);
  });
  // 복합기 코너: 대형 복합기, 종이 트레이 더미, 서류함
  box(14.4, 3.25, 1.3, 0.55, 0.9, '#d9dde0', 0, { r: 0.03 });
  box(14.45, 3.3, 1.2, 0.45, 0.05, '#2d3340', 0.9, { r: 0.01 });
  box(14.6, 3.38, 0.35, 0.3, 0.06, '#f4efe2', 0.95, { r: 0.004 });
  box(15.2, 3.5, 0.4, 0.04, 0.12, '#1b2a48', 0.9, { r: 0.004, material: glow('#7fb6ff', 0.55) }); // 조작 화면
  for (let k = 0; k < 4; k++) box(15.85 + k * 0.01, 3.5, 0.4, 0.3, 0.02, k % 2 ? '#fff9e8' : '#ffffff', k * 0.02, { r: 0.002, rot: k * 0.05 }); // 복합기 옆 바닥에 쌓인 종이(복합기 몸통 바깥)
  box(13.62, 3.0, 0.5, 0.35, 0.34, '#c9a56a', 0, { r: 0.015 }); // 종이 상자
  box(13.66, 3.04, 0.42, 0.27, 0.05, '#f4efe2', 0.34, { r: 0.004 });
  box(16.4, 3.1, 0.4, 0.45, 0.95, '#8a93a0', 0, { r: 0.02, metal: 0.3 }); // 서류함
  for (let k = 0; k < 3; k++) box(16.45, 3.55, 0.3, 0.02, 0.2, '#9aa3b0', 0.07 + k * 0.3, { r: 0.006 });

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
    box(0.1, y0, 0.95, 1.05, 1.85, '#4d586f', 0, { r: 0.03 }); // 랙 몸체(밝은 강철색)
    box(0.95, y0 + 0.05, 0.05, 0.95, 1.75, '#6b7792', 0.05, { r: 0.01 }); // 앞문
    box(0.99, y0 + 0.03, 0.02, 0.99, 0.05, '#e8b44a', 0.02, { r: 0.002 }); // 바닥 경고띠
    box(0.99, y0 + 0.2, 0.025, 0.6, 0.03, '#35e0a1', 1.8, { r: 0.002, material: glow('#35e0a1', 0.9) }); // 랙 상단 상태 표시줄
    for (let j = 0; j < 6; j++) {
      const on = (j + Math.round(y0)) % 3 ? '#35e0a1' : '#7a8cff';
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: on }));
      led.position.set(wx(1.01), 0.3 + j * 0.27, wz(y0 + 0.22));
      scene.add(led);
      leds.push({ led, phase: j * 0.7 + y0 });
      box(1.0, y0 + 0.36, 0.03, 0.55, 0.06, '#2f394f', 0.27 + j * 0.27, { r: 0.004 });
      for (let k = 0; k < 4; k++) box(1.03, y0 + 0.4 + k * 0.13, 0.012, 0.02, 0.04, (j + k) % 2 ? '#7fb6ff' : '#9aa6bd', 0.275 + j * 0.27, { r: 0.002, material: (j + k) % 2 ? glow('#7fb6ff', 0.8) : undefined });
    }
    for (let k = 0; k < 3; k++) cyl(0.2, y0 + 0.2 + k * 0.3, 0.018, 1.0, ['#e8b44a', '#4c8dff', '#e8637a'][k], 1.85, { seg: 6 }).rotation.x = 0.1; // 늘어진 케이블
  }
  // 랙 위 케이블 트레이와 바닥 찬 통로 표시(랙 줄이 한눈에 보이게)
  box(0.12, 5.5, 0.4, 3.45, 0.035, '#aab3c6', 1.92, { r: 0.006, metal: 0.4 });
  for (let y = 5.6; y < 8.9; y += 0.4) box(0.12, y, 0.4, 0.03, 0.03, '#8b93a8', 1.945, { r: 0.002 });
  box(1.52, 5.5, 0.05, 3.45, 0.012, '#5aa9ff', 0, { r: 0.002, material: glow('#5aa9ff', 0.8) });
  // 랙 앞 서비스 선반(허리 높이): 서서 노트북으로 콘솔 작업을 한다
  box(1.08, 5.7, 0.36, 3.1, 0.04, '#aeb4bf', 0.84, { r: 0.01, metal: 0.4 });
  for (const y of [5.75, 7.15, 8.7]) box(1.12, y, 0.05, 0.05, 0.84, '#8b93a8', 0, { r: 0.008, metal: 0.4 });
  for (const y of [6.15, 7.0, 7.85]) { box(1.14, y, 0.28, 0.2, 0.016, '#2d3340', 0.88, { r: 0.004 }); box(1.14, y - 0.1, 0.012, 0.2, 0.17, '#3a4054', 0.89, { r: 0.002 }); }
  box(2.2, 5.45, 0.9, 0.8, 1.5, '#d9d9d2', 0, { r: 0.04 }); // 항온기
  cyl(2.65, 5.52, 0.3, 0.03, '#2a2f3d', 0.9).rotation.x = Math.PI / 2;
  box(2.35, 5.5, 0.6, 0.02, 0.12, '#2a2f3d', 1.25, { r: 0.004 });
  box(1.1, 8.4, 0.9, 0.4, 0.3, '#2f3547', 0, { r: 0.04 }); // UPS
  box(1.25, 8.58, 0.25, 0.02, 0.08, '#35e0a1', 0.15, { r: 0.002, material: glow('#35e0a1', 1.0) });

  // 서버실 장식: 관제 데스크(모니터 2대), 패치 패널과 케이블, 경광등, 비상 정지 버튼, 소화기, 문턱 안전 띠
  box(2.0, 7.75, 1.15, 0.6, 0.04, '#d6dbe6', 0.7, { r: 0.012 }); // 관제 데스크
  for (const lx of [2.04, 3.05]) box(lx, 7.8, 0.04, 0.5, 0.7, '#8b93a8', 0, { r: 0.008, metal: 0.4 });
  monitor(2.28, 7.98, 0.74, T.cached('noc-chart', () => T.chartScreen(91)), 0.5, 0.3);
  monitor(2.86, 7.98, 0.74, T.cached('noc-code', () => T.codeScreen(92, '#7fe0c8')), 0.5, 0.3);
  keyboard(2.35, 8.18, 0.74);
  mug(3.0, 8.2, 0.74, '#e8b44a');
  chair(2.62, 8.75, '#4a4f6a', 0.15);
  for (const y0 of [5.5, 6.7, 7.9]) { // 랙 앞문 패치 패널(포트 줄)과 파란·노란 랜선
    box(0.98, y0 + 0.12, 0.025, 0.8, 0.07, '#232838', 1.55, { r: 0.004 });
    for (let k = 0; k < 8; k++) box(1.0, y0 + 0.16 + k * 0.09, 0.012, 0.05, 0.035, '#0d1226', 1.565, { r: 0.002 });
    for (const [k, c] of [[1, '#4c8dff'], [3, '#e8b44a'], [5, '#4c8dff'], [6, '#e8637a']]) cyl(1.02, y0 + 0.18 + k * 0.09, 0.008, 0.12, c, 1.43, { seg: 5 });
  }
  for (const y of [6.55, 7.75]) cyl(1.0, y, 0.014, 0.1, '#4c8dff', 1.45, { seg: 6 }).rotation.x = Math.PI / 2; // 랙 사이를 잇는 케이블
  // 경광등(가운데 랙 위): 초록이 켜져 있고 노랑·빨강은 꺼져 있다
  cyl(0.55, 7.15, 0.07, 0.05, '#3a4054', 1.92);
  for (const [i, c] of [['0', '#35e0a1'], ['1', '#e8b44a'], ['2', '#e5484d']].map(([i, c]) => [Number(i), c])) cyl(0.55, 7.15, 0.06, 0.06, i === 0 ? c : '#4a3a3a', 1.97 + i * 0.065, { material: i === 0 ? glow(c, 1.0) : std('#5a4646') });
  // 비상 정지(EPO) 박스와 소화기: 항온기 옆 벽쪽
  box(3.12, 5.45, 0.18, 0.06, 0.22, '#f2c230', 1.0, { r: 0.01 });
  cyl(3.21, 5.52, 0.055, 0.02, '#e5484d', 1.07, { seg: 16 }).rotation.x = Math.PI / 2;
  cyl(3.1, 6.5, 0.075, 0.46, '#c4382f', 0.0, { r2: 0.07 });
  cyl(3.1, 6.5, 0.03, 0.08, '#2a2f3d', 0.46);
  // 문 앞 안전 띠(노랑·검정)
  for (let k = 0; k < 6; k++) box(0.45 + k * 0.17, 5.28, 0.1, 0.1, 0.012, k % 2 ? '#2a2f3d' : '#f2c230', 0.01, { r: 0.002, rot: -0.5 });

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
  const labScreen = monitor(8.85, 5.7, 0.87, T.cached('lab-screen', () => T.chartScreen(111)), 0.46, 0.3);
  dynamic.push(labScreen);
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
  const briefScreen = flat(18.2, 5.35, 2.4, 1.2, 1.4, basic(T.cached('brief', () => T.chartScreen(131))));
  dynamic.push(briefScreen);
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
  const responseLine = box(0.3, 9.56, 7.4, 0.05, 0.03, GREEN, 0, { material: glow(GREEN, 1.0), r: 0.005 });
  dynamic.push(responseLine);
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
  plant(15.0, 9.7, 0);
  plant(19.2, 12.3, 1);

  // ---------------------------------------------------------------- 생활 소품: 출입구 안전 설비와 쓰레기통(몇 개만, 현실적인 자리에)
  const bin = (x, y, color = '#5d6573') => { // 사무실 쓰레기통: 살짝 벌어진 원통 + 비닐 가장자리
    cyl(x, y, 0.11, 0.32, color, 0, { r2: 0.13 });
    cyl(x, y, 0.13, 0.012, '#2a2f3d', 0.31);
  };
  bin(6.85, 3.7);
  bin(13.35, 3.7);
  bin(13.85, 9.8, '#4f7f6a'); // 휴게실: 재활용함은 초록
  // 출입문: 비상구 표지(문틀 위)와 소화기, 우산꽂이
  box(20.03, 4.3, 0.1, 0.7, 0.17, '#1f7a4d', 2.06, { r: 0.015, material: std('#1f7a4d', { emissive: '#2fbf71', ei: 0.6 }) });
  box(19.2, 5.0, 0.2, 0.2, 0.02, '#8a8f9a', 0, { r: 0.004 }); // 소화기 받침
  cyl(19.3, 5.1, 0.075, 0.46, '#c4382f', 0.02, { r2: 0.07 });
  cyl(19.3, 5.1, 0.03, 0.08, '#2a2f3d', 0.48);
  box(19.34, 5.07, 0.12, 0.02, 0.02, '#2a2f3d', 0.5, { r: 0.004 }); // 손잡이
  cyl(19.75, 5.0, 0.1, 0.4, '#3f4a5c', 0, { r2: 0.09 }); // 우산꽂이
  cyl(19.74, 5.0, 0.012, 0.3, '#2a2f3d', 0.38);
  cyl(19.78, 4.98, 0.012, 0.26, '#7a3a3a', 0.38);

  // ---------------------------------------------------------------- 휴게실 놀이 코너(커피 말고 할 거리): 오락기 · 다트 · 잡지 선반 (아바타가 가끔 와서 논다)
  // 칸막이 벽(y 9.4)의 아래쪽 면을 따라 놓는다. 노는 자리는 scene.js 의 LOUNGE_ACTIVITIES.
  box(13.75, 9.56, 0.66, 0.62, 1.62, '#3a55b0', 0, { r: 0.04 }); // 오락기 몸통
  box(14.4, 9.72, 0.025, 0.3, 1.0, '#ff5fa2', 0.3, { r: 0.004, material: glow('#ff5fa2', 0.35) }); // 옆면 장식 띠
  box(14.4, 10.04, 0.025, 0.1, 1.0, '#7fe0ff', 0.3, { r: 0.004, material: glow('#7fe0ff', 0.35) });
  box(13.7, 9.6, 0.76, 0.56, 0.1, '#1a2342', 1.58, { r: 0.02 }); // 윗부분 간판 틀
  box(13.8, 10.14, 0.56, 0.03, 0.1, '#ff5fa2', 1.6, { r: 0.004, material: glow('#ff5fa2', 1.0) }); // 간판 불빛
  box(13.82, 10.14, 0.52, 0.025, 0.44, '#0d1226', 0.92, { r: 0.006 }); // 화면 베젤
  box(13.86, 10.15, 0.44, 0.02, 0.36, '#7fe0ff', 0.96, { r: 0.004, material: glow('#7fe0ff', 0.9) }); // 화면
  box(13.78, 10.02, 0.62, 0.22, 0.07, '#1a1d2a', 0.8, { r: 0.012 }); // 조작판
  cyl(13.95, 10.12, 0.018, 0.1, '#e5484d', 0.87); // 조이스틱
  ball(13.95, 10.12, 0.035, '#e5484d', 0.98);
  for (const [x, c] of [[14.15, '#f5a524'], [14.25, '#35e0a1']]) cyl(x, 10.11, 0.026, 0.02, c, 0.87, { material: glow(c, 0.7) });
  // 다트판(칸막이 벽 아래쪽 면에 건다)
  const dartTex = T.cached('dartboard', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rings = [['#1d1f26', '#e8dcc0', 124], ['#c4382f', '#2f8f5a', 100], ['#1d1f26', '#e8dcc0', 92], ['#c4382f', '#2f8f5a', 62], ['#1d1f26', '#e8dcc0', 54]];
    g.fillStyle = '#14161c';
    g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    for (const [a, b, r] of rings) {
      for (let k = 0; k < 20; k++) {
        g.fillStyle = k % 2 ? a : b;
        g.beginPath(); g.moveTo(128, 128); g.arc(128, 128, r, (k / 20) * Math.PI * 2, ((k + 1) / 20) * Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = '#2f8f5a'; g.beginPath(); g.arc(128, 128, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c4382f'; g.beginPath(); g.arc(128, 128, 6, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  const dartFrame = put(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 28), std('#3a2a1c')), false);
  dartFrame.rotation.x = Math.PI / 2;
  dartFrame.position.set(wx(18.0), 1.0, wz(9.6));
  const dartFace = new THREE.Mesh(new THREE.CircleGeometry(0.31, 32), basic(dartTex));
  dartFace.position.set(wx(18.0), 1.0, wz(9.63));
  scene.add(dartFrame, dartFace);
  for (const [dx, dy] of [[0.04, 0.03], [-0.09, 0.08], [0.12, -0.07]]) { // 꽂혀 있는 다트
    const d = put(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 6), std('#c9ccd4')), false);
    d.rotation.x = Math.PI / 2;
    d.position.set(wx(18.0) + dx, 1.0 + dy, wz(9.7));
    scene.add(d);
  }
  box(17.5, 9.5, 0.9, 0.08, 0.04, '#7a5a3a', 0.52, { r: 0.006 }); // 다트판 아래 작은 선반(다트 놓는 곳)
  // 잡지 선반
  box(18.7, 9.56, 0.74, 0.34, 0.9, '#8a6a46', 0, { r: 0.02 });
  box(18.76, 9.9, 0.62, 0.05, 0.04, '#6d5a42', 0.34, { r: 0.004 });
  [['#c4553f', 0], ['#4f7f9c', 0.14], ['#d9a441', 0.28], ['#6f8f6a', 0.42]].forEach(([c, dx], k) => box(18.78 + dx, 9.74, 0.12, 0.03, 0.2, c, 0.62 + (k % 2) * 0.02, { r: 0.002, rot: (k - 1.5) * 0.06 }));
  [['#e8d7b0', 0], ['#8f6f9c', 0.2], ['#4c8dff', 0.4]].forEach(([c, dx]) => box(18.78 + dx, 9.74, 0.14, 0.03, 0.2, c, 0.2, { r: 0.002 }));

  // ================================================================ 구역별 대표 소품: 방마다 한눈에 성격이 보이게
  const glassy = std('#bfe6ff', { transparent: true, opacity: 0.35 });
  // 자료실(서재): 책장에 기댄 사다리, 초록 은행가 램프가 놓인 독서 탁자, 두꺼운 책 더미
  for (const dx of [0, 0.34]) { const rail = box(3.1 + dx, 0.68, 0.045, 0.045, 2.1, '#8a5f3a', 0, { r: 0.008 }); rail.rotation.x = 0.06; }
  for (let k = 0; k < 7; k++) box(3.12, 0.7, 0.34, 0.035, 0.035, '#a77a4e', 0.2 + k * 0.28, { r: 0.004 });
  cyl(2.6, 3.5, 0.2, 0.05, '#6d4a2e', 0.58, { seg: 24 }); // 독서 탁자
  cyl(2.6, 3.5, 0.03, 0.58, '#5a3d27', 0);
  cyl(2.6, 3.5, 0.06, 0.02, '#2f6b4f', 0.62); // 은행가 램프
  box(2.5, 3.43, 0.24, 0.14, 0.02, '#2f6b4f', 0.82, { r: 0.006, material: std('#2f6b4f', { emissive: '#ffd98a', ei: 0.45 }) });
  box(2.44, 3.38, 0.16, 0.12, 0.04, '#7a3a3a', 0.63, { r: 0.006, rot: 0.2 });
  box(2.46, 3.4, 0.16, 0.12, 0.04, '#3f5a7a', 0.67, { r: 0.006, rot: -0.1 });
  // 리서치실: 홀로그램 지구본(푸른 반투명 구와 궤도 고리)
  {
    const holo = std('#7fd0ff', { emissive: '#4fb8ff', ei: 0.7, transparent: true, opacity: 0.55 });
    ball(3.55, 3.75, 0.19, '#7fd0ff', 0.98, { material: holo });
    for (const rx of [0.4, -0.5]) { const ring = put(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.008, 6, 36), std('#9ad8ff', { emissive: '#7fd0ff', ei: 0.9 })), false); ring.position.set(wx(3.55), 0.98, wz(3.75)); ring.rotation.set(rx + 1.2, 0.3, 0); scene.add(ring); }
    cyl(3.55, 3.75, 0.1, 0.06, '#232838', 0.62, { r2: 0.07 });
    cyl(3.55, 3.75, 0.02, 0.3, '#3a4054', 0.66);
  }
  // 기획실: 아이디어 전구 조명과 알록달록 빈백 의자
  for (const [x, y, c] of [[17.0, 3.2, '#ff7ab0'], [18.7, 3.35, '#ffd23a']]) { cyl(x, y, 0.24, 0.3, c, 0, { r2: 0.19 }); ball(x, y, 0.22, c, 0.3, { sy: 0.7 }); }
  cyl(19.65, 2.5, 0.05, 0.05, '#2a2f3d', 0);
  cyl(19.65, 2.5, 0.012, 1.1, '#3a3f4d', 0.05);
  ball(19.65, 2.5, 0.15, '#ffe27a', 1.3, { material: std('#ffe27a', { emissive: '#ffd23a', ei: 1.0 }) });
  // 데이터 창고: 랩으로 감싼 팔레트 더미, 천장에서 내려온 노란 작업등, 바닥 노란 안전선
  box(3.65, 8.0, 0.8, 0.8, 0.1, '#a97c4a', 0, { r: 0.01 });
  for (const [dx, dy, c] of [[0.04, 0.04, '#c09054'], [0.4, 0.04, '#b98450'], [0.04, 0.4, '#b98450']]) box(3.65 + dx, 8.0 + dy, 0.34, 0.34, 0.34, c, 0.1, { r: 0.02 });
  box(3.7, 8.05, 0.7, 0.7, 0.3, '#dfe9ee', 0.44, { r: 0.04, material: std('#dfe9ee', { transparent: true, opacity: 0.35 }) });
  for (const x of [4.6, 5.8]) { cyl(x, 7.1, 0.01, 0.9, '#3a3f4d', 1.7); cyl(x, 7.1, 0.22, 0.14, '#e8b44a', 1.58, { r2: 0.06, material: std('#e8b44a', { emissive: '#ffd070', ei: 0.7 }) }); }
  for (const [x, y, w, d] of [[3.55, 6.3, 3.0, 0.05], [3.55, 8.85, 3.0, 0.05]]) box(x, y, w, d, 0.012, '#f2c230', 0.01, { r: 0.002 });
  // 테스트 랩: 현미경, 세안기(비상 샤워) 표지
  box(8.55, 5.5, 0.18, 0.18, 0.03, '#2a2f3d', 0.87, { r: 0.004 });
  cyl(8.64, 5.55, 0.02, 0.22, '#dfe9ee', 0.9);
  box(8.58, 5.46, 0.07, 0.12, 0.06, '#dfe9ee', 1.02, { r: 0.006, rot: 0.3 });
  cyl(9.55, 8.4, 0.03, 1.6, '#c9ccd4', 0);
  box(9.35, 8.32, 0.4, 0.16, 0.3, '#2f8f5a', 1.55, { r: 0.015 });
  box(9.4, 8.34, 0.3, 0.02, 0.16, '#e8ecf8', 1.6, { r: 0.002, material: glow('#e8ecf8', 0.4) });
  // 빌드실: 주황 산업용 로봇 팔(컨베이어 위를 향함)
  cyl(10.5, 7.35, 0.26, 0.16, '#3a3f4d', 0);
  cyl(10.5, 7.35, 0.16, 0.5, '#ff8a3a', 0.16, { r2: 0.12 });
  { box(10.43, 7.28, 0.14, 0.14, 0.82, '#ff8a3a', 0.62, { r: 0.02 }); box(10.44, 7.0, 0.12, 0.5, 0.12, '#e8730f', 1.4, { r: 0.02 }); ball(10.5, 7.35, 0.09, '#2a2f3d', 1.42); cyl(10.5, 7.02, 0.04, 0.14, '#c9ccd4', 1.28); } // 팔은 서 있는 자리(y 6.55)를 피해 뒤쪽(y 7 이후)에 접어 둔다
  for (const y of [8.4, 8.6]) cyl(12.85, y, 0.05, 1.2, '#8a93a0', 0.2); // 벽쪽 배관
  // 형상관리실: 분기(branch) 나무 조형물 — 줄기와 색 구슬
  cyl(15.35, 8.2, 0.09, 0.08, '#2a2f3d', 0);
  cyl(15.35, 8.2, 0.02, 0.9, '#7a5fd0', 0.08);
  for (const [dx, h, c] of [[0, 0.98, '#a56bff'], [-0.18, 0.78, '#35e0a1'], [0.2, 0.7, '#4c8dff'], [-0.06, 0.55, '#ff7ab0']]) ball(15.35 + dx, 8.2, 0.07, c, h, { material: std(c, { emissive: c, ei: 0.7 }) });
  box(14.2, 7.85, 0.3, 0.22, 0.02, '#e8ecf8', 0.0, { r: 0.004, rot: 0.2 }); // 바닥 구역 표시
  // 브리핑룸: 청중석 의자 두 줄과 천장 프로젝터(스탠드)
  for (const y of [8.0, 8.55]) for (const x of [16.9, 17.65, 18.4, 19.15]) { box(x, y, 0.34, 0.34, 0.06, '#34406e', 0.34, { r: 0.012 }); box(x, y + 0.26, 0.34, 0.07, 0.34, '#34406e', 0.34, { r: 0.012 }); cyl(x + 0.17, y + 0.17, 0.025, 0.34, '#2a2f3d', 0); }
  box(18.0, 8.95, 0.3, 0.22, 0.12, '#2a2f3d', 0.9, { r: 0.012 });
  cyl(18.15, 8.9, 0.025, 0.9, '#3a3f4d', 0);
  cyl(18.15, 8.78, 0.03, 0.02, '#cfe6ff', 0.98, { material: glow('#cfe6ff', 0.9) });
  // 응답 대기실: 번호표 전광판("응답 대기" 초록 글자)과 벽시계
  {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#06130d'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#3ff09a'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
    g.fillText('WAITING', 128, 38);
    g.font = 'bold 36px monospace'; g.fillStyle = '#9af7c8'; g.fillText('No. 0042', 128, 80);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    box(3.2, 9.55, 1.7, 0.08, 0.62, '#1d2a24', 1.05, { r: 0.015 });
    const board = flat(4.05, 9.63, 1.55, 0.5, 1.36, new THREE.MeshBasicMaterial({ map: tex }), 0);
    board.position.z += 0.0;
  }
  cyl(7.3, 9.8, 0.2, 0.04, '#e8e2d4', 1.4, { seg: 28 }).rotation.x = Math.PI / 2;
  box(7.29, 9.82, 0.01, 0.01, 0.12, '#2a2f3d', 1.39, { r: 0.002 });

  // ---------------------------------------------------------------- 칸막이 벽: 가운데·아랫줄 방의 윗변에 낮은 벽(문 틈 포함)
  // (높이 1.4) 복도의 아바타 머리는 벽 너머로 보이고, 방 이름은 이 벽 위에 단다.
  const PART_H = 1.4;
  for (const { y, doors } of DOOR_LINES) {
    const cuts = [0, ...doors.flatMap((d) => [d - DOOR_W / 2, d + DOOR_W / 2]), FLOOR.w];
    for (let i = 0; i < cuts.length; i += 2) {
      const x0 = cuts[i];
      const w = cuts[i + 1] - x0;
      if (w < 0.05) continue;
      box(x0, y, w, 0.14, PART_H, '#7f9a90', 0, { r: 0.012, rough: 0.7 }); // 세이지색 벽(뒷벽 판넬과 같은 색)
      box(x0 - 0.01, y - 0.01, w + 0.02, 0.16, 0.05, '#efe8d8', PART_H, { r: 0.01 }); // 위쪽 마감
      box(x0, y + 0.13, w, 0.025, 0.1, '#4a3d33', 0, { r: 0.004 }); // 걸레받이
    }
    for (const d of doors) for (const dx of [d - DOOR_W / 2 - 0.05, d + DOOR_W / 2 - 0.05]) box(dx, y - 0.02, 0.1, 0.18, PART_H + 0.1, BRASS, 0, { r: 0.015, metal: 0.5, rough: 0.45 }); // 문기둥
  }

  // 방마다 벽 위쪽에 테마색 네온 띠: 칸막이 위(가운데·아랫줄 방)와 뒷벽 위쪽(윗줄 방)
  for (const [id, r] of Object.entries(ROOMS)) {
    const c = ROOM_THEME[id];
    if (!c) continue;
    if (r.y === 0) box(r.x + 0.15, 0.1, r.w - 0.3, 0.03, 0.045, c, WALL_H - 0.45, { r: 0.004, material: glow(c, 0.75) });
    else box(r.x + 0.1, r.y - 0.01, r.w - 0.2, 0.16, 0.035, c, PART_H + 0.05, { r: 0.004, material: glow(c, 0.8) });
  }

  // ---------------------------------------------------------------- 방 이름표(작은 알약 모양): 칸막이·뒷벽 위에 단다
  const roomLabel = (id) => {
    const r = ROOMS[id];
    const el = document.createElement('div');
    el.className = 'room' + (id === 'response' ? ' room-response' : '');
    el.textContent = ROOM_NAMES[id];
    el.style.setProperty('--rc', ROOM_THEME[id] ?? '#8a94a6');
    const o = new CSS2DObject(el);
    const onWall = r.y === 0; // 뒷벽 방은 벽 위쪽, 나머지는 칸막이 위(문 틈을 피해 방의 오른쪽에)
    o.position.set(wx(onWall ? r.x + r.w / 2 : r.x + r.w * 0.7), onWall ? WALL_H - 0.15 : PART_H + 0.12, wz(onWall ? 0.1 : r.y + 0.07));
    scene.add(o);
  };
  Object.keys(ROOMS).forEach(roomLabel);

  // 움직이거나 색이 바뀌는 것(LED·컨베이어·톱니·팀 명패)만 빼고, 같은 재료의 정적 물체는 하나로 합쳐 그린다(그리기 호출 수천 → 백여 개)
  const keep = new Set([...leds.map((l) => l.led), ...belts.map((b) => b.mesh), ...spinners, ...deskAccents, ...dynamic]);
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

  return { leds, spinners, belts, deskAccents, sky, labScreen, briefScreen, responseLine };
}

// 방별 은은한 조명: 따뜻한 전구색을 기본으로, 기계가 있는 방만 차가운 빛
export const LAMPS = [
  ['#dbe6ff', 1.7, 7.0, 24], ['#cfe0ff', 2.6, 5.9, 12], // 서버실: 차가운 흰빛
  ['#ffcf94', 9.5, 2.0, 12], // 작업실
  ['#cfe3ff', 5.0, 2.0, 8], // 리서치실: 연구실 푸른 흰빛
  ['#ffb866', 1.6, 2.2, 8], // 자료실: 호박색 독서등
  ['#ffd9a8', 16.4, 2.0, 7], // 문서실·기획실
  ['#e6f2f8', 9.5, 7.1, 8], // 테스트 랩: 밝은 무균 흰빛
  ['#ff9f5a', 11.4, 7.0, 9], // 빌드실: 용광로 주황
  ['#b59cff', 14.6, 7.0, 8], // 형상관리실: 보랏빛
  ['#a9c4ff', 18.2, 7.4, 7], // 브리핑룸: 극장 같은 푸른빛
  ['#ffd2a0', 4.0, 11.3, 8], ['#ffd2a0', 14.0, 11.5, 10], // 응답 대기실·휴게실: 따뜻한 빛
];
