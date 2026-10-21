import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FLOOR, ROOMS, ENTRANCE, targetFor, memberTarget, deskZone } from './layout.js';

const STATUS_COLOR = { read: '#4c8dff', write: '#13a58a', run: '#8b5cf6', wait: '#f5a524', idle: '#8a94a6', off: '#8a94a6' };
const WALK_SPEED = 2.8; // 타일/초
const CELEBRATE_MS = 4000;
const MEMBER_SCALE = 0.82;
const BUBBLE_LEVELS = [1.6, 2.05]; // 이웃 팀 말풍선이 겹치지 않도록 2단계로 번갈아 둔다(머리 바로 위가 1단계) 

const wx = (x) => x - FLOOR.w / 2;
const wz = (y) => y - FLOOR.d / 2;

// ---------------------------------------------------------------- 사무실 건물
function buildOffice(scene, labelLayer) {
  const leds = [];
  const mat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const add = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };
  // 타일 좌표(왼쪽 위 모서리 x,y + 크기 w,d)로 상자 배치, elev는 바닥에서의 높이
  const box = (x, y, w, d, h, color, elev = 0, extra = {}) =>
    add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra)), {}), {}).position.set(wx(x + w / 2), elev + h / 2, wz(y + d / 2));

  // 바닥 슬래브와 방 색
  add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(FLOOR.w, 0.3, FLOOR.d), mat('#232a43')), {}), { cast: false }).position.set(0, -0.15, 0);
  const tint = { library: '#2b3a60', work: '#244640', server: '#34294f', meeting: '#4b3c2c', lounge: '#25453b', hall: '#2a3149' };
  for (const [name, r] of Object.entries(ROOMS)) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat(tint[name]));
    m.rotation.x = -Math.PI / 2;
    m.position.set(wx(r.x + r.w / 2), name === 'hall' ? 0.004 : 0.008, wz(r.y + r.d / 2));
    m.receiveShadow = true;
    scene.add(m);
  }
  // 바닥 격자
  const grid = new THREE.GridHelper(Math.max(FLOOR.w, FLOOR.d), Math.max(FLOOR.w, FLOOR.d), '#aab7e8', '#aab7e8');
  grid.material.opacity = 0.07;
  grid.material.transparent = true;
  grid.scale.set(FLOOR.w / Math.max(FLOOR.w, FLOOR.d), 1, FLOOR.d / Math.max(FLOOR.w, FLOOR.d));
  grid.position.y = 0.012;
  scene.add(grid);

  // 뒷벽 두 면 + 창문
  const H = 2.5;
  add(new THREE.Mesh(new THREE.BoxGeometry(FLOOR.w + 0.2, H, 0.2), mat('#3b4569')), { cast: false }).position.set(-0.1, H / 2, -FLOOR.d / 2 - 0.1);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.2, H, FLOOR.d), mat('#30385c')), { cast: false }).position.set(-FLOOR.w / 2 - 0.1, H / 2, 0);
  const glass = (w, h, px, py, pz, ry) => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), new THREE.MeshLambertMaterial({ color: '#16254a', emissive: '#3b64c0', emissiveIntensity: 0.75 }));
    g.position.set(px, py, pz);
    g.rotation.y = ry;
    scene.add(g);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.04), mat('#5b6896'));
    frame.position.set(px, py, pz - 0.02 * Math.cos(ry));
    frame.rotation.y = ry;
    scene.add(frame);
  };
  for (const cx of [5.2, 7.6, 10.0]) glass(1.5, 1.1, wx(cx), 1.45, -FLOOR.d / 2 + 0.03, 0);
  for (const cy of [4.0, 6.4, 8.8]) glass(1.5, 1.1, -FLOOR.w / 2 + 0.03, 1.45, wz(cy), Math.PI / 2);

  // 자료실: 책장과 책
  box(0.4, 0.15, 3.2, 0.6, 2.0, '#b98450');
  const bookColors = ['#4c8dff', '#f26b6b', '#f5a524', '#13a58a', '#8b5cf6', '#e8637a'];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 13; i++) {
      const h = 0.34 + ((i * 7 + row * 3) % 5) * 0.04;
      box(0.55 + i * 0.22, 0.7, 0.15, 0.1, h, bookColors[(i + row) % 6], 0.2 + row * 0.62);
    }
  }
  // 서버실: 랙과 깜빡이는 LED
  for (const y0 of [3.4, 4.9, 6.4, 7.9]) {
    box(0.1, y0, 0.95, 1.3, 1.75, '#2a3150');
    for (let j = 0; j < 5; j++) {
      const on = (j + Math.round(y0)) % 3 ? '#35e0a1' : '#8b5cf6';
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: on }));
      led.position.set(wx(1.06), 0.35 + j * 0.3, wz(y0 + 0.3));
      scene.add(led);
      leds.push({ led, phase: j * 0.7 + y0 });
      box(1.0, y0 + 0.5, 0.03, 0.7, 0.08, '#3a4470', 0.32 + j * 0.3);
    }
  }
  // 작업실: 팀마다 책상, 모니터, 팀 색 표시, 의자 (색은 update에서 팀 색으로 갱신)
  const deskAccents = [];
  for (let i = 0; i < 5; i++) {
    const z = deskZone(i);
    box(z.x + 0.2, 0.5, 1.2, 0.8, 0.75, '#e1c597');
    box(z.x + 0.55, 0.62, 0.5, 0.05, 0.36, '#26304d', 0.85);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.3), new THREE.MeshBasicMaterial({ color: '#7fe0c8' }));
    screen.position.set(wx(z.x + 0.8), 1.05, wz(0.62) + 0.03);
    scene.add(screen);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.06), mat('#e8637a'));
    strip.position.set(wx(z.x + 0.8), 0.77, wz(1.3) + 0.03);
    scene.add(strip);
    deskAccents.push(strip);
    box(z.x + 0.55, 2.15, 0.5, 0.45, 0.4, '#7a8bb0');
  }
  // 회의실: 탁자와 의자
  box(8.0, 7.3, 3.0, 1.5, 0.75, '#dbb27a');
  box(8.9, 7.7, 1.2, 0.7, 0.02, '#ffffff', 0.76);
  for (const cx of [8.4, 9.5, 10.6]) {
    box(cx, 6.85, 0.4, 0.35, 0.42, '#7a8bb0');
    box(cx, 9.05, 0.4, 0.35, 0.42, '#7a8bb0');
  }
  // 휴게실: 소파, 탁자, 화분
  box(3.2, 9.0, 3.6, 0.95, 0.45, '#3d9b7d');
  box(3.2, 9.0, 3.6, 0.28, 0.95, '#2f8268');
  box(3.2, 9.0, 0.28, 0.95, 0.7, '#2f8268');
  box(6.52, 9.0, 0.28, 0.95, 0.7, '#2f8268');
  box(4.5, 7.7, 1.0, 0.8, 0.4, '#d8b98a');
  box(3.2, 7.75, 0.8, 0.7, 0.28, '#e0a15a'); // 바닥 쿠션
  box(5.9, 7.75, 0.8, 0.7, 0.28, '#e0a15a');
  for (const [px, py] of [[3.2, 7.3], [11.4, 4.4]]) {
    box(px, py, 0.42, 0.42, 0.32, '#b98450');
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), mat('#4fb08f'));
    bush.position.set(wx(px + 0.21), 0.62, wz(py + 0.21));
    bush.castShadow = true;
    scene.add(bush);
  }

  // 방 이름표
  const roomLabel = (text, x, y, elev = 0.05) => {
    const el = document.createElement('div');
    el.className = 'room';
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.set(wx(x), elev, wz(y));
    scene.add(o);
  };
  // 벽에 붙은 방은 이름표를 벽 위쪽에 둬서 아바타·가구에 가려지지 않게 한다
  roomLabel('자료실', 2.0, 0.1, 2.35);
  roomLabel('작업실', 8.0, 0.1, 2.35);
  roomLabel('서버실', 0.1, 6.5, 2.35);
  roomLabel('회의실', 9.5, 9.6);
  roomLabel('휴게실', 5.0, 7.0);

  return { leds, deskAccents };
}

// ---------------------------------------------------------------- 아바타
function makeAvatar(shirt, hair = '#2a2236') {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const shirtMat = m(shirt);
  const part = (geo, material, x, y, z) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };
  const limb = (x, y, w, h, material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(part(new THREE.BoxGeometry(w, h, w), material, 0, -h / 2, 0));
    return pivot;
  };
  const legMat = m('#2b3350');
  const legL = limb(-0.08, 0.34, 0.12, 0.34, legMat);
  const legR = limb(0.08, 0.34, 0.12, 0.34, legMat);
  const armL = limb(-0.22, 0.8, 0.09, 0.32, shirtMat);
  const armR = limb(0.22, 0.8, 0.09, 0.32, shirtMat);
  const body = part(new THREE.CapsuleGeometry(0.17, 0.24, 4, 12), shirtMat, 0, 0.62, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.0, 0);
  head.add(part(new THREE.SphereGeometry(0.17, 18, 14), m('#f2c7a5'), 0, 0, 0));
  head.add(part(new THREE.SphereGeometry(0.18, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.85), m(hair), 0, 0.015, -0.005));
  for (const sx of [-0.06, 0.06]) head.add(part(new THREE.SphereGeometry(0.02, 8, 8), m('#2a2236'), sx, 0.0, 0.155));
  g.add(legL, legR, armL, armR, body, head);
  g.userData = { legL, legR, armL, armR, body, head, shirtMat };
  return g;
}

const el = (tagName, className) => Object.assign(document.createElement(tagName), className ? { className } : {});
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// ---------------------------------------------------------------- 장면
export function createScene(canvas, overlay) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const labelRenderer = new CSS2DRenderer({ element: overlay });
  const scene = new THREE.Scene();

  scene.add(new THREE.HemisphereLight('#9fb2e6', '#1b2036', 0.95));
  const sun = new THREE.DirectionalLight('#ffe6c4', 0.95);
  sun.position.set(-7, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
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
  controls.minZoom = 0.7;
  controls.maxZoom = 2.6;
  controls.minPolarAngle = 0.6;
  controls.maxPolarAngle = 1.25;
  controls.minAzimuthAngle = az - 0.9;
  controls.maxAzimuthAngle = az + 0.9;
  camera.zoom = 1.22;
  camera.updateProjectionMatrix();
  controls.update();

  // 방마다 은은한 조명: 서버실 보라, 작업실 청록, 휴게실 따뜻한 색
  for (const [color, x, y, intensity] of [['#8b5cf6', 1.5, 6.5, 14], ['#2bd4b0', 8, 2.2, 9], ['#ffb870', 5, 8.6, 9]]) {
    const lamp = new THREE.PointLight(color, intensity, 9, 1.6);
    lamp.position.set(wx(x), 2.2, wz(y));
    scene.add(lamp);
  }

  const office = buildOffice(scene, overlay);

  // CSS2DRenderer.setSize가 overlay의 폭·높이를 px로 고정하므로, 크기는 항상 바깥 컨테이너를 기준으로 잰다.
  const host = overlay.parentElement;
  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    const aspect = w / h;
    const halfH = Math.max(8.4, 10.6 / aspect);
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
    entity.alertObj.position.set(0.55, member ? 1.0 : 1.15, 0);
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

  function makeEntity({ team, member, id, tile, scale = 1, name, color, bubbleHeight }) {
    const group = new THREE.Group();
    const body = makeAvatar(color);
    body.scale.setScalar(scale);
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

  function setBubble(entity, text, status, done = false) {
    const el = entity.bubble;
    el.classList.toggle('done', done);
    el.querySelector('.txt').textContent = text;
    el.querySelector('.dot').style.background = STATUS_COLOR[status] ?? STATUS_COLOR.idle;
    el.querySelector('.dot').style.boxShadow = `0 0 0 4px ${(STATUS_COLOR[status] ?? STATUS_COLOR.idle)}33`;
    const sleeping = entity.goal.pose === 'sleep' && !entity.member;
    entity.bubbleObj.visible = !sleeping; // 자는 아바타는 말풍선 대신 z z만 보여 화면을 덜 어지럽힌다
    entity.alertObj.visible = status === 'wait';
    entity.zzzObj.visible = sleeping;
  }

  function update(snapshot) {
    const now = performance.now();
    snapshot.teams.forEach((team, i) => {
      if (i >= 5) return;
      try { updateTeam(team, i, now); } catch (err) { console.error(`team ${i} update failed`, err); } // 한 팀의 오류가 다른 팀을 멈추지 않게
    });
    firstSnapshot = false;
  }

  function updateTeam(team, i, now) {
    {
      let leader = leaders[i];
      if (!leader) {
        const start = targetFor(team.status, i);
        leader = leaders[i] = makeEntity({ team: i, id: `L${i}`, tile: start, name: team.name, color: team.color, bubbleHeight: BUBBLE_LEVELS[i % BUBBLE_LEVELS.length] });
        office.deskAccents[i].material.color.set(team.color);
      }
      leader.status = team.status;
      leader.tag.querySelector('span').textContent = team.name;

      // 완료 연출: 처음 받은 스냅샷의 기존 값은 무시하고, 새로 설정된 finishedAt만 4초 보여 준다
      if (!firstSnapshot && team.finishedAt && team.finishedAt !== lastFinished[i]) leader.celebrateUntil = now + CELEBRATE_MS;
      lastFinished[i] = team.finishedAt;

      const celebrating = now < leader.celebrateUntil;
      if (!celebrating) leader.goal = targetFor(team.status, i);
      setBubble(leader, celebrating ? '완료!' : team.label, team.status, celebrating);

      // 팀원
      const seen = new Set();
      team.members.forEach((m, idx) => {
        const key = `${i}:${m.id}`;
        seen.add(key);
        let ent = members.get(key);
        if (!ent) {
          ent = makeEntity({ team: i, member: true, id: m.id, tile: ENTRANCE, scale: MEMBER_SCALE, name: m.type, color: team.color, bubbleHeight: 1.3 });
          members.set(key, ent);
        }
        ent.leaving = false;
        ent.status = m.status;
        ent.slot = idx;
        ent.goal = memberTarget(m.status, i, idx);
        setBubble(ent, m.label, m.status);
      });
      for (const [key, ent] of members) {
        if (ent.team === i && !seen.has(key)) {
          ent.leaving = true;
          ent.goal = { ...ENTRANCE, pose: 'stand' };
          setBubble(ent, '퇴근!', 'idle');
        }
      }
      // 넘친 팀원 수
      if (team.overflow > 0) {
        if (!leader.more) {
          const el = document.createElement('div');
          el.className = 'more';
          leader.more = new CSS2DObject(el);
          const z = deskZone(i);
          leader.more.position.set(wx(z.x + z.w / 2), 0.1, wz(4.35));
          scene.add(leader.more);
        }
        leader.more.element.textContent = `+${team.overflow}`;
        leader.more.visible = true;
      } else if (leader.more) leader.more.visible = false;
    }
  }

  // ---- 프레임마다: 이동, 포즈 애니메이션, 장식
  function pose(entity, dt, moving) {
    const { legL, legR, armL, armR, body, head } = entity.body.userData;
    const t = clock + entity.phase;
    const p = entity.goal.pose;
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
      const s = Math.sin(t * 11);
      legL.rotation.x = s * 0.7;
      legR.rotation.x = -s * 0.7;
      armL.rotation.x = -s * 0.55;
      armR.rotation.x = s * 0.55;
      lift = Math.abs(s) * 0.05;
    } else if (p === 'type') {
      armL.rotation.x = -1.15 + Math.sin(t * 17) * 0.14;
      armR.rotation.x = -1.15 + Math.sin(t * 17 + 2) * 0.14;
      head.rotation.x = 0.12 + Math.sin(t * 2) * 0.03;
    } else if (p === 'sleep') {
      // 소파에 앉아 고개를 떨구고 잔다: 다리를 앞으로, 엉덩이를 좌석 높이에 맞춘다
      legL.rotation.x = legR.rotation.x = -1.45;
      armL.rotation.x = armR.rotation.x = -0.25;
      head.rotation.x = 0.55 + Math.sin(t * 1.6) * 0.04;
      entity.body.position.y = 0.17;
    } else {
      armL.rotation.x = Math.sin(t * 2) * 0.05;
      armR.rotation.x = -Math.sin(t * 2) * 0.05;
      if (entity.status === 'wait') head.rotation.z = Math.sin(t * 3) * 0.12;
      lift = Math.sin(t * 2) * 0.012;
    }
    entity.body.position.y += lift;
  }

  function step(entity, dt) {
    const dx = entity.goal.x - entity.pos.x;
    const dy = entity.goal.y - entity.pos.y;
    const dist = Math.hypot(dx, dy);
    const moving = dist > 0.04;
    if (moving) {
      const k = Math.min(1, (WALK_SPEED * dt) / dist);
      entity.pos.x += dx * k;
      entity.pos.y += dy * k;
      const want = Math.atan2(dx, dy);
      entity.yaw += angleDiff(entity.yaw, want) * Math.min(1, dt * 12);
    } else {
      const want = entity.goal.pose === 'type' ? Math.PI : entity.goal.pose === 'sleep' ? 0 : Math.PI / 4;
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
      step(l, dt);
      const celebrating = now < l.celebrateUntil;
      l.ring.visible = celebrating;
      if (celebrating) {
        const k = (l.celebrateUntil - now) / CELEBRATE_MS;
        l.ring.scale.setScalar(1 + (1 - k) * 0.9 + Math.sin(clock * 9) * 0.06);
        l.ring.material.opacity = Math.min(0.9, k * 1.6);
      } else if (l.celebrateUntil && now >= l.celebrateUntil) {
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
    for (const { led, phase } of office.leds) led.visible = Math.sin(clock * 3 + phase) > -0.35;

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  let lastSnapshot = null;
  const api = {
    update(snapshot) {
      lastSnapshot = snapshot;
      update(snapshot);
    },
    render,
    // 검증용: 현재 아바타 상태
    inspect: () => ({
      leaders: leaders.map((l) => l && { pos: { ...l.pos }, goal: { ...l.goal }, status: l.status, celebrating: performance.now() < l.celebrateUntil, text: l.bubble.querySelector('.txt').textContent }),
      members: [...members.values()].map((m) => ({ team: m.team, id: m.id, pos: { ...m.pos }, leaving: m.leaving, text: m.bubble.querySelector('.txt').textContent })),
    }),
  };
  return api;
}
