// 상단 사용량 표시: PC별 오늘(KST) 누적 토큰·비용. 숫자 포맷은 순수 함수라 테스트에서 직접 쓴다.

export function formatTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function formatCost(n) {
  return `$${n.toFixed(2)}`;
}

// 스냅샷의 usage 행을 받아 헤더의 사용량 표시를 갱신한다. 모든 텍스트는 textContent 로만 넣는다.
export function createUsageHud(root) {
  return {
    update(snap) {
      const rows = snap?.usage;
      if (!Array.isArray(rows) || rows.length === 0) { root.hidden = true; return; }
      root.hidden = false;
      root.replaceChildren();
      for (const r of rows) {
        const item = document.createElement('span');
        item.className = 'usage-row' + (r.error ? ' usage-err' : '');
        const name = document.createElement('b');
        name.textContent = r.name;
        item.append(name, document.createTextNode(r.error ? ' 연결 안 됨' : ` ${formatTokens(r.tokens)} tok · ${formatCost(r.cost)}`));
        item.title = `${r.name} 오늘(KST) 누적 · ${new Date(r.at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} 갱신`;
        root.append(item);
      }
    },
  };
}
