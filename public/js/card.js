// 아바타에 마우스를 올리면 뜨는 상세 카드: 지금 하는 일, 있는 방, 몇 분째인지, 최근 작업. 모든 텍스트는 textContent 로만 넣는다.
import { STATUS_COLOR, ago, elapsed } from './roster-model.js';

const KIND = { team: '팀장', member: '부하 직원', role: '검토자' };
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function createCard(root, { now = () => Date.now() } = {}) {
  let shownKey = null;

  function fill(row) {
    root.replaceChildren();
    const head = el('div', 'cd-head');
    const dot = el('i', 'cd-dot');
    dot.style.background = row.color;
    head.append(dot, el('b', 'cd-name', row.name), el('span', 'cd-kind', KIND[row.kind] ?? ''));
    const nowLine = el('div', 'cd-now', row.text || '대기 중');
    nowLine.style.setProperty('--st', STATUS_COLOR[row.status] ?? STATUS_COLOR.idle);
    const meta = [row.place, row.since ? elapsed(now() - row.since) : ''].filter(Boolean).join(' · ');
    root.append(head, nowLine);
    if (meta) root.append(el('div', 'cd-meta', meta));
    const before = row.recent.slice(0, -1).slice(-4).reverse(); // 지금 문구는 위에 있으니 그 이전 기록만
    if (before.length) {
      const list = el('ol', 'cd-recent');
      for (const h of before) {
        const li = el('li');
        li.append(el('span', 'cd-label', h.label), el('span', 'cd-ago', ago(now() - h.at)));
        list.append(li);
      }
      root.append(el('div', 'cd-title', '최근'), list);
    }
  }

  return {
    // row: rosterRows() 의 한 줄, (x, y): 카드를 놓을 화면 좌표(화면 밖으로 나가지 않게 조정한다)
    show(row, x, y) {
      if (!row) { this.hide(); return; }
      if (shownKey !== row.key || root.hidden) fill(row);
      shownKey = row.key;
      root.hidden = false;
      const w = root.offsetWidth || 250;
      const h = root.offsetHeight || 140;
      root.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
      root.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
    },
    hide() { root.hidden = true; shownKey = null; },
    // 같은 줄이 계속 보이는 동안 내용(경과 시간, 최근 기록)을 새 스냅샷으로 갱신한다
    refresh(rows) {
      if (root.hidden || !shownKey) return;
      const row = rows.find((r) => r.key === shownKey);
      if (row) fill(row); else this.hide();
    },
  };
}
