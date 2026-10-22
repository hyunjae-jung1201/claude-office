// 목록의 얼굴 그림: 3D 아바타와 같은 머리색·피부색·안경으로 그린 상반신 SVG. 팀장·역할자는 사람, 하위 에이전트는 로봇.
import { HAIR, SKIN } from './looks.js';

const NS = 'http://www.w3.org/2000/svg';
const node = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
};

export function portrait({ kind, variant = 0, color }) {
  const svg = node('svg', { viewBox: '0 0 36 36', 'aria-hidden': 'true' });
  if (kind === 'member') { // 로봇: 팀 색 몸통, 밝은 머리, 어두운 얼굴 화면
    node('rect', { x: 7, y: 25, width: 22, height: 12, rx: 4, fill: color }, svg);
    node('rect', { x: 8, y: 8, width: 20, height: 16, rx: 5, fill: color, opacity: 0.85 }, svg);
    node('rect', { x: 10.5, y: 12, width: 15, height: 8, rx: 2.5, fill: '#1b2036' }, svg);
    node('circle', { cx: 15, cy: 16, r: 1.5, fill: '#cfffee' }, svg);
    node('circle', { cx: 21, cy: 16, r: 1.5, fill: '#cfffee' }, svg);
    node('line', { x1: 18, y1: 8, x2: 18, y2: 4, stroke: '#3a4258', 'stroke-width': 1.4 }, svg);
    node('circle', { cx: 18, cy: 3.6, r: 1.8, fill: color }, svg);
    return svg;
  }
  const skin = SKIN[variant % SKIN.length];
  const hair = HAIR[variant % HAIR.length];
  node('path', { d: 'M3 37c0-8 6-11.5 15-11.5S33 29 33 37z', fill: color }, svg); // 어깨(셔츠)
  if (variant % 3 !== 2) node('path', { d: 'M13.5 26.2 18 31l4.5-4.8z', fill: '#eceae4' }, svg); // 옷깃
  node('rect', { x: 15.3, y: 21, width: 5.4, height: 6, rx: 2, fill: skin }, svg); // 목
  if (variant % 3 === 1) node('path', { d: 'M8.5 14c0-6 4-9 9.5-9s9.5 3 9.5 9v12H8.5z', fill: hair }, svg); // 긴 머리(뒤)
  node('ellipse', { cx: 18, cy: 15.5, rx: 7.6, ry: 8.6, fill: skin }, svg); // 얼굴
  node('path', { d: 'M9.8 14.2C9.6 8.4 13 5.6 18 5.6s8.4 2.8 8.2 8.6c-1.8-2.2-4.6-3.4-8.2-3.4s-6.4 1.2-8.2 3.4z', fill: hair }, svg); // 머리카락
  node('circle', { cx: 15, cy: 16, r: 1.1, fill: '#1b1d24' }, svg);
  node('circle', { cx: 21, cy: 16, r: 1.1, fill: '#1b1d24' }, svg);
  node('path', { d: 'M16 20.4q2 1.4 4 0', fill: 'none', stroke: '#8a4b3a', 'stroke-width': 0.9, 'stroke-linecap': 'round' }, svg);
  if (variant % 2 === 0) { // 안경
    node('circle', { cx: 15, cy: 16, r: 2.7, fill: 'none', stroke: '#2a2f3d', 'stroke-width': 0.9 }, svg);
    node('circle', { cx: 21, cy: 16, r: 2.7, fill: 'none', stroke: '#2a2f3d', 'stroke-width': 0.9 }, svg);
    node('line', { x1: 17.7, y1: 16, x2: 18.3, y2: 16, stroke: '#2a2f3d', 'stroke-width': 0.8 }, svg);
  }
  return svg;
}
