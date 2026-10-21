import { createScene } from './scene.js';
import { createPanel } from './panel.js';

const canvas = document.getElementById('c');
const overlay = document.getElementById('overlay');
const conn = document.getElementById('conn');
const connText = conn.querySelector('span');
const scene = createScene(canvas, overlay);
const panel = createPanel({ button: document.getElementById('rp-btn'), panel: document.getElementById('rp') });
window.__office = scene; // 화면 검증용

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
