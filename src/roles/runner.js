// 역할자 실행: 읽기 전용 `claude -p`. 파일 수정·명령 실행은 허용 목록(Read/Grep/Glob)과 거부 목록으로 이중으로 막는다.
import { spawn } from 'node:child_process';
import { minimalEnv } from '../env.js';

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT = 8 * 1024 * 1024;

const DENIED_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'Agent'];
// 비밀값이 있을 만한 경로는 읽기 도구로도 열지 못하게 한다
const SENSITIVE_GLOBS = ['**/.env*', '**/*.pem', '**/*.key', '**/id_*', '**/.npmrc', '**/.netrc', '**/*secret*', '**/*credentials*', '~/.ssh/**', '~/.aws/**', '~/.gnupg/**'];
const DENY_READ = ['Read', 'Grep', 'Glob'].flatMap((tool) => SENSITIVE_GLOBS.map((g) => `${tool}(${g})`));

export function buildRoleSpawn(role, prompt, repoRoot) {
  return {
    args: [
      '-p', prompt,
      '--model', role.model,
      '--setting-sources', '', // 사용자 전역 설정·hook을 읽지 않는다
      '--allowedTools', ...role.tools,
      '--disallowedTools', ...DENIED_TOOLS, ...DENY_READ,
      '--no-session-persistence',
    ],
    options: { cwd: repoRoot, env: minimalEnv({ CLAUDE_OFFICE_ROLE: '1' }), stdio: ['ignore', 'pipe', 'pipe'] },
  };
}

export function runRole({ role, prompt, repoRoot, timeoutMs = DEFAULT_TIMEOUT_MS, spawnFn = spawn }) {
  return new Promise((resolve, reject) => {
    const { args, options } = buildRoleSpawn(role, prompt, repoRoot);
    const child = spawnFn('claude', args, options);
    const out = [];
    let size = 0;
    let err = '';
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref?.();
      finish(reject, new Error('시간 초과'));
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (d) => {
      if (size >= MAX_OUTPUT) return;
      const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
      out.push(size + buf.length > MAX_OUTPUT ? buf.subarray(0, MAX_OUTPUT - size) : buf);
      size += buf.length;
    });
    child.stderr?.on('data', (d) => { if (err.length < 400) err += String(d); });
    child.on('error', (e) => finish(reject, new Error(`실행 실패: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, Buffer.concat(out).toString('utf8'));
      else finish(reject, new Error(`실행 실패: 종료 코드 ${code}${err.trim() ? ` — ${err.trim().slice(0, 200)}` : ''}`));
    });
  });
}
