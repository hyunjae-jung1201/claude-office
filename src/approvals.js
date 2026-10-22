// 사무실 화면에서 승인·거절할 수 있는 "승인 대기" 목록. 훅이 /approval 로 요청을 보내 두고 기다리면, 화면에서 결정할 때(또는 시간이 지나면) 끝난다.
// 결정이 없으면(null) 훅은 아무것도 출력하지 않아 Claude Code 의 원래 승인 창이 그대로 쓰인다.
import { randomBytes } from 'node:crypto';
import { maskSecrets } from './mask.js';

const MAX_PENDING = 20;
const DETAIL_LIMIT = 1500;
const DENY_MESSAGE = '사무실 화면에서 거절했습니다';

export function createApprovals({ now = Date.now, waitMs = 45_000, onChange = () => {} } = {}) {
  const pending = new Map(); // id -> { id, sessionId, team, tool, detail, at, expiresAt, timer, resolve }

  function finish(id, result) {
    const p = pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(result);
    onChange();
    return true;
  }

  return {
    request({ sessionId, team, tool, detail }) {
      while (pending.size >= MAX_PENDING) finish(pending.keys().next().value, null); // 가장 오래된 것부터 포기
      const id = randomBytes(16).toString('hex');
      const at = now();
      const clean = maskSecrets(String(detail ?? '').slice(0, DETAIL_LIMIT * 2)).slice(0, DETAIL_LIMIT);
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      const timer = setTimeout(() => finish(id, null), waitMs);
      pending.set(id, { id, sessionId, team, tool: String(tool ?? '').slice(0, 60), detail: clean, at, expiresAt: at + waitMs, timer, resolve });
      onChange();
      return { id, promise };
    },
    decide(id, behavior) {
      if (behavior !== 'allow' && behavior !== 'deny') return false;
      return finish(id, behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: DENY_MESSAGE });
    },
    cancel: (id) => finish(id, null),
    cancelSession(sessionId) { for (const p of [...pending.values()]) if (p.sessionId === sessionId) finish(p.id, null); },
    list: () => [...pending.values()].map(({ id, team, tool, detail, at, expiresAt }) => ({ id, team, tool, detail, at, expiresAt })),
    close() { for (const id of [...pending.keys()]) finish(id, null); },
  };
}
