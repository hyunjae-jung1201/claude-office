// 팀에 지정한 테스트 명령(testCommand)을 서버가 직접 실행하고, 결과를 역할자에게 줄 수 있게 요약한다.
// 사용자가 config 에 직접 적은 명령만 실행한다(셸을 거치지 않고 인자 배열로 실행, 환경변수는 허용 목록 + CI=1).
import { spawn } from 'node:child_process';
import { minimalEnv } from '../env.js';
import { maskSecrets } from '../mask.js';

const KEEP_CHARS = 64 * 1024;
const TAIL_CHARS = 3000;
const DEFAULT_TIMEOUT_MS = 120_000;

export function runTests({ command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, signal, spawnFn = spawn }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const label = command.join(' ').slice(0, 200);
    let finished = false;
    let buf = '';
    let timedOut = false;
    let aborted = false;
    let child = null;
    const finish = (exitCode, extra = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const output = maskSecrets(buf + extra).slice(-TAIL_CHARS);
      resolve({ command: label, ok: exitCode === 0 && !timedOut && !aborted, exitCode, timedOut, ...(aborted ? { aborted: true } : {}), durationMs: Date.now() - t0, output });
    };
    const killTree = () => {
      if (!child?.pid) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* 이미 끝남 */ } }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 끝남 */ } }, 2000).unref?.();
      setTimeout(() => finish(null), 3000).unref?.(); // 종료 통지가 없어도 결과는 돌려준다
    };
    const onAbort = () => { aborted = true; killTree(); };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    timer.unref?.();

    if (signal?.aborted) { aborted = true; return finish(null, '중단됨'); }
    try {
      child = spawnFn(command[0], command.slice(1), { cwd, env: minimalEnv({ CI: '1', CLAUDE_OFFICE_ROLE: '1' }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) { return finish(null, `실행 실패: ${e.message}`); }
    signal?.addEventListener('abort', onAbort, { once: true });
    const onData = (d) => { buf = (buf + d).slice(-KEEP_CHARS); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => finish(null, `실행 실패: ${e.message}`));
    child.on('close', (code) => finish(code));
  });
}
