// 왼쪽 목록: 아바타 모습 + 이름 + 지금 하는 일(예전 말풍선 내용). 모든 텍스트는 textContent 로만 넣는다.
import { rosterRows, STATUS_COLOR, parseRosterKey } from './roster-model.js';
import { variantFor } from './looks.js';
import { portrait } from './portrait.js';

const CELEBRATE_MS = 4000;
const BADGE = { ok: ['✓', '통과'], concern: ['⚠', '우려'], block: ['⛔', '중단 권고'] };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function makeRow(row) {
  const li = el('li', `ro ${row.kind}`);
  const blob = el('span', 'blob');
  const k = parseRosterKey(row.key) ?? { team: 0, kind: 'team' };
  blob.append(portrait({ kind: row.kind, variant: variantFor({ team: k.team, kind: row.kind, id: k.id }), color: row.teamColor ?? row.color }), el('i', 'st'));
  const body = el('span', 'ro-body');
  const top = el('span', 'ro-top');
  top.append(el('b', 'ro-name'), el('span', 'ro-badge'));
  if (row.kind === 'team') { const go = el('button', 'ro-go', '검토'); go.type = 'button'; go.title = '지금 검토'; top.append(go); }
  body.append(top, el('span', 'ro-text'));
  li.append(blob, body);
  return li;
}

export function createRoster({ root, now = () => performance.now(), onHover = () => {}, onSelect = () => {}, onBadge = () => {}, onReset = () => {}, onReviewNow = () => {} }) {
  const list = root.querySelector('.ro-list');
  const search = root.querySelector('.ro-search input');
  const count = root.querySelector('.ro-count');
  const rowsByKey = new Map();
  const finished = new Map(); // 팀 key -> 마지막으로 본 finishedAt
  const celebrate = new Map(); // 팀 key -> 완료 표시를 끝낼 시각
  let first = true;
  let lastRows = [];

  const set = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  function render() {
    const q = search.value.trim().toLowerCase();
    const t = now();
    const shown = lastRows.filter((r) => !q || `${r.name} ${r.text} ${r.place}`.toLowerCase().includes(q));
    const keep = new Set(shown.map((r) => r.key));
    for (const [k, li] of rowsByKey) if (!keep.has(k)) { li.remove(); rowsByKey.delete(k); }
    shown.forEach((r, i) => {
      let li = rowsByKey.get(r.key);
      if (!li) { li = makeRow(r); rowsByKey.set(r.key, li); }
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] ?? null);
      li.dataset.key = r.key;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const done = r.kind === 'team' && t < (celebrate.get(r.key) ?? 0);
      li.className = `ro ${r.kind}${r.wait ? ' wait' : ''}${done ? ' done' : ''}${r.status === 'off' ? ' off' : ''}`;
      li.style.setProperty('--c', r.color);
      li.style.setProperty('--team', r.teamColor ?? r.color); // 팀원·역할 줄의 왼쪽 선은 팀 색
      li.style.setProperty('--st', STATUS_COLOR[r.status] ?? STATUS_COLOR.idle);
      set(li.querySelector('.ro-name'), r.name);
      set(li.querySelector('.ro-text'), done ? '완료!' : r.text);
      const place = r.place ? `${r.place}` : '';
      li.title = `${r.name}${place ? ` · ${place}` : ''}${r.text ? `\n${r.text}` : ''}`;
      const badge = li.querySelector('.ro-badge');
      if (r.badge) {
        const [icon, label] = BADGE[r.badge.verdict] ?? BADGE.concern;
        set(badge, r.badge.verdict === 'concern' ? `${icon} ${r.badge.concerns}` : icon);
        badge.className = `ro-badge ${r.badge.verdict}`;
        badge.title = `${label}${r.badge.concerns ? ` (${r.badge.concerns}건)` : ''}`;
      } else { set(badge, ''); badge.className = 'ro-badge'; }
    });
    set(count, `${lastRows.filter((r) => r.kind === 'team').length}개 팀 · ${lastRows.length}명`);
    list.classList.toggle('empty', shown.length === 0);
  }

  search.addEventListener('input', render);
  const rowOf = (e) => e.target.closest?.('.ro');
  list.addEventListener('pointerover', (e) => { const li = rowOf(e); if (li) onHover(li.dataset.key, li.getBoundingClientRect()); });
  list.addEventListener('pointerleave', () => onHover(null));
  list.addEventListener('focusin', (e) => { const li = rowOf(e); if (li) onHover(li.dataset.key, li.getBoundingClientRect()); });
  list.addEventListener('focusout', () => onHover(null));
  list.addEventListener('click', (e) => {
    const li = rowOf(e);
    if (!li) return;
    if (e.target.closest('.ro-go')) { onReviewNow(li.querySelector('.ro-name').textContent); return; }
    if (e.target.closest('.ro-badge')?.textContent) onBadge(li.dataset.key); else onSelect(li.dataset.key);
  });
  list.addEventListener('keydown', (e) => {
    const li = rowOf(e);
    if (li && (e.key === 'Enter' || e.key === ' ') && e.target === li) { e.preventDefault(); onSelect(li.dataset.key); }
  });
  root.querySelector('.ro-reset')?.addEventListener('click', () => onReset());

  return {
    update(snapshot) {
      lastRows = rosterRows(snapshot);
      const t = now();
      for (const r of lastRows) {
        if (r.kind !== 'team') continue;
        // 완료 표시: 처음 받은 스냅샷의 기존 값은 무시하고 새로 생긴 finishedAt 만 몇 초 보여 준다
        if (!first && r.finishedAt && r.finishedAt !== finished.get(r.key)) celebrate.set(r.key, t + CELEBRATE_MS);
        finished.set(r.key, r.finishedAt);
      }
      first = false;
      render();
    },
    render,
    rows: () => lastRows,
  };
}
