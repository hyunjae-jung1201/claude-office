// 로컬 인증 토큰: hook·ingest 가 서버(/event, /ingest)로 보낼 때 함께 보내는 비밀값.
// 파일(기본 ~/.claude-office/token, 0600)에 두어 같은 계정만 읽을 수 있다. 같은 PC 의 다른 계정이나 이 파일을 못 읽는 프로세스의 위조 이벤트를 막는다.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const TOKEN_HEADER = 'x-office-token';
export const tokenPath = () => process.env.CLAUDE_OFFICE_TOKEN_FILE || join(homedir(), '.claude-office', 'token');

// 클라이언트(hook, ingest, demo): 읽기만 한다. 없으면 null(서버가 인증을 켜지 않은 상태)
export function readToken(path = tokenPath()) {
  try { return readFileSync(path, 'utf8').trim() || null; } catch { return null; }
}

// 서버: 없으면 만든다
export function loadOrCreateToken(path = tokenPath()) {
  const existing = readToken(path);
  if (existing) return existing;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  writeFileSync(path, token + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

export function tokenMatches(expected, given) {
  if (typeof expected !== 'string' || typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
