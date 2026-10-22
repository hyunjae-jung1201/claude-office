import { createScene } from './scene.js';
import { createPanel } from './panel.js';
import { createRoster } from './roster.js';
import { createCard } from './card.js';

const canvas = document.getElementById('c');
const overlay = document.getElementById('overlay');
const conn = document.getElementById('conn');
const connText = conn.querySelector('span');
const hourParam = Number.parseFloat(new URLSearchParams(location.search).get('hour')); // ?hour=21 로 시각을 고정해 볼 수 있다
const scene = createScene(canvas, overlay, { hour: hourParam, ao: new URLSearchParams(location.search).get('ao') !== '0' }); // ?ao=0 으로 환경광 차폐를 끌 수 있다
const card = createCard(document.getElementById('card'));
const panel = createPanel({ button: document.getElementById('rp-btn'), panel: document.getElementById('rp') });
let toastTimer = null;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
let focusedKey = null;
function resetView() { focusedKey = null; scene.resetView(); }
// 확대된 동안만 화면 위에 "전체 보기" 버튼을 띄우고, Esc·화면 빈 곳 더블클릭으로도 돌아온다
const viewBtn = document.getElementById('view-reset');
scene.onViewChange((away) => { viewBtn.hidden = !away; if (!away) focusedKey = null; });
viewBtn.addEventListener('click', resetView);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !viewBtn.hidden && !e.target.closest?.('input')) resetView(); });
canvas.addEventListener('dblclick', resetView);
// 3D 화면에서 아바타 위에 마우스를 올리면 상세 카드(드래그 중에는 숨김)
let hoverKey = null;
let hoverRaf = 0;
let lastMove = null;
canvas.addEventListener('pointermove', (e) => {
  lastMove = e;
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const m = lastMove;
    if (!m) return;
    const key = m.buttons ? null : scene.pickAt(m.clientX, m.clientY);
    if (key !== hoverKey) { hoverKey = key; scene.highlight(key); }
    if (key) card.show(roster.rows().find((r) => r.key === key), m.clientX + 16, m.clientY + 16); else card.hide();
  });
});
canvas.addEventListener('pointerleave', () => { lastMove = null; if (hoverKey) { hoverKey = null; scene.highlight(null); } card.hide(); });
const rpBtn = document.getElementById('rp-btn');
const roster = createRoster({
  root: document.getElementById('roster'),
  onHover: (key, rect) => {
    scene.highlight(key);
    if (key && rect) card.show(roster.rows().find((r) => r.key === key), rect.right + 10, rect.top); else card.hide();
  },
  // 같은 줄을 한 번 더 누르면 전체 화면으로 돌아온다
  onSelect: (key) => {
    if (focusedKey === key && scene.view().zoom > 1.05) resetView();
    else if (scene.focus(key)) focusedKey = key;
  },
  onBadge: () => { if (document.getElementById('rp').hidden) rpBtn.click(); }, // 판정 배지를 누르면 보고서를 연다
  onReset: () => resetView(),
  onReviewNow: async (team) => {
    try {
      const r = await fetch('/api/review-now', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team }) });
      const j = await r.json().catch(() => ({}));
      if (j.started) toast(`${team}: 검토를 시작했습니다`);
      else if (j.reason === 'no-changes') toast(`${team}: 검토할 변경이 없습니다`);
      else if (j.error === 'roles-disabled') toast('역할자 검토가 꺼져 있습니다');
      else toast(`${team}: 검토를 시작하지 못했습니다`);
    } catch { toast('서버에 연결하지 못했습니다'); }
  },
});
window.__office = scene; // 화면 검증용
window.__roster = roster;

// 목록 켜기/끄기(좁은 화면에서는 기본 꺼짐). 선택은 이 브라우저에만 기억한다.
const roBtn = document.getElementById('ro-btn');
const narrow = window.matchMedia('(max-width: 760px)');
let roOn = !narrow.matches;
try { const v = localStorage.getItem('office.roster'); if (v !== null) roOn = v === '1'; } catch { /* 저장소를 못 쓰면 기본값 */ }
function applyRoster() {
  document.body.classList.toggle('roster-off', !roOn && !narrow.matches);
  document.body.classList.toggle('roster-on', roOn && narrow.matches);
  roBtn.setAttribute('aria-pressed', String(roOn));
  window.dispatchEvent(new Event('resize')); // 3D 화면 크기를 다시 잡는다
}
roBtn.addEventListener('click', () => { roOn = !roOn; try { localStorage.setItem('office.roster', roOn ? '1' : '0'); } catch { /* 무시 */ } applyRoster(); });
narrow.addEventListener('change', () => { roOn = !narrow.matches; applyRoster(); });
applyRoster();

function setConn(up) {
  conn.classList.toggle('down', !up);
  connText.textContent = up ? '연결됨' : '연결 끊김';
}

let retry = null;
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => setConn(true);
  ws.onmessage = (e) => {
    try {
      const snap = JSON.parse(e.data);
      scene.update(snap);
      panel.update(snap);
      roster.update(snap);
      card.refresh(roster.rows());
    } catch (err) { console.error('bad snapshot', err); }
  };
  ws.onclose = () => {
    setConn(false);
    clearTimeout(retry);
    retry = setTimeout(connect, 3000);
  };
  ws.onerror = () => ws.close();
}
connect();

// 탭이 숨겨지면 렌더링을 멈추고, 다시 보이면 이어서 그린다.
let raf = 0;
let last = 0;
function frame(t) {
  const dt = last ? (t - last) / 1000 : 0;
  last = t;
  scene.render(dt);
  raf = requestAnimationFrame(frame);
}
function start() {
  if (raf) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}
function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
if (!document.hidden) start();
