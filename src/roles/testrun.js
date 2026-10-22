// 팀에 지정한 테스트 명령(testCommand)을 서버가 직접 실행하고, 결과를 역할자에게 줄 수 있게 요약한다.
// 사용자가 config 에 직접 적은 명령만 실행한다(셸을 거치지 않고 인자 배열로 실행, 환경변수는 허용 목록 + CI=1).
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { sshBaseArgs } from '../remote.js';
import { minimalEnv } from '../env.js';
import { maskSecrets } from '../mask.js';

const KEEP_CHARS = 64 * 1024;
const TAIL_CHARS = 3000;
const DEFAULT_TIMEOUT_MS = 120_000;

export function runTests({ command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, signal, spawnFn = spawn, label: shown }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const label = (shown ?? command.join(' ')).slice(0, 200);
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

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`; // 셸이 어떤 문자도 해석하지 못하게 작은따옴표로 감싼다

// 원격 PC 에서 실행할 한 줄 명령: 팀 폴더로 이동 → CI 환경 + 원격 쪽 timeout 으로 실행
export function buildRemoteTestCommand({ cwd, command, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return `cd ${shq(cwd)} && exec env CI=1 CLAUDE_OFFICE_ROLE=1 timeout -k 5 ${Math.max(1, Math.ceil(timeoutMs / 1000))} ${command.map(shq).join(' ')}`;
}

// 원격 PC(remotes[])의 팀 폴더에서 테스트를 실행한다(ssh, 키 전용). 이 PC 에서는 아무 것도 실행되지 않는다.
export async function runRemoteTests({ remote, command, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, signal, spawnFn = spawn }) {
  const r = await runTests({
    command: ['ssh', ...sshBaseArgs(remote), buildRemoteTestCommand({ cwd, command, timeoutMs })],
    cwd: tmpdir(), timeoutMs: timeoutMs + 20_000, signal, spawnFn, label: `${remote.name}: ${command.join(' ')}`,
  });
  if (r.exitCode === 124) return { ...r, ok: false, timedOut: true }; // 원격 timeout 이 끝냄
  if (r.exitCode === 255) return { ...r, ok: false, output: `SSH 연결 실패\n${r.output}`.slice(-3000) };
  return r;
}
