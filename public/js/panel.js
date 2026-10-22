// 보고서 패널: 최근 검토 목록과 지적 상세. 모든 텍스트는 textContent로만 넣는다(HTML 주입 방지).
const VERDICT = { ok: ['✓', '통과'], concern: ['⚠', '우려'], block: ['⛔', '중단 권고'], failed: ['✕', '검토 실패'] };
const SEVERITY = { info: '참고', minor: '경미', major: '중요', critical: '치명' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// 한국 시간(KST)으로 표시
export const kst = (ms) => new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function createPanel({ button, panel, fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))}) {
  const list = panel.querySelector('.rp-list');
  const detail = panel.querySelector('.rp-detail');
  const notice = panel.querySelector('.rp-notice');
  let lastKey = '';

  button.addEventListener('click', () => { panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); });
  panel.querySelector('.rp-close').addEventListener('click', () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); });

  async function showDetail(item) {
    detail.replaceChildren(el('div', 'rp-muted', '불러오는 중…'));
    let reviews = [];
    try { reviews = await fetchJson(`/api/reviews?repo=${encodeURIComponent(item.repoRoot)}${item.host ? `&host=${encodeURIComponent(item.host)}` : ''}`); } catch { /* 아래에서 처리 */ }
    const r = reviews.find((x) => x.id === item.id) ?? reviews[0];
    detail.replaceChildren();
    if (!r || !Array.isArray(r.results)) { detail.append(el('div', 'rp-muted', '상세를 불러오지 못했습니다.')); return; }
    detail.append(el('div', 'rp-title', `${r.repoName} · ${kst(r.finishedAt)}`));
    for (const res of r.results) {
      const [icon, label] = VERDICT[res.verdict] ?? VERDICT.concern;
      const box = el('div', `rp-role ${res.verdict}`);
      box.append(el('div', 'rp-role-head', `${icon} ${res.roleName ?? res.roleId} — ${label}`));
      box.append(el('div', 'rp-summary', res.summary || res.error || ''));
      for (const f of res.findings ?? []) {
        const row = el('div', `rp-finding ${f.severity}`);
        row.append(el('span', 'rp-sev', SEVERITY[f.severity] ?? f.severity));
        if (f.file) row.append(el('span', 'rp-file', f.line ? `${f.file}:${f.line}` : f.file));
        row.append(el('span', 'rp-text', f.text));
        box.append(row);
      }
      detail.append(box);
    }
  }

  return {
    update(snapshot) {
      const reviews = snapshot.reviews ?? [];
      notice.textContent = snapshot.reviewNotice ?? '';
      notice.hidden = !snapshot.reviewNotice;
      const key = JSON.stringify(reviews.map((r) => r.id));
      if (key === lastKey) return;
      lastKey = key;
      list.replaceChildren();
      if (reviews.length === 0) list.append(el('div', 'rp-muted', '아직 검토 기록이 없습니다. 파일을 수정하고 응답이 끝나면 자동으로 검토합니다.'));
      for (const item of reviews) {
        const [icon] = VERDICT[item.verdict] ?? VERDICT.concern;
        const b = el('button', `rp-item ${item.verdict}`);
        b.type = 'button';
        b.append(el('span', 'rp-icon', item.verdict === 'concern' ? `${icon}${item.concerns}` : icon));
        const body = el('span', 'rp-body');
        body.append(el('span', 'rp-name', `${item.team ?? item.repoName}`), el('span', 'rp-sum', item.summary));
        b.append(body, el('span', 'rp-time', kst(item.at)));
        b.addEventListener('click', () => showDetail(item));
        list.append(b);
      }
    },
  };
}
