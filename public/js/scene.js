import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FLOOR, ROOMS, ENTRANCE, TEAM_COUNT, targetFor, memberTarget, memberSeat, deskZone, route, meetingSpot, pickMemberSpot } from './layout.js';
import { buildOffice, LAMPS, wx, wz } from './office.js';
import { parseRosterKey, mixHex, ROLE_TEAM_MIX } from './roster-model.js';
import { roomActivity } from './activity.js';
import { dayState, hourKST } from './daylight.js';
import { propsFor } from './roleprops.js';
import * as T from './textures.js';
import { HAIR, SKIN, variantFor } from './looks.js';

const STATUS_COLOR = { read: '#4c8dff', write: '#13a58a', run: '#8b5cf6', wait: '#2fbf71', idle: '#8a94a6', off: '#8a94a6' };
const WALK_SPEED = 2.8; // 타일/초
const CELEBRATE_MS = 4000;
const MEMBER_SCALE = 0.82;
const AVATAR_SCALE = 1.18; // 아바타 전체 크기 배율(팀장·팀원 공통)
const BUBBLE_LEVELS = [1.6, 2.05]; // 이웃 팀 말풍선이 겹치지 않도록 2단계로 번갈아 둔다(머리 바로 위가 1단계) 

// 소품 모양(작은 도형 조합). 이름은 roleprops.js 에서 정한다.
function addRoleProps({ propNames, part, m, head, body, armL, armR }) {
  const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
  const make = {
    tie: () => { body.add(part(new THREE.BoxGeometry(0.05, 0.17, 0.02), m('#b83a3a'), 0, 0.02, 0.125)); body.add(part(new THREE.BoxGeometry(0.07, 0.04, 0.025), m('#9a2f2f'), 0, 0.12, 0.125)); },
    clipboard: () => { const b = part(new THREE.BoxGeometry(0.12, 0.16, 0.012), m('#8a5f3a'), 0, -0.36, 0.07); b.rotation.x = -0.4; b.add(part(new THREE.BoxGeometry(0.095, 0.13, 0.004), m('#f4efe2'), 0, 0, 0.008)); armL.add(b); },
    headphones: () => { head.add(part(new THREE.TorusGeometry(0.19, 0.016, 8, 20, Math.PI), m('#2a2f3d'), 0, 0.01, 0)); for (const sx of [-0.19, 0.19]) { const c = part(new THREE.CylinderGeometry(0.05, 0.05, 0.045, 12), m('#e8637a'), sx, 0, 0); c.rotation.z = Math.PI / 2; head.add(c); } },
    magnifier: () => { const g = new THREE.Group(); g.position.set(0, -0.4, 0.08); g.rotation.x = -0.5; g.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), m('#3a3f4d'), 0, -0.05, 0)); g.add(part(new THREE.TorusGeometry(0.05, 0.009, 8, 16), m('#c9a24a'), 0, 0.04, 0)); const lens = part(new THREE.CircleGeometry(0.045, 14), new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.5 }), 0, 0.04, 0); g.add(lens); armR.add(g); },
    helmet: () => { head.add(part(new THREE.SphereGeometry(0.205, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m('#4a5160'), 0, 0.02, 0)); head.add(part(new THREE.BoxGeometry(0.1, 0.03, 0.05), m('#e5484d'), 0, 0.12, 0.17)); },
    badge: () => { body.add(part(new THREE.BoxGeometry(0.06, 0.05, 0.012), m('#e5484d'), -0.08, 0.08, 0.124)); },
    book: () => { const b = part(new THREE.BoxGeometry(0.11, 0.015, 0.15), m('#3f5a7a'), 0, -0.36, 0.07); b.rotation.x = -0.5; armL.add(b); },
    stopwatch: () => { const c = part(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 14), m('#e8b44a'), 0.09, 0.05, 0.124); c.rotation.x = Math.PI / 2; body.add(c); body.add(part(new THREE.BoxGeometry(0.012, 0.03, 0.01), m('#2a2f3d'), 0.09, 0.05, 0.138)); },
    scarf: () => { const t = part(new THREE.TorusGeometry(0.14, 0.035, 8, 16), m('#e8863a'), 0, 0.26, 0); t.rotation.x = Math.PI / 2; body.add(t); },
    roundGlasses: () => { for (const sx of [-0.065, 0.065]) head.add(part(new THREE.TorusGeometry(0.05, 0.012, 8, 14), m('#3a86ff'), sx, 0, 0.16)); },
    hardhat: () => { head.add(part(new THREE.SphereGeometry(0.205, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m('#f2c230'), 0, 0.02, 0)); head.add(part(new THREE.BoxGeometry(0.3, 0.015, 0.1), m('#f2c230'), 0, 0.03, 0.15)); },
    vest: () => { body.add(part(new THREE.BoxGeometry(0.34, 0.05, 0.01), basic('#e8863a'), 0, 0.02, 0.124)); body.add(part(new THREE.BoxGeometry(0.34, 0.015, 0.012), basic('#f4efe2'), 0, 0.02, 0.126)); },
    pen: () => { const p = part(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), m('#e8637a'), 0.17, 0.04, -0.01); p.rotation.z = -0.4; head.add(p); },
    notebook: () => { const b = part(new THREE.BoxGeometry(0.1, 0.14, 0.012), m('#f4efe2'), 0, -0.36, 0.07); b.rotation.x = -0.4; b.add(part(new THREE.BoxGeometry(0.012, 0.14, 0.014), m('#c4553f'), -0.045, 0, 0)); armL.add(b); },
    goggles: () => { head.add(part(new THREE.TorusGeometry(0.185, 0.012, 6, 20, Math.PI * 1.1), m('#2a2f3d'), 0, 0.03, 0)); for (const sx of [-0.06, 0.06]) head.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), new THREE.MeshBasicMaterial({ color: '#9fe6ff', transparent: true, opacity: 0.6 }), sx, 0.02, 0.17)); },
    flask: () => { const g = new THREE.Group(); g.position.set(0, -0.37, 0.07); g.add(part(new THREE.ConeGeometry(0.05, 0.1, 10), new THREE.MeshBasicMaterial({ color: '#35e0a1', transparent: true, opacity: 0.8 }), 0, 0, 0)); g.add(part(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 8), m('#dfe9ee'), 0, 0.07, 0)); armR.add(g); },
    cap: () => { head.add(part(new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), m('#13a58a'), 0, 0.03, 0)); head.add(part(new THREE.BoxGeometry(0.2, 0.012, 0.09), m('#0f8a72'), 0, 0.05, 0.15)); },
  };
  for (const name of propNames) make[name]?.();
}


// 팀장·역할자는 사람 모양(머리색·피부색·안경이 조금씩 다름), 부하 직원(kind='bot')은 팀장과 같은 색의 작은 로봇 모양
function makeAvatar(shirt, variant = 0, kind = 'human', roleId = null) {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const alien = kind === 'alien'; // 다른 AI 도구(Codex 등): 사람과 완전히 다른 외계인
  const shirtMat = m(alien ? '#6f7e9c' : shirt);
  const part = (geo, material, x, y, z) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };
  const skin = alien ? '#5fe3a2' : SKIN[variant % SKIN.length];
  const skinMat = m(skin);
  const trouser = m(alien ? '#56627c' : ['#2b3350', '#3a3f4a', '#4a4036', '#26303a', '#454a55', '#33384a'][variant % 6]);
  const shoeMat = m('#1d1f26');
  // 다리: 바지 + 신발(앞으로 살짝 나온다). 피벗은 엉덩이.
  const leg = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.34, 0);
    pivot.add(part(new THREE.BoxGeometry(0.115, 0.3, 0.125), trouser, 0, -0.17, 0));
    pivot.add(part(new THREE.BoxGeometry(0.12, 0.055, 0.21), shoeMat, 0, -0.318, 0.035));
    return pivot;
  };
  // 팔: 소매(팀 색) + 맨손. 피벗은 어깨.
  const arm = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.8, 0);
    pivot.add(part(new THREE.BoxGeometry(0.085, 0.24, 0.09), shirtMat, 0, -0.12, 0));
    pivot.add(part(new THREE.BoxGeometry(0.07, 0.1, 0.075), skinMat, 0, -0.27, 0));
    pivot.add(part(new THREE.SphereGeometry(0.04, 8, 6), skinMat, 0, -0.335, 0));
    return pivot;
  };
  const legL = leg(-0.075);
  const legR = leg(0.075);
  const armL = arm(-0.215);
  const armR = arm(0.215);
  const head = new THREE.Group();
  head.position.set(0, alien ? 1.22 : 1.02, 0);
  if (alien) head.scale.setScalar(1.55); // 멀리서도 사람과 구별되도록 머리를 크게
  let body;
  if (alien) {
    // 가는 몸통(가슴에 팀 색 패널), 긴 목, 커다란 달걀형 머리, 검고 큰 눈, 더듬이
    body = part(new RoundedBoxGeometry(0.3, 0.46, 0.2, 2, 0.06), shirtMat, 0, 0.62, 0);
    body.add(part(new THREE.BoxGeometry(0.11, 0.11, 0.02), new THREE.MeshBasicMaterial({ color: shirt }), 0, 0.06, 0.105));
    // 발밑에 빛나는 호버 패드: 걸어 다니는 사람들 사이에서 한눈에 띈다
    const padMat = new THREE.MeshBasicMaterial({ color: '#7dffd0', transparent: true, opacity: 0.85 });
    g.add(part(new THREE.CylinderGeometry(0.34, 0.34, 0.025, 24), padMat, 0, 0.015, 0));
    const ring = part(new THREE.TorusGeometry(0.4, 0.018, 6, 28), new THREE.MeshBasicMaterial({ color: '#b8fff0', transparent: true, opacity: 0.55 }), 0, 0.03, 0);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    body.add(part(new THREE.CylinderGeometry(0.032, 0.042, 0.13, 8), skinMat, 0, 0.29, 0));
    const skull = part(new THREE.SphereGeometry(0.19, 22, 16), skinMat, 0, 0.05, 0);
    skull.scale.set(0.98, 1.2, 0.92);
    head.add(skull);
    const eyeMat = m('#0b0e14');
    for (const sx of [-0.085, 0.085]) {
      const eye = part(new THREE.SphereGeometry(0.06, 12, 10), eyeMat, sx, 0.03, 0.15);
      eye.scale.set(1.0, 1.5, 0.42);
      eye.rotation.z = sx > 0 ? -0.4 : 0.4;
      head.add(eye);
      head.add(part(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: '#d8fff0' }), sx + (sx > 0 ? -0.015 : 0.015), 0.07, 0.172));
      const stalk = part(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 6), m('#6fb98e'), sx * 0.55, 0.3, 0);
      stalk.rotation.z = sx > 0 ? -0.35 : 0.35;
      head.add(stalk, part(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: '#9dffd0' }), sx * 1.12, 0.385, 0));
    }
    for (const sx of [-0.012, 0.012]) head.add(part(new THREE.BoxGeometry(0.006, 0.014, 0.01), eyeMat, sx, -0.06, 0.172));
    head.add(part(new THREE.BoxGeometry(0.05, 0.006, 0.01), eyeMat, 0, -0.11, 0.16));
  } else if (kind === 'bot') {
    head.position.set(0, 1.0, 0);
    body = part(new RoundedBoxGeometry(0.36, 0.38, 0.26, 1, 0.05), shirtMat, 0, 0.62, 0);
    const lighter = m(new THREE.Color(shirt).offsetHSL(0, 0, 0.08));
    head.add(part(new RoundedBoxGeometry(0.34, 0.26, 0.28, 1, 0.06), lighter, 0, 0.0, 0));
    head.add(part(new THREE.BoxGeometry(0.26, 0.1, 0.02), m('#1b2036'), 0, 0.01, 0.145)); // 얼굴 화면
    for (const sx of [-0.06, 0.06]) head.add(part(new THREE.SphereGeometry(0.022, 8, 8), new THREE.MeshBasicMaterial({ color: '#cfffee' }), sx, 0.012, 0.158));
    head.add(part(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 6), m('#3a4258'), 0, 0.19, 0)); // 안테나
    head.add(part(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: shirt }), 0, 0.27, 0));
  } else {
    // 몸통: 어깨가 넓고 앞뒤로 얇은 셔츠, 허리띠, 목, 옷깃
    body = part(new RoundedBoxGeometry(0.35, 0.46, 0.24, 2, 0.07), shirtMat, 0, 0.62, 0);
    body.add(part(new THREE.BoxGeometry(0.352, 0.045, 0.244), m('#23262e'), 0, -0.2, 0)); // 허리띠
    body.add(part(new THREE.CylinderGeometry(0.052, 0.058, 0.09, 10), skinMat, 0, 0.26, 0)); // 목
    if (variant % 3 !== 2) body.add(part(new THREE.BoxGeometry(0.15, 0.03, 0.15), m('#eceae4'), 0, 0.225, 0.02)); // 옷깃
    const hair = HAIR[variant % HAIR.length];
    const hairMat = m(hair);
    head.scale.setScalar(0.8); // 머리를 몸에 맞는 비율로
    const skull = part(new THREE.SphereGeometry(0.165, 20, 16), skinMat, 0, 0, 0);
    skull.scale.set(0.92, 1.06, 0.98);
    head.add(skull);
    head.add(part(new THREE.SphereGeometry(0.03, 8, 6), skinMat, 0, -0.01, 0.16)); // 코
    for (const sx of [-0.15, 0.15]) head.add(part(new THREE.SphereGeometry(0.03, 8, 6), skinMat, sx, -0.01, 0)); // 귀
    const cap = part(new THREE.SphereGeometry(0.175, 20, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), hairMat, 0, 0.02, -0.012);
    cap.scale.set(0.94, 1.04, 1.0);
    head.add(cap);
    head.add(part(new THREE.BoxGeometry(0.27, 0.06, 0.06), hairMat, 0, 0.1, 0.1)); // 앞머리
    if (variant % 3 === 1) head.add(part(new THREE.BoxGeometry(0.31, 0.26, 0.08), hairMat, 0, -0.07, -0.13)); // 긴 머리
    for (const sx of [-0.058, 0.058]) { // 눈 + 눈썹
      head.add(part(new THREE.SphereGeometry(0.016, 8, 6), m('#1b1d24'), sx, 0.005, 0.158));
      head.add(part(new THREE.BoxGeometry(0.055, 0.011, 0.014), hairMat, sx, 0.045, 0.158));
    }
    if (variant % 2 === 0) { // 안경
      for (const sx of [-0.062, 0.062]) head.add(part(new THREE.TorusGeometry(0.04, 0.007, 6, 14), m('#2a2f3d'), sx, 0.005, 0.163));
      head.add(part(new THREE.BoxGeometry(0.03, 0.007, 0.007), m('#2a2f3d'), 0, 0.012, 0.165));
    }
  }
  // 검토자(역할)별 소품: 한눈에 누가 누군지 보이게
  if (kind === 'human') addRoleProps({ propNames: propsFor(roleId), part, m, head, body, armL, armR });
  // 커피잔: 마실 때만 보인다(오른손)
  const mug = part(new THREE.CylinderGeometry(0.035, 0.032, 0.07, 10), m('#f4efe2'), 0, -0.33, 0.06);
  mug.visible = false;
  armR.add(mug);
  // 일하다 손에 드는 소품: 책(자료실·데이터 창고), 마커(기획실), 시험 플라스크(테스트 랩), 공구(빌드실). 평소엔 숨겨 둔다.
  const book = part(new THREE.BoxGeometry(0.11, 0.15, 0.028), m('#8a4f3a'), 0, -0.37, 0.06);
  book.add(part(new THREE.BoxGeometry(0.094, 0.134, 0.012), m('#f4efe2'), 0, 0, 0.01));
  const pen = part(new THREE.CylinderGeometry(0.011, 0.011, 0.15, 6), m('#e8637a'), 0, -0.37, 0.05);
  const flask = new THREE.Group();
  flask.position.set(0, -0.37, 0.06);
  flask.add(part(new THREE.ConeGeometry(0.05, 0.1, 10), new THREE.MeshBasicMaterial({ color: '#35e0a1', transparent: true, opacity: 0.8 }), 0, 0, 0));
  flask.add(part(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 8), m('#dfe9ee'), 0, 0.07, 0));
  const tool = part(new THREE.BoxGeometry(0.028, 0.2, 0.028), m('#8b93a8'), 0, -0.4, 0.05);
  tool.add(part(new THREE.BoxGeometry(0.09, 0.04, 0.034), m('#6b7280'), 0, 0.1, 0));
  for (const o of [book, pen, flask, tool]) { o.visible = false; armR.add(o); }
  g.add(legL, legR, armL, armR, body, head);
  g.userData = { legL, legR, armL, armR, body, head, shirtMat, mug, book, pen, flask, tool };
  return g;
}

const el = (tagName, className) => Object.assign(document.createElement(tagName), className ? { className } : {});
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// ---------------------------------------------------------------- 장면
export function createScene(canvas, overlay, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // 하이라이트가 뭉개지지 않는 영화 톤
  renderer.toneMappingExposure = 1.15;

  const labelRenderer = new CSS2DRenderer({ element: overlay });
  const scene = new THREE.Scene();

  const hemi = new THREE.HemisphereLight('#d7dcef', '#4a3a2e', 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd9a8', 1.25);
  sun.position.set(-7, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 100);
  const target = new THREE.Vector3(0, 0.4, 0.4);
  const az = Math.PI / 4;
  const polar = 0.95;
  camera.position.set(target.x + 30 * Math.sin(polar) * Math.sin(az), target.y + 30 * Math.cos(polar), target.z + 30 * Math.sin(polar) * Math.cos(az));
  camera.lookAt(target);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minZoom = 0.6;
  controls.maxZoom = 3.5;
  controls.minPolarAngle = 0.6;
  controls.maxPolarAngle = 1.25;
  controls.minAzimuthAngle = az - 0.9;
  controls.maxAzimuthAngle = az + 0.9;
  camera.zoom = 1.0;
  camera.updateProjectionMatrix();
  controls.update();

  // 방마다 은은한 조명: 서버실 보라, 작업실 청록, 빌드실 주황, 휴게실 따뜻한 색 …
  const lampLights = [];
  for (const [color, x, y, intensity] of LAMPS) {
    const lamp = new THREE.PointLight(color, intensity, 9, 1.6);
    lamp.position.set(wx(x), 2.2, wz(y));
    scene.add(lamp);
    lampLights.push({ light: lamp, base: intensity });
  }

  const office = buildOffice(scene);

  // 실제 사진 같은 깊이감: 모서리·가구 아래·벽 구석이 자연스럽게 어두워지는 환경광 차폐(AO). 실패하거나 ?ao=0 이면 그냥 그린다.
  let composer = null;
  let aoPass = null;
  if (opts.ao !== false) {
    try {
      const size = renderer.getSize(new THREE.Vector2());
      const pr = renderer.getPixelRatio();
      const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, target);
      composer.addPass(new RenderPass(scene, camera));
      aoPass = new GTAOPass(scene, camera, Math.max(1, size.x), Math.max(1, size.y));
      aoPass.output = GTAOPass.OUTPUT.Default;
      aoPass.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      aoPass.blendIntensity = 0.85;
      composer.addPass(aoPass);
      composer.addPass(new OutputPass());
    } catch (e) {
      console.warn('AO 를 쓸 수 없어 기본 렌더링으로 그립니다', e);
      composer = null;
    }
  }

  // ---- 실제 시간(한국 시간)에 맞는 창밖 하늘·햇빛·실내 조명. ?hour=21 로 시각을 고정해 볼 수 있다.
  const fixedHour = Number.isFinite(opts.hour) ? opts.hour : null;
  let dayKey = null;
  function updateDay(force = false) {
    const h = fixedHour ?? hourKST();
    const key = Math.round(h * 20);
    if (!force && key === dayKey) return;
    dayKey = key;
    const d = dayState(h);
    hemi.color.set(d.hemi.sky);
    hemi.groundColor.set(d.hemi.ground);
    hemi.intensity = d.hemi.intensity;
    sun.color.set(d.sun.color);
    sun.intensity = d.sun.intensity;
    renderer.toneMappingExposure = d.exposure;
    for (const l of lampLights) l.light.intensity = l.base * d.lamps;
    office.sky.paint(d);
  }
  updateDay(true);
  let dayTimer = 0;
  const roomLevel = { build: 0, server: 0, briefing: 0, response: 0 };
  let beltClock = 0;

  // CSS2DRenderer.setSize가 overlay의 폭·높이를 px로 고정하므로, 크기는 항상 바깥 컨테이너를 기준으로 잰다.
  const host = overlay.parentElement;
  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer?.setPixelRatio?.(renderer.getPixelRatio());
    composer?.setSize(w, h);
    labelRenderer.setSize(w, h);
    const aspect = w / h;
    const halfH = Math.max(9.4, 12.6 / aspect); // 20×14 바닥이 한 화면에 들어오게
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  // ---- 엔티티(팀장·팀원)
  const leaders = [];
  const members = new Map();
  const lastFinished = [];
  let firstSnapshot = true;
  let clock = 0;

  function makeLabels(entity, { name, color, member }) {
    const tag = document.createElement('div');
    tag.className = 'tag' + (member ? ' member' : '');
    const sw = el('i', 'sw');
    sw.style.background = color;
    tag.append(sw, el('span'));
    tag.querySelector('span').textContent = name;
    entity.tag = tag;
    entity.tagObj = new CSS2DObject(tag);
    entity.tagObj.position.set(0, member ? -0.05 : -0.03 - (entity.team % 2) * 0.3, 0);
    entity.group.add(entity.tagObj);

    const bubble = document.createElement('div');
    bubble.className = 'bubble' + (member ? ' member' : '');
    bubble.append(el('i', 'dot'), el('span', 'txt'));
    entity.bubble = bubble;
    entity.bubbleObj = new CSS2DObject(bubble);
    entity.bubbleObj.position.set(0, entity.bubbleHeight, 0);
    entity.group.add(entity.bubbleObj);

    const alert = document.createElement('div');
    alert.className = 'alert';
    alert.append(el('b'));
    alert.firstChild.textContent = '!';
    entity.alertObj = new CSS2DObject(alert);
    entity.alertObj.position.set(0.55, member ? 1.2 : 1.4, 0);
    entity.alertObj.visible = false;
    entity.group.add(entity.alertObj);

    const zzz = document.createElement('div');
    zzz.className = 'zzz';
    zzz.append(el('b'));
    zzz.firstChild.textContent = 'z z';
    entity.zzzObj = new CSS2DObject(zzz);
    entity.zzzObj.position.set(0.3, 1.65, 0);
    entity.zzzObj.visible = false;
    entity.group.add(entity.zzzObj);
  }

  function makeEntity({ team, member, id, tile, scale = 1, name, color, bubbleHeight, ai }) {
    const group = new THREE.Group();
    // 하위 에이전트(부하 직원)는 팀장과 같은 색의 로봇, 팀장·역할자는 사람 모양
    const isBot = member && !ai && !String(id).startsWith('role:');
    const variant = isBot ? 0 : variantFor({ team, kind: member ? 'member' : 'team', id });
    const roleId = member && String(id).startsWith('role:') ? String(id).slice(5) : null;
    const body = makeAvatar(color, variant, ai ? 'alien' : isBot ? 'bot' : 'human', roleId);
    body.scale.setScalar(scale * AVATAR_SCALE);
    group.add(body);
    group.position.set(wx(tile.x), 0, wz(tile.y));
    scene.add(group);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 40), new THREE.MeshBasicMaterial({ color: '#2fbf71', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    group.add(ring);

    const entity = {
      team, member, id, group, body, ring,
      pos: { ...tile }, goal: { ...tile, pose: 'stand' },
      stride: 0.9 + (([...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) * 7) % 10) / 40, goalOverride: null,
      yaw: Math.PI / 4, phase: Math.random() * 6, bubbleHeight, leaving: false, celebrateUntil: 0, status: 'idle',
    };
    makeLabels(entity, { name, color, member });
    return entity;
  }

  // 퇴근한 팀원: 화면에 남는 CSS2D 요소와 GPU 자원을 모두 정리한다(탭을 오래 켜 둬도 느려지지 않도록)
  function disposeEntity(entity) {
    entity.group.traverse((o) => {
      if (o.isCSS2DObject) o.element.remove();
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) m.dispose();
    });
    scene.remove(entity.group);
  }

  // 같은 책상 구역에 모인 팀원·역할자의 말풍선·이름표가 겹치지 않도록 자리(slot)마다 높이를 어긋나게 둔다
  function staggerLabels(entity, slot) {
    entity.bubbleObj.position.y = 1.3 + slot * 0.42;
    entity.tagObj.position.y = -0.05 - (slot % 2) * 0.3;
  }

  function setBubble(entity, text, status, done = false, color = null) {
    const el = entity.bubble;
    el.classList.toggle('done', done);
    el.querySelector('.txt').textContent = text;
    const dot = color ?? STATUS_COLOR[status] ?? STATUS_COLOR.idle;
    el.querySelector('.dot').style.background = dot;
    el.querySelector('.dot').style.boxShadow = `0 0 0 4px ${dot}33`;
    const sleeping = entity.goal.pose === 'sleep' && !entity.member;
    // 자는 아바타는 z z만, 대기 중인 아바타는 "지시 대기 구역"에 앉아 있는 것으로 충분하니 말풍선을 숨긴다
    entity.bubbleObj.visible = false; // 하는 일은 왼쪽 목록에 적는다(아바타 위에는 이름표·표시만 둔다)
    entity.alertObj.visible = status === 'wait';
    entity.zzzObj.visible = sleeping;
    entity.zzzObj.position.set(0.3, sleeping ? 0.95 : 1.65, sleeping ? -0.5 : 0); // 누우면 머리맡으로 내린다
  }

  // ---- 팀원 책상: 하위 에이전트·검토자가 작업실에 앉을 때만 책상과 의자가 나타나고, 떠나면 사라진다(빈 책상이 늘어서 지저분해지지 않게)
  const memberDesks = new Map(); // `${team}:${slot}` -> { group, scale, target }
  let deskWanted = new Set();
  function buildMemberDesk(team, slot) {
    const seat = memberSeat(team, slot);
    const g = new THREE.Group();
    g.position.set(wx(seat.x), 0, wz(seat.y));
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const add = (geo, m, x, y, z) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
    add(new THREE.BoxGeometry(0.48, 0.04, 0.32), mat('#dcc08f'), 0, 0.72, -0.49); // 책상
    for (const sx of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.04, 0.7, 0.28), mat('#6d5a42'), sx, 0.35, -0.49);
    add(new THREE.BoxGeometry(0.34, 0.24, 0.03), mat('#20242f'), 0, 0.88, -0.5); // 모니터
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ map: T.cached('ws-mini', () => T.codeScreen(95, '#7fe0c8')) }));
    screen.position.set(0, 0.88, -0.482);
    g.add(screen);
    add(new THREE.BoxGeometry(0.26, 0.015, 0.09), mat('#3a3f4d'), 0, 0.745, -0.38); // 키보드
    const chairColor = ['#3f5a7a', '#5a6a4a', '#7a4f4f', '#4a4f6a', '#6a5a3f', '#4f6a6a'][(team + slot) % 6];
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 5), mat('#2a2f3d'), 0, 0.04, 0); // 의자
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), mat('#4a4f5d'), 0, 0.2, 0);
    add(new THREE.BoxGeometry(0.42, 0.07, 0.4), mat(chairColor), 0, 0.4, 0);
    add(new THREE.BoxGeometry(0.4, 0.4, 0.06), mat(chairColor), 0, 0.64, 0.19);
    g.scale.setScalar(0.001);
    g.visible = false;
    scene.add(g);
    return { group: g, scale: 0, target: 0 };
  }
  function syncMemberDesks() {
    for (const key of deskWanted) {
      if (!memberDesks.has(key)) { const [t, s] = key.split(':').map(Number); memberDesks.set(key, buildMemberDesk(t, s)); }
    }
    for (const [key, d] of memberDesks) d.target = deskWanted.has(key) ? 1 : 0;
  }

  let act = roomActivity(null);
  let snapLeaderRooms = []; // 이번 스냅샷에서 팀장이 있는 방(팀 번호 순): 팀장 자리 점유를 팀 갱신 순서와 상관없이 정확히 본다
  function update(snapshot) {
    const now = performance.now();
    snapLeaderRooms = snapshot.teams.map((t) => (t && t.status !== 'off' ? t.room : null)); // 꺼진 팀장은 침대에서 자므로 자리를 쓰지 않는다
    // 팀원의 옛 자리 예약 정리: 이번 스냅샷에서 다른 방으로 가거나 사라지는 팀원의 예약은 팀 갱신 순서와 상관없이 먼저 푼다
    const nextRoom = new Map();
    snapshot.teams.forEach((t, ti) => {
      for (const m of t?.members ?? []) nextRoom.set(`${ti}:${m.id}`, m.room);
      for (const r of t?.roles ?? []) if (r.room) nextRoom.set(`${ti}:role:${r.id}`, r.room);
    });
    for (const [key, ent] of members) if (ent.spotRoom && nextRoom.get(key) !== ent.spotRoom) { ent.spotRoom = null; ent.spotIdx = null; }
    act = roomActivity(snapshot);
    deskWanted = new Set();
    snapshot.teams.forEach((team, i) => {
      if (i >= TEAM_COUNT) return;
      try { updateTeam(team, i, now); } catch (err) { console.error(`team ${i} update failed`, err); } // 한 팀의 오류가 다른 팀을 멈추지 않게
    });
    syncMemberDesks();
    firstSnapshot = false;
  }

  const BADGE = { ok: ['✓', '통과'], concern: ['⚠', '우려'], block: ['⛔', '중단 권고'] };
  function updateBadge(leader, badge) {
    if (!leader.badgeObj) {
      const el = document.createElement('div');
      leader.badgeObj = new CSS2DObject(el);
      leader.badgeObj.position.set(-0.6, 1.15, 0);
      leader.group.add(leader.badgeObj);
    }
    const el = leader.badgeObj.element;
    leader.badgeObj.visible = Boolean(badge);
    if (!badge) return;
    const [icon, label] = BADGE[badge.verdict] ?? BADGE.concern;
    el.className = `badge ${badge.verdict}`;
    el.textContent = badge.verdict === 'concern' ? `${icon} ${badge.concerns}` : icon;
    el.title = `${label}${badge.concerns ? ` (${badge.concerns}건)` : ''}`;
  }

  function updateTeam(team, i, now) {
    {
      let leader = leaders[i];
      if (!leader) {
        const start = targetFor(team.status, i, team.room);
        leader = leaders[i] = makeEntity({ team: i, id: `L${i}`, tile: start, name: team.name, color: team.color, bubbleHeight: BUBBLE_LEVELS[i % BUBBLE_LEVELS.length], ai: team.ai });
        office.deskAccents[i].material.color.set(team.color);
      }
      leader.status = team.status;
      leader.tag.querySelector('span').textContent = team.name;

      // 완료 연출: 처음 받은 스냅샷의 기존 값은 무시하고, 새로 설정된 finishedAt만 4초 보여 준다
      if (!firstSnapshot && team.finishedAt && team.finishedAt !== lastFinished[i]) leader.celebrateUntil = now + CELEBRATE_MS;
      lastFinished[i] = team.finishedAt;

      const celebrating = now < leader.celebrateUntil;
      if (!celebrating) leader.goal = { ...targetFor(team.status, i, team.room), room: team.room };
      // 사용자의 응답이 필요하면(승인·질문 대기, 턴이 끝난 직후) 초록 표시: 응답 대기실에서 기다리며 말풍선·느낌표·초록 링이 보인다
      leader.responseNeeded = team.room === 'response';
      // 응답 대기실에 여럿이 모이면 말풍선이 겹치지 않도록 팀마다 높이를 어긋나게 둔다
      leader.bubbleObj.position.y = leader.responseNeeded ? 1.6 + 0.5 * (i % 3) : leader.bubbleHeight;
      setBubble(leader, celebrating ? '완료!' : team.label, leader.responseNeeded ? 'wait' : team.status, celebrating);

      // 팀원 자리: 작업실이 아닌 방에서는 그 방의 비어 있는 자리(탁자 의자·작업대 앞)에 가서 가구 쪽을 보고 앉거나 선다.
      // 자리는 가구와 짝(layout.js)이라 팀장과 같은 방식으로 방향이 맞다. 자리가 모자라면 팀장 곁에 비켜 선다.
      const seatFor = (ent, status, room, slot) => {
        if (room === 'work' || !room) { ent.spotRoom = null; ent.spotIdx = null; return memberTarget(status, i, slot, room); } // 자리를 쓰지 않는 목적지: 예약을 푼다
        const othersTaken = new Set();
        for (const o of members.values()) if (o !== ent && !o.leaving && o.spotRoom === room && o.spotIdx != null) othersTaken.add(o.spotIdx);
        // 팀장 자리: 이번 스냅샷의 방 + 지금 실제로 가는 방(완료 연출 중에는 이동을 4초 미룬다)을 모두 피한다
        const leaderRooms = snapLeaderRooms.map((r, j) => (r === room || (leaders[j] && goalOf(leaders[j]).room === room && goalOf(leaders[j]).pose !== 'sleep') ? room : r));
        const idx = pickMemberSpot(room, i, { leaderRooms, othersTaken, current: { room: ent.spotRoom, idx: ent.spotIdx } });
        if (idx == null) { ent.spotRoom = null; ent.spotIdx = null; return memberTarget(status, i, slot, room); }
        ent.spotRoom = room; ent.spotIdx = idx;
        return targetFor(status === 'off' ? 'idle' : status, idx, room);
      };
      // 팀원
      const seen = new Set();
      team.members.forEach((m, idx) => {
        const key = `${i}:${m.id}`;
        seen.add(key);
        let ent = members.get(key);
        if (!ent) {
          ent = makeEntity({ team: i, member: true, id: m.id, tile: ENTRANCE, scale: MEMBER_SCALE, name: m.type, color: team.color, bubbleHeight: 1.3, ai: m.ai });
          members.set(key, ent);
        }
        ent.leaving = false;
        ent.status = m.status;
        ent.slot = idx;
        staggerLabels(ent, idx);
        ent.goal = { ...seatFor(ent, m.status, m.room, idx), room: m.room };
        if (m.room === 'work') deskWanted.add(`${i}:${idx}`); // 작업실에 앉는 팀원에게 책상이 나타난다
        setBubble(ent, m.label, m.status);
      });
      // (팀원 퇴근 처리는 역할자까지 본 뒤 아래에서 한 번에 한다)
      // 역할자(PM·개발자·QA …): 검토 중에 팀원처럼 나타나 책상에서 일하고, 끝나면 퇴근한다
      const roles = team.roles ?? [];
      roles.forEach((r, idx) => {
        const key = `${i}:role:${r.id}`;
        seen.add(key);
        let ent = members.get(key);
        if (!ent) {
          ent = makeEntity({ team: i, member: true, id: `role:${r.id}`, tile: ENTRANCE, scale: MEMBER_SCALE, name: r.name, color: mixHex(r.color, team.color, ROLE_TEAM_MIX), bubbleHeight: 1.3 });
          members.set(key, ent);
        }
        ent.leaving = false;
        ent.status = r.status === 'running' ? 'write' : 'idle';
        const slot = Math.min(3, team.members.length + idx);
        staggerLabels(ent, slot);
        // room 이 있는 job 아바타(테스터·기록원)는 그 방에서 일한다. 역할자 검토는 팀 책상에서.
        // 검토를 끝낸 역할자는 기획실 탁자로 가서 서로 얘기한다(회의)
        ent.goal = r.room
          ? { ...seatFor(ent, ent.status, r.room, slot), room: r.room }
          : r.status === 'running'
            ? (ent.spotRoom = ent.spotIdx = null, deskWanted.add(`${i}:${slot}`), { ...memberSeat(i, slot), pose: 'sitType' })
            : (ent.spotRoom = ent.spotIdx = null, { ...meetingSpot(i, idx), pose: 'talk', room: 'planning' });
        setBubble(ent, r.label, ent.status, false, r.status === 'failed' ? '#e5484d' : r.color);
      });
      for (const [key, ent] of members) {
        if (ent.team === i && !seen.has(key) && !ent.leaving) {
          ent.leaving = true;
          ent.goal = { ...ENTRANCE, pose: 'stand' };
          setBubble(ent, '퇴근!', 'idle');
        }
      }

      // 판정 배지: 다음 검토 때까지 팀장 곁에 남는다 (✓ 통과 / ⚠ 우려 n / ⛔ 중단 권고)
      updateBadge(leader, team.badge);

      // 넘친 팀원 수
      const extra = team.overflow + Math.max(0, team.members.length + roles.length - 4);
      if (extra > 0) {
        if (!leader.more) {
          const el = document.createElement('div');
          el.className = 'more';
          leader.more = new CSS2DObject(el);
          const z = deskZone(i);
          leader.more.position.set(wx(z.x + z.w / 2), 0.1, wz(4.35));
          scene.add(leader.more);
        }
        leader.more.element.textContent = `+${extra}`;
        leader.more.visible = true;
      } else if (leader.more) leader.more.visible = false;
    }
  }

  // ---- 프레임마다: 이동, 포즈 애니메이션, 장식
  let forcedRoom = null; // 검증용: 모든 팀장을 한 방의 자기 자리에 세운다(forceRoom)
  const goalOf = (e) => (forcedRoom && !e.member ? { ...targetFor('run', e.team, forcedRoom), room: forcedRoom } : e.goalOverride ?? e.goal);
  const allEntities = () => [...leaders.filter(Boolean), ...members.values()].filter((e) => !e.leaving);
  function nearestOther(entity, within) {
    let best = null;
    let bd = within;
    for (const o of allEntities()) {
      if (o === entity) continue;
      const d = Math.hypot(o.pos.x - entity.pos.x, o.pos.y - entity.pos.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // 쉬는 팀장이 가끔 휴게실에서 소파를 떠나 놀다 돌아온다: 커피 · 오락기 · 다트 · 잡지 읽기(같은 자리를 둘이 쓰지 않는다)
  const LOUNGE_ACTIVITIES = [
    { id: 'coffee', ms: [4500, 7500], spot: (team) => ({ x: 9.4 + 0.5 * team, y: 10.85, pose: 'drink' }) }, // 팀마다 자리가 달라 겹치지 않는다
    { id: 'arcade', ms: [9000, 15000], spot: () => ({ x: 14.05, y: 10.55, pose: 'arcade', face: Math.PI }) },
    { id: 'darts', ms: [9000, 14000], spot: (team, lane) => ({ x: 17.5 + 0.5 * lane, y: 11.0, pose: 'darts', face: Math.PI }) }, // 던지는 줄 3개(lane 0~2)
    { id: 'read', ms: [8000, 13000], spot: () => ({ x: 19.05, y: 10.45, pose: 'browse', face: Math.PI }) },
  ];
  const DART_LANES = 3;
  const freeDartLane = (l) => {
    const used = new Set(leaders.filter((o) => o && o !== l && o.wanderAct?.id === 'darts').map((o) => o.wanderLane));
    return [...Array(DART_LANES).keys()].find((k) => !used.has(k));
  };
  function pickActivity(l) {
    const busy = new Set(leaders.filter((o) => o && o !== l && o.wanderAct).map((o) => o.wanderAct.id));
    const free = LOUNGE_ACTIVITIES.filter((x) => x.id !== l.lastAct && (x.id === 'coffee' ? true : x.id === 'darts' ? freeDartLane(l) !== undefined : !busy.has(x.id)));
    return free[Math.floor(Math.random() * free.length)] ?? LOUNGE_ACTIVITIES[0];
  }
  function updateWander(l, now) {
    const idleSit = l.goal.pose === 'sit' && l.goal.room === 'lounge' && l.status === 'idle';
    if (!idleSit) { l.goalOverride = null; l.wanderStage = null; l.wanderAct = null; l.nextWanderAt = 0; return; }
    if (!l.nextWanderAt) l.nextWanderAt = now + 8000 + Math.random() * 25000;
    if (!l.wanderStage && now >= l.nextWanderAt) {
      l.wanderAct = pickActivity(l);
      l.wanderLane = l.wanderAct.id === 'darts' ? freeDartLane(l) : 0;
      l.goalOverride = { ...l.wanderAct.spot(l.team, l.wanderLane), room: 'lounge' };
      l.wanderStage = 'go';
    }
    if (l.wanderStage === 'go' && Math.hypot(l.goalOverride.x - l.pos.x, l.goalOverride.y - l.pos.y) < 0.15) {
      l.wanderStage = 'do';
      const [lo, hi] = l.wanderAct.ms;
      l.wanderUntil = now + lo + Math.random() * (hi - lo);
    }
    if (l.wanderStage === 'do' && now >= l.wanderUntil) {
      l.lastAct = l.wanderAct.id;
      l.goalOverride = null; l.wanderStage = null; l.wanderAct = null;
      l.nextWanderAt = now + 15000 + Math.random() * 35000;
    }
  }

  function pose(entity, dt, moving) {
    const { legL, legR, armL, armR, body, head, mug, book, pen, flask, tool } = entity.body.userData;
    const t = clock + entity.phase;
    const goal = goalOf(entity);
    const p = goal.pose;
    body.scale.y = 1 + (moving ? 0 : Math.sin(t * (p === 'sleep' ? 1.2 : 1.7)) * (p === 'sleep' ? 0.03 : 0.012)); // 숨 쉬는 몸통
    mug.visible = p === 'drink' && !moving;
    book.visible = pen.visible = flask.visible = tool.visible = false;
    const celebrating = performance.now() < entity.celebrateUntil;
    let lift = 0;
    legL.rotation.x = legR.rotation.x = armL.rotation.x = armR.rotation.x = 0;
    head.rotation.set(0, 0, 0);
    entity.body.rotation.set(0, 0, 0);
    entity.body.position.set(0, 0, 0);

    if (celebrating) {
      armL.rotation.x = armR.rotation.x = -2.9 + Math.sin(t * 9) * 0.25;
      lift = Math.abs(Math.sin(t * 6)) * 0.22;
    } else if (moving) {
      const s = Math.sin(t * 11 * entity.stride);
      legL.rotation.x = s * 0.7;
      legR.rotation.x = -s * 0.7;
      armL.rotation.x = -s * 0.55;
      armR.rotation.x = s * 0.55;
      lift = Math.abs(s) * 0.05;
      entity.body.rotation.z = Math.sin(t * 5.5 * entity.stride) * 0.03; // 걸음에 맞춘 좌우 흔들림
    } else if (p === 'talk') {
      // 회의 중: 번갈아 손짓을 하며 말하고, 고개를 끄덕인다
      const speak = Math.sin(t * 0.7) > 0 ? 1 : 0.25;
      armR.rotation.x = -0.7 + Math.sin(t * 3.2) * 0.45 * speak;
      armL.rotation.x = -0.35 + Math.sin(t * 2.6 + 1) * 0.25 * speak;
      head.rotation.x = Math.sin(t * 1.4) * 0.05;
      head.rotation.y = Math.sin(t * 0.5) * 0.2;
      lift = Math.sin(t * 2) * 0.008;
    } else if (p === 'drink') {
      // 커피 마시는 중: 가끔 잔을 입으로 가져가 한 모금
      const sip = Math.max(0, Math.sin(t * 1.5));
      armR.rotation.x = -1.1 - sip * 1.25;
      armL.rotation.x = -0.25;
      head.rotation.x = -0.2 * sip;
      lift = Math.sin(t * 2) * 0.008;
    } else if (p === 'browse') {
      // 책장·캐비닛 앞: 위쪽 칸을 훑다가 책(서류)을 빼서 읽고, 다시 꽂는다(약 11초 주기, 아바타마다 어긋남)
      const c = (t * 0.55) % 6;
      const k = (a, b, x) => a + (b - a) * (x * x * (3 - 2 * x)); // 부드러운 보간
      if (c < 1.2) { armR.rotation.x = k(-0.3, -2.25, c / 1.2); armL.rotation.x = -0.2; head.rotation.x = -0.15; head.rotation.y = Math.sin(t * 1.2) * 0.18; }
      else if (c < 2.2) { armR.rotation.x = k(-2.25, -1.15, c - 1.2); armL.rotation.x = -0.2; head.rotation.x = k(-0.15, 0.3, c - 1.2); book.visible = c > 1.6; }
      else if (c < 4.3) { // 읽는 중: 양손으로 들고 고개를 숙이며 가끔 넘긴다
        armR.rotation.x = -1.2 + Math.sin(t * 1.5) * 0.03; armL.rotation.x = -1.0 + Math.max(0, Math.sin(t * 2.2)) * 0.12; head.rotation.x = 0.35; head.rotation.y = Math.sin(t * 0.9) * 0.08; book.visible = true;
      } else if (c < 5.3) { armR.rotation.x = k(-1.15, -2.25, c - 4.3); armL.rotation.x = -0.2; head.rotation.x = k(0.3, -0.15, c - 4.3); book.visible = c < 4.95; }
      else { armR.rotation.x = k(-2.25, -0.3, (c - 5.3) / 0.7); armL.rotation.x = -0.15; head.rotation.y = Math.sin(t * 1.4) * 0.3; }
      lift = Math.sin(t * 2) * 0.008;
    } else if (p === 'write') {
      // 기획 보드에 마커로 쓴다: 팔을 들어 작게 휘갈기고, 가끔 한 걸음 물러난 듯 고개를 돌려 본다
      const back = Math.max(0, Math.sin(t * 0.45));
      armR.rotation.x = -1.95 + Math.sin(t * 5.5) * 0.07 - back * 0.25;
      armR.rotation.z = Math.sin(t * 2.4) * 0.14;
      armL.rotation.x = -0.35;
      head.rotation.x = -0.05 + back * 0.05;
      head.rotation.y = back * 0.3;
      pen.visible = true;
      lift = Math.sin(t * 2) * 0.008;
    } else if (p === 'mix') {
      // 실험대: 플라스크를 흔들어 섞고, 가끔 불빛에 비춰 본다
      const look = Math.max(0, Math.sin(t * 0.7));
      armR.rotation.x = -1.2 - look * 0.5 + Math.sin(t * 4) * 0.06;
      armR.rotation.z = Math.sin(t * 4) * 0.12;
      armL.rotation.x = -0.9;
      head.rotation.x = 0.28 - look * 0.4;
      flask.visible = true;
      lift = Math.sin(t * 2) * 0.008;
    } else if (p === 'tinker') {
      // 빌드실: 몸을 숙여 장비를 공구로 두드리고 조인다
      armR.rotation.x = -1.25 + Math.sin(t * 7) * 0.4;
      armL.rotation.x = -1.0 + Math.sin(t * 3.5) * 0.05;
      head.rotation.x = 0.3;
      entity.body.rotation.x = 0.1 + Math.sin(t * 3.5) * 0.015;
      tool.visible = true;
    } else if (p === 'point') {
      // 형상관리 보드: 한 손으로 가리키며 짚어 가고, 다른 손은 내려 둔다
      armR.rotation.x = -1.75 + Math.sin(t * 2.2) * 0.1;
      armR.rotation.z = Math.sin(t * 0.8) * 0.1;
      armL.rotation.x = -0.15;
      head.rotation.x = -0.1;
      head.rotation.y = Math.sin(t * 0.6) * 0.18;
      lift = Math.sin(t * 2) * 0.008;
    } else if (p === 'present') {
      // 브리핑: 보드와 청중을 번갈아 보며 양손으로 손짓한다
      armR.rotation.x = -1.3 + Math.sin(t * 1.7) * 0.35;
      armL.rotation.x = -0.55 + Math.sin(t * 1.2 + 1) * 0.25;
      head.rotation.y = Math.sin(t * 0.5) * 0.4;
      head.rotation.x = Math.sin(t * 1.1) * 0.05;
      lift = Math.sin(t * 2) * 0.01;
    } else if (p === 'arcade') {
      // 오락기: 조이스틱을 흔들고 버튼을 두드리다, 가끔 주먹을 불끈 쥔다
      const win = Math.max(0, Math.sin(t * 0.8 + 1.3) - 0.85) / 0.15; // 가끔(약 8초마다) 잠깐
      armR.rotation.x = -1.15 + Math.sin(t * 6) * 0.08 - win * 1.6;
      armR.rotation.z = Math.sin(t * 5) * 0.1;
      armL.rotation.x = -1.0 + Math.max(0, Math.sin(t * 9)) * 0.14;
      head.rotation.x = -0.04 + Math.sin(t * 3) * 0.03;
      head.rotation.y = Math.sin(t * 1.3) * 0.08;
      entity.body.rotation.x = 0.05 + Math.sin(t * 4) * 0.02;
      entity.body.rotation.z = Math.sin(t * 5) * 0.03;
      lift = win * 0.05;
    } else if (p === 'darts') {
      // 다트: 겨냥 → 던지기 → 팔 따라가기 → 다음 다트를 집는다(3초 주기)
      const c = t % 3;
      if (c < 1.0) { armR.rotation.x = -1.6 + Math.sin(t * 8) * 0.02; armL.rotation.x = -0.2; head.rotation.x = -0.05; pen.visible = true; entity.body.rotation.x = -0.04; }
      else if (c < 1.25) { const k = (c - 1.0) / 0.25; armR.rotation.x = -2.0 + 0.7 * k; armL.rotation.x = -0.2; head.rotation.x = -0.05; pen.visible = k < 0.5; entity.body.rotation.x = -0.04 + 0.12 * k; }
      else if (c < 2.2) { const k = Math.min(1, (c - 1.25) / 0.9); armR.rotation.x = -1.3 + 0.9 * k; armL.rotation.x = -0.2; head.rotation.x = -0.05 + 0.05 * k; entity.body.rotation.x = 0.08 * (1 - k); }
      else { armR.rotation.x = -0.4 - Math.max(0, Math.sin((c - 2.2) * 3.5)) * 0.5; armL.rotation.x = -0.2; head.rotation.y = Math.sin((c - 2.2) * 3) * 0.2; pen.visible = c > 2.7; }
      lift = Math.sin(t * 2) * 0.006;
    } else if (p === 'sitType') {
      // 작업실 의자에 앉아 타자: 다리를 앞으로 굽히고 엉덩이를 의자 높이에 맞춘다
      legL.rotation.x = legR.rotation.x = -1.45;
      armL.rotation.x = -1.15 + Math.sin(t * 17) * 0.14;
      armR.rotation.x = -1.15 + Math.sin(t * 17 + 2) * 0.14;
      head.rotation.x = 0.12 + Math.sin(t * 2) * 0.03 + Math.max(0, Math.sin(t * 0.8)) * 0.07;
      head.rotation.y = Math.sin(t * 0.45) * 0.12;
      entity.body.rotation.z = Math.sin(t * 1.3) * 0.018;
      entity.body.position.y = 0.1; // 사무용 의자 높이(0.43)에 맞춘 앉은 자세
      lift = Math.sin(t * 2) * 0.006;
    } else if (p === 'type') {
      armL.rotation.x = -1.15 + Math.sin(t * 17) * 0.14;
      armR.rotation.x = -1.15 + Math.sin(t * 17 + 2) * 0.14;
      // 화면을 보며 고개를 끄덕이고 몸을 살짝 흔든다
      head.rotation.x = 0.12 + Math.sin(t * 2) * 0.03 + Math.max(0, Math.sin(t * 0.8)) * 0.07;
      head.rotation.y = Math.sin(t * 0.45) * 0.12;
      entity.body.rotation.z = Math.sin(t * 1.3) * 0.018;
    } else if (p === 'sit') {
      // 벤치에 앉아 정면(카메라)을 보고 대기: 다리를 앞으로, 엉덩이를 벤치 높이에 맞춘다
      legL.rotation.x = legR.rotation.x = -1.45;
      armL.rotation.x = armR.rotation.x = -0.35;
      head.rotation.y = Math.sin(t * 0.7) * 0.25;
      entity.body.position.y = goal.room === 'lounge' ? 0.2 : 0.06; // 휴게실 소파는 벤치보다 높다
      lift = Math.sin(t * 2) * 0.008;
    } else if (p === 'sleep') {
      // 침대에 등을 대고 눕는다: 머리는 베개(북쪽), 얼굴은 천장 쪽. 다리는 펴고 손은 몸 옆에.
      entity.body.rotation.x = -Math.PI / 2;
      entity.body.position.y = 0.44; // 매트리스 윗면(0.3) + 몸통 반두께
      entity.body.position.z = 0.7; // 발이 침대 남쪽 끝, 머리가 베개 위에 오게 민다
      armL.rotation.x = armR.rotation.x = -0.12;
      head.rotation.x = -0.08 + Math.sin(t * 1.6) * 0.02;
    } else {
      armL.rotation.x = Math.sin(t * 2) * 0.05;
      armR.rotation.x = -Math.sin(t * 2) * 0.05;
      if (entity.status === 'wait') head.rotation.z = Math.sin(t * 3) * 0.12;
      lift = Math.sin(t * 2) * 0.012;
    }
    entity.body.position.y += lift;
  }

  function step(entity, dt) {
    // 칸막이 벽은 문(틈)으로만 지난다: 목적지가 바뀌면 경유점을 다시 계산한다
    const goal = goalOf(entity);
    const gk = `${goal.x},${goal.y}`;
    if (entity.goalKey !== gk) { entity.goalKey = gk; entity.path = route(entity.pos, goal); }
    while (entity.path.length && Math.hypot(entity.path[0].x - entity.pos.x, entity.path[0].y - entity.pos.y) < 0.1) entity.path.shift();
    const next = entity.path.length ? entity.path[0] : goal;
    const dx = next.x - entity.pos.x;
    const dy = next.y - entity.pos.y;
    const dist = Math.hypot(dx, dy);
    const moving = dist > 0.04 || entity.path.length > 0;
    if (moving) {
      const k = Math.min(1, (WALK_SPEED * entity.stride * dt) / dist);
      entity.pos.x += dx * k;
      entity.pos.y += dy * k;
      const want = Math.atan2(dx, dy);
      entity.yaw += angleDiff(entity.yaw, want) * Math.min(1, dt * 12);
    } else {
      let want = goal.face ?? (goal.pose === 'type' || goal.pose === 'sitType' || goal.pose === 'drink' ? Math.PI : goal.pose === 'sleep' ? 0 : Math.PI / 4); // 일하는 대상 쪽, 없으면 sit/stand는 카메라 쪽
      if (goal.pose === 'stand' || goal.pose === 'sit' || goal.pose === 'talk') { // 가까이 있는 아바타 쪽으로 몸을 반쯤 돌린다(서로 얘기하는 것처럼)
        const nb = nearestOther(entity, 1.5);
        if (nb) want += angleDiff(want, Math.atan2(nb.pos.x - entity.pos.x, nb.pos.y - entity.pos.y)) * 0.55;
      }
      entity.yaw += angleDiff(entity.yaw, want) * Math.min(1, dt * 8);
    }
    entity.group.position.set(wx(entity.pos.x), 0, wz(entity.pos.y));
    entity.group.rotation.y = entity.yaw;
    pose(entity, dt, moving);
    return moving;
  }

  function render(dt) {
    dt = Math.min(dt, 0.1);
    clock += dt;
    const now = performance.now();

    for (const l of leaders) {
      if (!l) continue;
      updateWander(l, now);
      step(l, dt);
      const celebrating = now < l.celebrateUntil;
      l.ring.visible = celebrating || Boolean(l.responseNeeded);
      if (celebrating) {
        const k = (l.celebrateUntil - now) / CELEBRATE_MS;
        l.ring.scale.setScalar(1 + (1 - k) * 0.9 + Math.sin(clock * 9) * 0.06);
        l.ring.material.opacity = Math.min(0.9, k * 1.6);
      } else if (l.responseNeeded) {
        l.ring.scale.setScalar(1 + Math.sin(clock * 4) * 0.08); // 응답을 기다리는 동안 초록 링이 천천히 숨 쉰다
        l.ring.material.opacity = 0.55 + Math.sin(clock * 4) * 0.2;
      }
      if (!celebrating && l.celebrateUntil && now >= l.celebrateUntil) {
        l.celebrateUntil = 0;
        // 연출이 끝나면 현재 상태의 자리로 돌아가고 문구도 되돌린다
        const snap = lastSnapshot;
        if (snap) update(snap);
      }
    }
    for (const [key, m] of members) {
      const moving = step(m, dt);
      if (m.leaving && !moving) {
        disposeEntity(m);
        members.delete(key);
      }
    }
    // 방 소품이 실제 작업에 반응한다: 일이 있는 방은 돌고 깜빡이고, 없는 방은 잠잠하다
    const ease = Math.min(1, dt * 2.5);
    roomLevel.build += ((act.build.level) - roomLevel.build) * ease;
    roomLevel.server += ((act.server.level) - roomLevel.server) * ease;
    roomLevel.briefing += ((act.briefing.level) - roomLevel.briefing) * ease;
    roomLevel.response += ((act.response.waiting > 0 ? 1 : 0) - roomLevel.response) * ease;
    const ls = roomLevel.server;
    for (const { led, phase } of office.leds) led.visible = Math.sin(clock * (1.4 + 3.4 * ls) + phase) > (ls > 0.3 ? -0.35 : 0.7);
    for (const g of office.spinners) g.rotation.z += dt * 1.4 * roomLevel.build; // 빌드실 톱니
    beltClock += dt * roomLevel.build;
    for (const b of office.belts) { // 컨베이어 줄무늬가 흐른다
      const p = (b.off + beltClock * 0.5) % b.len;
      b.mesh.position.x = wx(b.x0 + p + 0.06);
    }
    const tests = act.lab.tests;
    office.labScreen.material.color.set(tests === 'failed' ? '#ff6f5f' : tests === 'done' ? '#7dffb0' : tests === 'running' ? (Math.sin(clock * 6) > 0 ? '#ffd27a' : '#c99a3a') : '#8c96a6');
    office.briefScreen.material.color.setScalar(0.42 + 0.58 * roomLevel.briefing);
    office.responseLine.material.emissiveIntensity = 0.25 + roomLevel.response * (0.75 + 0.25 * Math.sin(clock * 3));
    for (const d of memberDesks.values()) { // 책상이 나타나고 사라지는 애니메이션
      d.scale += (d.target - d.scale) * Math.min(1, dt * 7);
      d.group.visible = d.scale > 0.03;
      d.group.scale.setScalar(Math.max(0.001, d.scale));
    }
    dayTimer += dt;
    if (dayTimer > 5) { dayTimer = 0; updateDay(); }

    stepView(dt);
    controls.update();
    if (composer) composer.render(dt); else renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  // ---- 목록 연동: 줄에 마우스를 올리면 아바타가 강조되고, 누르면 화면이 그 아바타로 부드럽게 이동한다
  const entityOf = (key) => {
    const k = parseRosterKey(key);
    if (!k) return null;
    if (k.kind === 'team') return leaders[k.team] ?? null;
    return members.get(k.kind === 'role' ? `${k.team}:role:${k.id}` : `${k.team}:${k.id}`) ?? null;
  };
  let hlEntity = null;
  let hlUntil = 0; // 누른 뒤 잠시 강조를 유지한다
  let hovering = false;
  let focusAnim = null;
  const homeTarget = target.clone();
  const homeZoom = camera.zoom;

  function setHighlight(entity) {
    if (hlEntity === entity) return;
    if (hlEntity) { hlEntity.tag.classList.remove('hl'); if (hlEntity.hlRing) hlEntity.hlRing.visible = false; }
    hlEntity = entity;
    if (entity) {
      entity.tag.classList.add('hl');
      if (!entity.hlRing) {
        entity.hlRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 40), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
        entity.hlRing.rotation.x = -Math.PI / 2;
        entity.hlRing.position.y = 0.05;
        entity.group.add(entity.hlRing);
      }
      entity.hlRing.visible = true;
    }
  }

  // 카메라가 처음 화면에서 벗어났는지(확대·이동) 알려, 화면 위 "전체 보기" 버튼을 켜고 끈다
  let away = false;
  let viewListener = () => {};
  function checkAway() {
    const now = Math.abs(camera.zoom - homeZoom) > 0.05 || controls.target.distanceTo(homeTarget) > 0.2;
    if (now !== away) { away = now; viewListener(away); }
  }

  function stepView(dt) {
    checkAway();
    if (hlEntity && !hovering && performance.now() > hlUntil) setHighlight(null);
    if (hlEntity?.hlRing?.visible) { hlEntity.hlRing.scale.setScalar(1 + Math.sin(clock * 6) * 0.1); }
    if (hlEntity && hlEntity.group.parent === null) setHighlight(null); // 퇴근해서 사라진 아바타
    if (!focusAnim) return;
    const k = 1 - Math.pow(0.0005, dt);
    const next = controls.target.clone().lerp(focusAnim.to, k);
    camera.position.add(next.clone().sub(controls.target)); // 카메라 각도는 그대로 두고 함께 평행 이동
    controls.target.copy(next);
    camera.zoom += (focusAnim.zoom - camera.zoom) * k;
    camera.updateProjectionMatrix();
    if (next.distanceTo(focusAnim.to) < 0.02 && Math.abs(camera.zoom - focusAnim.zoom) < 0.01) focusAnim = null;
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let lastSnapshot = null;
  const api = {
    highlight(key) {
      hovering = Boolean(key);
      if (!key && performance.now() < hlUntil) return; // 방금 누른 아바타는 잠시 강조를 유지한다
      setHighlight(key ? entityOf(key) : null);
    },
    focus(key) {
      const e = entityOf(key);
      if (!e) return false;
      setHighlight(e);
      hlUntil = performance.now() + 4000;
      focusAnim = { to: new THREE.Vector3(e.group.position.x, 0.4, e.group.position.z), zoom: Math.max(camera.zoom, 1.9) };
      return true;
    },
    // 화면의 (x, y) 위치에 있는 아바타의 목록 key('t0', 't1:m:id', 't2:r:pm')를 돌려준다(없으면 null)
    pickAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const ents = allEntities();
      const hit = raycaster.intersectObjects(ents.map((e) => e.body), true)[0];
      if (!hit) return null;
      let o = hit.object;
      while (o && !ents.some((e) => e.body === o)) o = o.parent;
      const ent = ents.find((e) => e.body === o);
      if (!ent) return null;
      if (!ent.member) return `t${ent.team}`;
      return String(ent.id).startsWith('role:') ? `t${ent.team}:r:${String(ent.id).slice(5)}` : `t${ent.team}:m:${ent.id}`;
    },
    onViewChange(fn) { viewListener = fn; },
    resetView() { focusAnim = { to: homeTarget.clone(), zoom: homeZoom }; },
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
    // 검증용: 현재 카메라 확대·중심
    view: () => ({ zoom: Math.round(camera.zoom * 100) / 100, x: Math.round(controls.target.x * 100) / 100, z: Math.round(controls.target.z * 100) / 100, animating: Boolean(focusAnim) }),
    update(snapshot) {
      lastSnapshot = snapshot;
      update(snapshot);
    },
    render,
    // 검증용: 모든 팀장을 그 방의 자리로 바로 옮겨 자세를 확인한다(null 이면 해제)
    forceRoom(room) {
      forcedRoom = room || null;
      if (!room) return;
      for (const l of leaders) if (l) { const g = goalOf(l); l.pos.x = g.x; l.pos.y = g.y; l.path = []; l.goalKey = `${g.x},${g.y}`; }
    },
    // 검증용: 휴게실에 쉬는 팀장을 그 놀이 자리에 바로 세워 동작을 확인한다(coffee|arcade|darts|read)
    playIn(id, team = 0) {
      const l = leaders[team];
      const act = LOUNGE_ACTIVITIES.find((a) => a.id === id);
      if (!l || !act) return false;
      l.wanderAct = act;
      l.wanderLane = act.id === 'darts' ? (freeDartLane(l) ?? 0) : 0;
      l.goalOverride = { ...act.spot(l.team, l.wanderLane), room: 'lounge' };
      l.wanderStage = 'do';
      l.wanderUntil = performance.now() + 3600_000;
      l.pos.x = l.goalOverride.x; l.pos.y = l.goalOverride.y; l.path = []; l.goalKey = `${l.pos.x},${l.pos.y}`;
      return true;
    },
    // 검증용: 카메라를 타일 좌표 (x, y) 로 바로 옮기고 확대한다(애니메이션 없음)
    viewAt(x, y, zoom = 2.2) {
      const to = new THREE.Vector3(wx(x), 0.4, wz(y));
      camera.position.add(to.clone().sub(controls.target));
      controls.target.copy(to);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.update();
    },
    // 검증용: 현재 아바타 상태
    inspect: () => ({
      leaders: leaders.map((l) => l && { pos: { ...l.pos }, goal: { ...l.goal }, status: l.status, celebrating: performance.now() < l.celebrateUntil, text: l.bubble.querySelector('.txt').textContent }),
      members: [...members.values()].map((m) => ({ team: m.team, id: m.id, pos: { ...m.pos }, leaving: m.leaving, text: m.bubble.querySelector('.txt').textContent })),
    }),
  };
  return api;
}
