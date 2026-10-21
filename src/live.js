// 세션 등록 정보 목록을 주기적으로 훑어 live 이벤트(상태 변화·하트비트)와 gone(사라짐)을 만든다.
const HEARTBEAT_MS = 30_000;

export function createLiveMonitor({ list, emit, now = Date.now, heartbeatMs = HEARTBEAT_MS, misses = 2 }) {
  const known = new Map(); // sessionId -> { status, at, cwd, missed }

  return {
    poll() {
      let sessions;
      try { sessions = list(); } catch { return; }
      const t = now();
      const seen = new Set();
      for (const s of sessions) {
        seen.add(s.sessionId);
        const status = s.status ?? 'idle';
        const prev = known.get(s.sessionId);
        if (prev) prev.missed = 0;
        if (prev && prev.status === status && t - prev.at < heartbeatMs) continue;
        known.set(s.sessionId, { status, at: t, cwd: s.cwd, missed: 0 });
        emit({ sessionId: s.sessionId, cwd: s.cwd ?? '/', sessionName: s.name, type: 'live', liveStatus: status, ts: t });
      }
      // 한 번 안 보인 것(파일을 다시 쓰는 중 읽기에 실패한 경우 등)으로 세션을 지우지 않는다. 연속으로 안 보여야 사라진 것으로 본다.
      for (const [id, prev] of [...known]) {
        if (seen.has(id)) continue;
        prev.missed += 1;
        if (prev.missed < misses) continue;
        known.delete(id);
        emit({ sessionId: id, cwd: prev.cwd ?? '/', type: 'live', liveStatus: 'gone', ts: t });
      }
    },
  };
}
