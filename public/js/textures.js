// 사무실 바닥·벽·화면에 쓰는 절차적 텍스처(캔버스로 그린다). 사진 없이도 손으로 만든 듯한 질감과 낙서를 준다.
import * as THREE from 'three';

// 같은 시드면 같은 무늬가 나오는 간단한 난수(새로고침해도 사무실이 똑같이 보이게)
export function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

export const shade = (hex, amount) => {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return `#${c.getHexString()}`;
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- 바닥
export function planks(base = '#b88a55', seed = 1) {
  return canvasTexture(512, 512, (g, w, h) => {
    const r = rng(seed);
    const rows = 8;
    const ph = h / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * 200;
      while (x < w) {
        const len = 160 + r() * 200;
        g.fillStyle = shade(base, (r() - 0.5) * 0.09);
        g.fillRect(x, i * ph, len, ph);
        g.strokeStyle = 'rgba(40,25,10,0.22)';
        g.lineWidth = 1.2;
        g.strokeRect(x, i * ph, len, ph);
        // 나뭇결
        for (let k = 0; k < 5; k++) {
          g.strokeStyle = `rgba(60,35,15,${0.05 + r() * 0.07})`;
          g.beginPath();
          const yy = i * ph + 4 + r() * (ph - 8);
          g.moveTo(x + 4, yy);
          g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 4, x + len * 0.6, yy + (r() - 0.5) * 4, x + len - 4, yy);
          g.stroke();
        }
        x += len;
      }
    }
  });
}

export function carpet(base = '#5d6a86', seed = 2) {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
      g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    g.strokeStyle = 'rgba(0,0,0,0.16)'; // 카펫 타일 이음매
    g.lineWidth = 1.5;
    g.strokeRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.07)';
    g.beginPath();
    g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2);
    g.stroke();
  });
}

export function terrazzo(base = '#cdbfa8', seed = 3) {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const chips = ['#e8e0d0', '#9a8f7c', '#b98f6a', '#7d8a86', '#d6a789', '#f4efe4'];
    for (let i = 0; i < 360; i++) {
      g.fillStyle = chips[Math.floor(r() * chips.length)];
      g.globalAlpha = 0.55 + r() * 0.4;
      g.beginPath();
      const x = r() * w;
      const y = r() * h;
      const s = 1.5 + r() * 4;
      g.ellipse(x, y, s, s * (0.5 + r() * 0.6), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

export function concrete(base = '#6b6f76', seed = 4) {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = r() * w;
      const y = r() * h;
      const grad = g.createRadialGradient(x, y, 0, x, y, 40 + r() * 60);
      grad.addColorStop(0, r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      g.fillRect(r() * w, r() * h, 1, 1);
    }
    g.strokeStyle = 'rgba(0,0,0,0.28)'; // 신축 줄눈
    g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
  });
}

export function tiles(base = '#d9dfdc', line = '#9aa5a1') {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = line;
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, 0, w, h / 8);
  });
}

export function raisedFloor(base = '#3a3d4d') {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) g.fillRect(a * 128 + 24 + i * 15, b * 128 + 24 + j * 15, 3, 3);
    }
  });
}

// ---------------------------------------------------------------- 벽·창문·보드
export function plasterWall(base = '#cfc6b4', seed = 5) {
  return canvasTexture(256, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(80,60,30,0.05)';
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
  });
}

export function dusk(seed = 6) {
  return canvasTexture(256, 160, (g, w, h) => {
    const r = rng(seed);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#26335f');
    sky.addColorStop(0.55, '#7a5a82');
    sky.addColorStop(0.85, '#e49a62');
    sky.addColorStop(1, '#f3c27a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { // 별
      g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`;
      g.fillRect(r() * w, r() * h * 0.4, 1, 1);
    }
    for (const [col, minH, maxH] of [['#3a3452', 40, 70], ['#241f38', 24, 52]]) { // 도시 실루엣 두 겹
      g.fillStyle = col;
      let x = -4;
      while (x < w) {
        const bw = 10 + r() * 22;
        const bh = minH + r() * (maxH - minH);
        g.fillRect(x, h - bh, bw, bh);
        if (col === '#241f38') {
          for (let k = 0; k < 6; k++) {
            if (r() > 0.45) { g.fillStyle = '#ffd98a'; g.fillRect(x + 2 + r() * (bw - 5), h - bh + 4 + r() * (bh - 8), 2, 2); }
          }
          g.fillStyle = col;
        }
        x += bw + 1 + r() * 4;
      }
    }
  });
}

// 창밖 하늘: 시간대(dayState)에 맞춰 다시 그린다. 도시 실루엣은 고정, 창문 불빛·별·해/달만 시간에 따라 변한다.
export function skyPainter(seed = 6) {
  const W = 256;
  const H = 160;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = rng(seed);
  const stars = Array.from({ length: 34 }, () => ({ x: r() * W, y: r() * H * 0.45, a: 0.3 + r() * 0.7 }));
  const layers = [['#3a3452', 40, 70, false], ['#241f38', 24, 52, true]].map(([col, minH, maxH, lit]) => {
    const blds = [];
    let x = -4;
    while (x < W) {
      const bw = 10 + r() * 22;
      const bh = minH + r() * (maxH - minH);
      const wins = lit ? Array.from({ length: 6 }, () => (r() > 0.45 ? { x: 2 + r() * (bw - 5), y: 4 + r() * (bh - 8) } : null)).filter(Boolean) : [];
      blds.push({ x, bw, bh, wins });
      x += bw + 1 + r() * 4;
    }
    return { col, blds };
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return {
    texture: tex,
    paint(day) {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, day.sky.top);
      sky.addColorStop(0.55, day.sky.mid);
      sky.addColorStop(1, day.sky.low);
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      if (day.stars > 0.02) for (const s of stars) { g.fillStyle = `rgba(255,255,255,${s.a * day.stars})`; g.fillRect(s.x, s.y, 1.4, 1.4); }
      // 해·달: 낮에는 밝은 해, 밤에는 흐린 달
      const bright = day.sun.intensity > 0.5;
      const grad = g.createRadialGradient(W * 0.72, H * 0.3, 2, W * 0.72, H * 0.3, bright ? 38 : 22);
      grad.addColorStop(0, bright ? 'rgba(255,248,220,0.9)' : 'rgba(225,232,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      for (const { col, blds } of layers) {
        g.fillStyle = col;
        for (const b of blds) {
          g.fillRect(b.x, H - b.bh, b.bw, b.bh);
          for (const w of b.wins) { g.fillStyle = `rgba(255,217,138,${0.15 + 0.85 * day.litWindows})`; g.fillRect(b.x + w.x, H - b.bh + w.y, 2, 2); }
          g.fillStyle = col;
        }
      }
      tex.needsUpdate = true;
    },
  };
}

export function codeScreen(seed = 7, hue = '#7fe0c8') {
  return canvasTexture(128, 80, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#161b2e';
    g.fillRect(0, 0, w, h);
    const colors = [hue, '#f5a524', '#8fb2ff', '#e8637a', '#c9d3f5'];
    for (let i = 0; i < 11; i++) {
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.globalAlpha = 0.85;
      const indent = Math.floor(r() * 3) * 10;
      g.fillRect(8 + indent, 6 + i * 6.4, 14 + r() * (w - 36 - indent), 3);
    }
    g.globalAlpha = 1;
  });
}

export function chartScreen(seed = 8) {
  return canvasTexture(128, 80, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#f2f5fb';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 3 ? '#4c8dff' : '#13a58a';
      const bh = 10 + r() * 40;
      g.fillRect(10 + i * 14, h - 10 - bh, 9, bh);
    }
    g.strokeStyle = '#e8637a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(8, 50);
    for (let i = 1; i < 8; i++) g.lineTo(8 + i * 15, 52 - r() * 30);
    g.stroke();
  });
}

export function kanban(seed = 9) {
  return canvasTexture(512, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#f4f2ea';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b9b4a6';
    g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.strokeStyle = '#3b4a6b';
    g.fillStyle = '#3b4a6b';
    g.font = 'bold 20px sans-serif';
    ['TODO', 'DOING', 'DONE'].forEach((t, i) => {
      g.fillText(t, 22 + i * 168, 32);
      g.beginPath(); g.moveTo(14 + i * 168, 42); g.lineTo(150 + i * 168, 42); g.stroke();
      if (i) { g.strokeStyle = '#cfcabb'; g.beginPath(); g.moveTo(i * 168 - 4, 10); g.lineTo(i * 168 - 4, h - 10); g.stroke(); g.strokeStyle = '#3b4a6b'; }
    });
    const notes = ['#ffd166', '#ff8fa3', '#8fd3ff', '#b8f2a8', '#ffb86b'];
    for (let col = 0; col < 3; col++) {
      const n = [4, 3, 5][col];
      for (let k = 0; k < n; k++) {
        const x = 18 + col * 168 + (r() - 0.5) * 8;
        const y = 56 + k * 38 + (r() - 0.5) * 5;
        g.save();
        g.translate(x + 60, y + 14);
        g.rotate((r() - 0.5) * 0.12);
        g.fillStyle = notes[Math.floor(r() * notes.length)];
        g.fillRect(-58, -15, 116, 30);
        g.fillStyle = 'rgba(40,40,60,0.55)';
        g.fillRect(-48, -6, 40 + r() * 40, 3);
        g.fillRect(-48, 3, 24 + r() * 40, 3);
        g.restore();
      }
    }
  });
}

export function gitGraph(seed = 10) {
  return canvasTexture(512, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#1b2036';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a3150';
    for (let i = 0; i < 40; i++) g.fillRect(0, i * 7, w, 1);
    const lanes = [['#4c8dff', 70], ['#13a58a', 128], ['#f5a524', 186]];
    for (const [col, y] of lanes) {
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(30, y); g.lineTo(w - 30, y); g.stroke();
      g.fillStyle = col;
      for (let x = 50; x < w - 40; x += 36 + r() * 30) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
    }
    g.strokeStyle = '#13a58a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(140, 70); g.bezierCurveTo(170, 70, 170, 128, 200, 128); g.stroke();
    g.strokeStyle = '#f5a524';
    g.beginPath(); g.moveTo(300, 128); g.bezierCurveTo(330, 128, 330, 186, 360, 186); g.stroke();
    g.strokeStyle = '#13a58a';
    g.beginPath(); g.moveTo(380, 128); g.bezierCurveTo(410, 128, 410, 70, 440, 70); g.stroke();
  });
}

export function poster(seed = 11, a = '#e8637a', b = '#f5a524') {
  return canvasTexture(128, 176, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#f1eadb';
    g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(10, 10, w - 20, h * 0.6);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.arc(30 + r() * 60, 40 + r() * 40, 14 + r() * 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(30,30,50,0.55)';
    g.beginPath(); g.moveTo(10, h * 0.6 + 10); g.lineTo(40 + r() * 20, 50 + r() * 20); g.lineTo(70 + r() * 20, h * 0.6 + 10); g.fill();
    g.fillStyle = '#3b3f4a';
    g.fillRect(14, h * 0.6 + 24, 70, 4);
    g.fillRect(14, h * 0.6 + 34, 46, 3);
  });
}

export function mapBoard(seed = 12) {
  return canvasTexture(256, 160, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#d9c9a4';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9db79a';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(30 + r() * 200, 20 + r() * 120, 18 + r() * 30, 10 + r() * 18, r() * 3, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#b5764f';
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(20, 110); g.bezierCurveTo(80, 30, 140, 140, 230, 40); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#e8637a';
    for (const [x, y] of [[20, 110], [120, 80], [230, 40]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  });
}

// 반복해서 쓰는 텍스처를 한 번만 만든다
const cache = new Map();
export const cached = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};
export const repeated = (tex, rx, ry) => {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(rx, ry);
  return t;
};
