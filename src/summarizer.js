import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { minimalEnv } from './env.js';
import { maskSecrets } from './mask.js';
import { ruleLabel } from './labels.js';

const LIMIT = 20;
const TIMEOUT_MS = 8000;

const fit = (s) => (s.length > LIMIT ? s.slice(0, LIMIT - 1) + '…' : s);

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}


// 요약기가 띄우는 claude: 전용 비공개 폴더(0700)에서 실행하고, 어떤 설정 파일도 읽지 않으며, 환경변수는 최소만 넘긴다.
let workDir;
export function buildSpawn(prompt) {
  workDir ??= mkdtempSync(join(tmpdir(), 'claude-office-'));
  const env = minimalEnv({ CLAUDE_OFFICE_SUMMARIZER: '1' });
  return {
    args: ['-p', prompt, '--model', 'haiku', '--setting-sources', '', '--tools', '', '--no-session-persistence'],
    options: { cwd: workDir, env, stdio: ['ignore', 'pipe', 'ignore'] },
  };
}

// 헤드리스 claude로 한 줄 요약. hook이 재귀하지 않도록 환경변수로 표시한다(hook.js가 무시).
export function defaultRun(prompt) {
  return new Promise((resolve, reject) => {
    const { args, options } = buildSpawn(prompt);
    const child = spawn('claude', args, { ...options, timeout: TIMEOUT_MS + 2000, killSignal: 'SIGTERM' }); // 응답 대기가 끝난 뒤에도 남지 않게 프로세스를 끝낸다
    let out = '';
    child.stdout.on('data', (c) => { if (out.length < 4000) out += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}`))));
  });
}

export function createSummarizer({ run = defaultRun, minIntervalMs = 5000, now = Date.now } = {}) {
  const lastCall = new Map();

  return {
    async summarize(ev) {
      const fallback = ruleLabel(ev);
      if (ev.type === 'wait' || !ev.category || !ev.detail) return fallback;

      const key = `${ev.cwd}|${ev.category}`;
      const t = now();
      if (lastCall.has(key) && t - lastCall.get(key) < minIntervalMs) return fallback;
      if (lastCall.size > 500) lastCall.clear(); // 오래된 키가 쌓이지 않게
      lastCall.set(key, t);

      const prompt =
        '다음은 AI 코딩 에이전트가 방금 시작한 작업이다. 지금 하는 일을 한국어 15자 안팎의 짧은 한 줄로만 요약해라. 파일 이름은 쓰지 말고 무엇을 위한 일인지 말해라. ' +
        `예: 학습 데이터 내려받는 중 / 모델 파일 확인 중. 설명이나 따옴표 없이 문장만 답해라. 작업 종류: ${ev.category}. 내용: ${maskSecrets(ev.detail)}`;
      try {
        const text = await withTimeout(run(prompt), TIMEOUT_MS);
        const line = text?.replace(/\s+/g, ' ').trim();
        return line ? fit(line) : fallback;
      } catch {
        return fallback;
      }
    },
  };
}
