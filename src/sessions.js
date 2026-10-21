// Claude Code가 실행 중인 세션을 적어 두는 ~/.claude/sessions/<pid>.json 에서 세션 이름을 찾는다(읽기 전용).
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MIN_REREAD_MS = 50; // 모르는 세션이 계속 와도 폴더를 이 간격보다 자주 읽지 않는다

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

export function createSessionRegistry({ dir = join(homedir(), '.claude', 'sessions'), ttlMs = 3000, now = Date.now, isAlive = pidAlive } = {}) {
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
    // 실제로 실행 중인 세션(프로세스가 살아 있는 것)의 이름·폴더·상태. status: idle | busy | shell(응답은 끝났지만 백그라운드 명령 실행 중) 등.
    liveSessions() {
      const out = [];
      let files = [];
      try { files = readdirSync(dir); } catch { return out; }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const o = JSON.parse(readFileSync(join(dir, f), 'utf8'));
          if (typeof o.sessionId !== 'string' || !Number.isInteger(o.pid) || !isAlive(o.pid)) continue;
          const e = { sessionId: o.sessionId };
          if (typeof o.name === 'string' && o.name) e.name = o.name;
          if (typeof o.cwd === 'string' && o.cwd) e.cwd = o.cwd;
          if (typeof o.status === 'string' && o.status) e.status = o.status;
          out.push(e);
        } catch { /* 깨진 파일은 무시 */ }
      }
      return out;
    },

    nameOf(sessionId) {
      const age = now() - readAt;
      if (age > ttlMs || (!names.has(sessionId) && age > MIN_REREAD_MS)) refresh();
      return names.get(sessionId);
    },
  };
}
