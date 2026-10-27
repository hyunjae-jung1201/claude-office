// 토큰 사용량 수집: 각 PC에서 ccusage(오프라인)를 돌려 오늘(KST) 누적 토큰·비용을 모은다.
// 로컬은 bash, 원격은 ssh 로 같은 명령을 실행한다. 수집 실패한 소스는 error 행으로만 남긴다.

// KST(UTC+9) 기준 오늘 날짜 'YYYY-MM-DD'
export function todayKst(nowMs) {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// nvm 환경을 로드한 뒤 ccusage 를 호출하는 셸 명령(로컬 bash -c / 원격 ssh 공용).
// --since 로 오늘치만 집계해 과거 기록 파싱 비용을 줄인다.
export function usageCommand(today) {
  const since = today.replaceAll('-', '');
  return [
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
    `npx -y ccusage@latest daily --offline --json --timezone Asia/Seoul --since ${since} 2>/dev/null`,
  ].join('; ');
}

// ccusage daily --json 출력에서 오늘 행의 토큰·비용을 꺼낸다. 오늘 행이 없으면 0(아직 사용 전).
export function parseUsage(stdout, today) {
  const data = JSON.parse(stdout);
  const row = (data.daily ?? []).find((d) => d.period === today || d.date === today);
  if (!row) return { tokens: 0, cost: 0 };
  return { tokens: row.totalTokens ?? 0, cost: row.totalCost ?? 0 };
}

export function createUsageMonitor({
  sources = [], // [{ name, local: true } | { name, ssh, key? }]
  run, // async (source, cmd) => stdout — 서버가 bash/ssh 실행을 넣어준다
  importRows = null, // async () => rows | null — 다른 PC가 밀어넣은 행(data/usage-remote.json 등)
  push = null, // async (rows) => void — 내 행을 다른 PC로 내보내기
  intervalMs = 60_000,
  now = Date.now,
  onUpdate = null,
  log = console,
} = {}) {
  let rows = [];
  let timer = null;

  async function collect(source, today) {
    const at = now();
    try {
      const out = await run(source, usageCommand(today));
      return { name: source.name, ...parseUsage(out, today), at };
    } catch (err) {
      log.warn?.(`[usage] ${source.name} 수집 실패: ${err.message}`);
      return { name: source.name, error: true, at };
    }
  }

  async function refresh() {
    const today = todayKst(now());
    const own = await Promise.all(sources.map((s) => collect(s, today)));
    const ownNames = new Set(own.map((r) => r.name));
    let imported = [];
    if (importRows) {
      try { imported = ((await importRows()) ?? []).filter((r) => r?.name && !ownNames.has(r.name)); }
      catch (err) { log.warn?.(`[usage] 외부 행 읽기 실패: ${err.message}`); }
    }
    rows = [...own, ...imported];
    onUpdate?.(rows);
    if (push) {
      try { await push(rows); } catch (err) { log.warn?.(`[usage] 내보내기 실패: ${err.message}`); }
    }
    return rows;
  }

  return {
    refresh,
    rows: () => rows,
    start() {
      if (timer) return;
      refresh();
      timer = setInterval(refresh, intervalMs);
      timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
