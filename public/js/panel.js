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

const DELIVER_TEXT = {
  queued: '확인했습니다. 지적을 이 팀의 Claude 대화로 전달하도록 예약했습니다 — 그 대화에 다음 메시지를 보낼 때 Claude 가 받아 봅니다.',
  skipped: '확인했습니다(대화로 전달하지 않음). 팀장 옆 배지가 지워졌습니다.',
  off: '확인했습니다. 대화 전달 기능이 꺼져 있어(config roles.deliver) 전달은 하지 않았습니다.',
  'no-session': '확인했습니다. 전달할 대화(세션)를 찾지 못해 전달은 하지 못했습니다.',
  nothing: '확인했습니다. 전달할 지적(경미 이상)이 없어 전달은 하지 않았습니다.',
};

export function createPanel({ button, panel, fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : [])), postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : null)) }) {
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
    // 확인: 지적을 살펴본 뒤 OK 를 누르면 배지가 지워지고, 원하면 그 지적이 작업 대화로 전달된다
    const bar = el('div', 'rp-actions');
    const status = el('div', 'rp-ack-status', item.acked ? '이미 확인한 검토입니다.' : '');
    const mk = (label, deliver, cls) => {
      const b = el('button', `rp-ack ${cls}`, label);
      b.type = 'button';
      b.disabled = Boolean(item.acked);
      b.addEventListener('click', async () => {
        bar.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        status.textContent = '처리 중…';
        const res = await postJson('/api/review-ack', { id: item.id, deliver }).catch(() => null);
        status.textContent = res?.ok ? DELIVER_TEXT[res.deliver] ?? '확인했습니다.' : '처리하지 못했습니다. 이미 목록에서 사라졌거나 서버에 연결되지 않았습니다.';
        if (!res?.ok) bar.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      });
      return b;
    };
    bar.append(mk('확인 · 대화로 전달', true, 'primary'), mk('확인만', false, ''));
    detail.append(bar, status);
    if (r.tests) {
      const t = r.tests;
      const box = el('div', `rp-role ${t.ok ? '' : 'block'}`);
      box.append(el('div', 'rp-role-head', `${t.ok ? '✓' : '✕'} 테스트 ${t.timedOut ? '시간 초과' : t.ok ? '통과' : `실패 (종료 코드 ${t.exitCode})`}`));
      box.append(el('div', 'rp-summary', `${t.command} · ${Math.round((t.durationMs ?? 0) / 100) / 10}초`));
      if (!t.ok && t.output) box.append(el('pre', 'rp-pre', t.output));
      detail.append(box);
    }
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
      const key = JSON.stringify(reviews.map((r) => [r.id, Boolean(r.acked)]));
      if (key === lastKey) return;
      lastKey = key;
      list.replaceChildren();
      if (reviews.length === 0) list.append(el('div', 'rp-muted', '아직 검토 기록이 없습니다. 파일을 수정하고 응답이 끝나면 자동으로 검토합니다.'));
      for (const item of reviews) {
        const [icon] = VERDICT[item.verdict] ?? VERDICT.concern;
        const b = el('button', `rp-item ${item.verdict}${item.acked ? ' acked' : ''}`);
        b.type = 'button';
        b.append(el('span', 'rp-icon', item.acked ? '✓' : item.verdict === 'concern' ? `${icon}${item.concerns}` : icon));
        const body = el('span', 'rp-body');
        body.append(el('span', 'rp-name', `${item.team ?? item.repoName}${item.acked ? ' · 확인함' : ''}`), el('span', 'rp-sum', item.summary));
        b.append(body, el('span', 'rp-time', kst(item.at)));
        b.addEventListener('click', () => showDetail(item));
        list.append(b);
      }
    },
  };
}
