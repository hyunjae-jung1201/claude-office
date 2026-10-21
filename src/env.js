// 하위 claude 프로세스(요약기·역할자)에 넘기는 최소 환경변수. 나머지(키·토큰 등)는 전달하지 않는다.
const ALLOWLIST = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'];

export function minimalEnv(extra = {}) {
  const env = { ...extra };
  for (const k of ALLOWLIST) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}
