// 실제 시간(한국 시간)에 맞는 창밖 하늘과 실내외 조명. 순수 함수(Node 테스트 가능).
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const mixColor = (a, b, t) => { const x = hex(a); const y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const mix = (a, b, t) => a + (b - a) * t;

const NIGHT = { sky: { top: '#0d1230', mid: '#1a2350', low: '#2c2f5c' }, sun: { color: '#9fb4ff', intensity: 0.25 }, hemi: { sky: '#6a7fc0', ground: '#2a2430', intensity: 0.58 }, lamps: 1.35, stars: 1, litWindows: 1, exposure: 1.1 };
// [시(0~24), 상태]: 사이 시간은 선형으로 섞는다
const KEYS = [
  [0, NIGHT],
  [5, NIGHT],
  [6.5, { sky: { top: '#3b4f8a', mid: '#c58a9a', low: '#f3b27a' }, sun: { color: '#ffc89a', intensity: 0.7 }, hemi: { sky: '#aab8e0', ground: '#4a3a2e', intensity: 0.7 }, lamps: 1.1, stars: 0.2, litWindows: 0.5, exposure: 1.1 }],
  [8.5, { sky: { top: '#5b9bd8', mid: '#9fcbf0', low: '#e8f1f8' }, sun: { color: '#fff0d8', intensity: 1.4 }, hemi: { sky: '#dbe6f5', ground: '#5a4a3a', intensity: 0.95 }, lamps: 0.45, stars: 0, litWindows: 0, exposure: 1.1 }],
  [12, { sky: { top: '#4f95e0', mid: '#8cc4f2', low: '#d9ecf8' }, sun: { color: '#fff6e6', intensity: 1.6 }, hemi: { sky: '#e4edfb', ground: '#5f4f40', intensity: 1.0 }, lamps: 0.35, stars: 0, litWindows: 0, exposure: 1.1 }],
  [16.5, { sky: { top: '#5b8fd0', mid: '#a8c9ea', low: '#f1e3c8' }, sun: { color: '#ffeacc', intensity: 1.45 }, hemi: { sky: '#dbe6f5', ground: '#5a4a3a', intensity: 0.95 }, lamps: 0.5, stars: 0, litWindows: 0.05, exposure: 1.1 }],
  [18.3, { sky: { top: '#26335f', mid: '#7a5a82', low: '#e49a62' }, sun: { color: '#ffd9a8', intensity: 1.25 }, hemi: { sky: '#d7dcef', ground: '#4a3a2e', intensity: 0.85 }, lamps: 1.0, stars: 0.1, litWindows: 0.3, exposure: 1.15 }],
  [19.5, { sky: { top: '#1b2450', mid: '#4a3f78', low: '#c0617a' }, sun: { color: '#e9b8b0', intensity: 0.7 }, hemi: { sky: '#9aa8d8', ground: '#3a2e30', intensity: 0.65 }, lamps: 1.2, stars: 0.5, litWindows: 0.8, exposure: 1.1 }],
  [21, NIGHT],
  [24, NIGHT],
];

// 한국 시간(소수 시: 17.75 = 17시 45분)
export function hourKST(date = new Date()) {
  return (date.getUTCHours() + date.getUTCMinutes() / 60 + 9) % 24;
}

export function dayState(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = KEYS.length - 2;
  for (let k = 0; k < KEYS.length - 1; k++) if (h >= KEYS[k][0] && h <= KEYS[k + 1][0]) { i = k; break; }
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
  return {
    sky: { top: mixColor(a.sky.top, b.sky.top, t), mid: mixColor(a.sky.mid, b.sky.mid, t), low: mixColor(a.sky.low, b.sky.low, t) },
    sun: { color: mixColor(a.sun.color, b.sun.color, t), intensity: mix(a.sun.intensity, b.sun.intensity, t) },
    hemi: { sky: mixColor(a.hemi.sky, b.hemi.sky, t), ground: mixColor(a.hemi.ground, b.hemi.ground, t), intensity: mix(a.hemi.intensity, b.hemi.intensity, t) },
    lamps: mix(a.lamps, b.lamps, t),
    stars: mix(a.stars, b.stars, t),
    litWindows: mix(a.litWindows, b.litWindows, t),
    exposure: mix(a.exposure, b.exposure, t),
  };
}
