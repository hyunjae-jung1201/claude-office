// Claude Code가 실행 중인 세션을 적어 두는 ~/.claude/sessions/<pid>.json 에서 세션 이름을 찾는다(읽기 전용).
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MIN_REREAD_MS = 50; // 모르는 세션이 계속 와도 폴더를 이 간격보다 자주 읽지 않는다

export function createSessionRegistry({ dir = join(homedir(), '.claude', 'sessions'), ttlMs = 3000, now = Date.now } = {}) {
  let names = new Map();
  let readAt = -Infinity;

  function refresh() {
    const next = new Map();
    let files = [];
    try { files = readdirSync(dir); } catch { /* 폴더가 없으면 빈 목록 */ }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const o = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (typeof o.sessionId === 'string' && typeof o.name === 'string' && o.name) next.set(o.sessionId, o.name);
      } catch { /* 깨진 파일은 무시 */ }
    }
    names = next;
    readAt = now();
  }

  return {
    nameOf(sessionId) {
      const age = now() - readAt;
      if (age > ttlMs || (!names.has(sessionId) && age > MIN_REREAD_MS)) refresh();
      return names.get(sessionId);
    },
  };
}
