// 역할자(claude -p)의 출력을 RoleResult 로 바꾼다. 어떤 입력에도 예외를 던지지 않는다.
import { maskSecrets } from '../mask.js';

const VERDICTS = new Set(['ok', 'concern', 'block']);
const SEVERITIES = new Set(['info', 'minor', 'major', 'critical']);
const SUMMARY_LIMIT = 80;
const TEXT_LIMIT = 300;
const MAX_CANDIDATES = 20;

const clean = (v, limit) => maskSecrets(String(v).replace(/\s+/g, ' ').trim()).slice(0, limit);

// text 안에서 문자열·이스케이프를 고려해 균형이 맞는 {…} 구간들을 앞에서부터 차례로 시도해 첫 JSON 객체를 돌려준다.
function extractJson(text) {
  let tried = 0;
  for (let start = text.indexOf('{'); start >= 0 && tried < MAX_CANDIDATES; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        tried++;
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === 'object' && !Array.isArray(v)) return v;
        } catch { /* 다음 후보 */ }
        break;
      }
    }
  }
  return null;
}

const failed = (roleId, error, text) => ({
  roleId, verdict: 'failed', summary: typeof text === 'string' ? clean(text, 60) : '', findings: [], error,
});

export function parseRoleOutput(text, roleId) {
  if (typeof text !== 'string' || !text.trim()) return failed(roleId, '빈 응답');
  const obj = extractJson(text);
  if (!obj) return failed(roleId, '형식 오류', text);

  const findings = Array.isArray(obj.findings)
    ? obj.findings
        .filter((f) => f && typeof f === 'object' && typeof f.text === 'string' && f.text.trim())
        .map((f) => {
          const out = { severity: SEVERITIES.has(f.severity) ? f.severity : 'minor', text: clean(f.text, TEXT_LIMIT) };
          if (typeof f.file === 'string' && f.file) out.file = clean(f.file, 200);
          if (Number.isInteger(f.line) && f.line > 0) out.line = f.line;
          return out;
        })
    : [];
  let verdict = VERDICTS.has(obj.verdict) ? obj.verdict : 'concern';
  if (verdict === 'ok' && findings.some((f) => f.severity === 'major' || f.severity === 'critical')) verdict = 'concern';
  const summary = typeof obj.summary === 'string' && obj.summary.trim()
    ? clean(obj.summary, SUMMARY_LIMIT)
    : verdict === 'ok' ? '문제 없음' : clean(findings[0]?.text ?? '확인 필요', SUMMARY_LIMIT);
  return { roleId, verdict, summary, findings };
}

export function aggregateVerdict(results) {
  if (results.some((r) => r.verdict === 'block')) return 'block';
  if (results.some((r) => r.verdict === 'concern' || r.verdict === 'failed')) return 'concern';
  return 'ok';
}

export function countConcerns(results) {
  let n = 0;
  for (const r of results) {
    if (r.verdict === 'ok') continue;
    if (r.verdict === 'failed') n += 1;
    else n += Math.max(1, r.findings.filter((f) => f.severity !== 'info').length);
  }
  return n;
}
