// 승인 대기 패널: 오른쪽 아래에 승인 요청을 쌓아 두고 허용/거절을 누른다. 모든 텍스트는 textContent 로만 넣는다.
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function createApprovalPanel({ root, onDecide, now = () => Date.now() }) {
  const cards = new Map(); // id -> { card, left, expiresAt, buttons }
  let colors = new Map();

  function make(a) {
    const card = el('div', 'ap');
    const head = el('div', 'ap-head');
    const dot = el('i', 'ap-dot');
    const left = el('span', 'ap-left');
    head.append(dot, el('b', 'ap-team', a.team), el('span', 'ap-tool', a.tool), left);
    const detail = el('pre', 'ap-detail', a.detail || '(내용 없음)');
    const allow = el('button', 'ap-allow', '허용');
    const deny = el('button', 'ap-deny', '거절');
    allow.type = deny.type = 'button';
    const busy = (b) => { allow.disabled = deny.disabled = b; if (b) allow.textContent = '처리 중…'; else allow.textContent = '허용'; };
    const decide = async (decision) => {
      busy(true);
      const ok = await onDecide(a.id, decision);
      if (!ok) busy(false); // 실패하면 다시 누를 수 있게(성공하면 스냅샷으로 카드가 사라진다)
    };
    allow.addEventListener('click', () => decide('allow'));
    deny.addEventListener('click', () => decide('deny'));
    const btns = el('div', 'ap-btns');
    btns.append(deny, allow);
    card.append(head, detail, btns, el('div', 'ap-note', '허용하면 이 한 번만 실행됩니다. 시간이 지나면 터미널의 승인 창에서 답하세요.'));
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${a.team} 승인 요청: ${a.tool}`);
    return { card, left, dot, expiresAt: a.expiresAt };
  }

  function tick() {
    for (const c of cards.values()) c.left.textContent = `${Math.max(0, Math.ceil((c.expiresAt - now()) / 1000))}초`;
  }
  setInterval(tick, 1000);

  return {
    update(approvals, teams = []) {
      colors = new Map(teams.map((t) => [t.name, t.color]));
      const ids = new Set(approvals.map((a) => a.id));
      for (const [id, c] of cards) if (!ids.has(id)) { c.card.remove(); cards.delete(id); }
      for (const a of approvals) {
        let c = cards.get(a.id);
        if (!c) { c = make(a); cards.set(a.id, c); root.append(c.card); c.card.querySelector('.ap-deny').focus?.({ preventScroll: true }); }
        c.dot.style.background = colors.get(a.team) ?? '#8a94a6';
        c.expiresAt = a.expiresAt;
      }
      root.hidden = cards.size === 0;
      tick();
    },
    count: () => cards.size,
  };
}
