// 검토 보고서 파일과 일일 역할자 실행 카운터. 프로젝트 폴더가 아니라 중앙 폴더(data/reviews)에 저장한다.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { maskSecrets } from '../mask.js';

const KST_MS = 9 * 3600 * 1000;
const VERDICT_LABEL = { ok: '통과', concern: '우려', block: '중단 권고', failed: '검토 실패' };

export const kstDate = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);
const kstTime = (ms) => new Date(ms + KST_MS).toISOString().replace('T', ' ').slice(0, 16) + ' KST';

const maskDeep = (v) => {
  if (typeof v === 'string') return maskSecrets(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
};

// 쓰다 멈춰도 반쪽 파일이 남지 않게: 임시 파일에 쓴 뒤 이름을 바꾼다(.tmp 는 목록에서 제외된다)
function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function renderLatestMd(reviews) {
  const newest = reviews[0];
  const lines = [`# ${newest.repoName} 최근 검토`, '', `저장소: ${newest.repoRoot}`, `마지막 검토: ${kstTime(newest.finishedAt)}`, ''];
  const seen = new Set();
  for (const r of reviews) {
    for (const res of r.results) {
      if (seen.has(res.roleId)) continue;
      seen.add(res.roleId);
      lines.push(`## ${res.roleName ?? res.roleId} — ${VERDICT_LABEL[res.verdict] ?? res.verdict} (${kstTime(r.finishedAt)})`);
      lines.push(res.summary ? `요약: ${res.summary}` : '', ...(res.error ? [`사유: ${res.error}`] : []));
      for (const f of res.findings) lines.push(`- [${f.severity}] ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''} — ` : ''}${f.text}`);
      lines.push('');
    }
  }
  return maskSecrets(lines.join('\n'));
}

export function createReviewStore({ dir, now = Date.now, keep = 200 }) {
  ensureDir(dir);
  // 같은 경로라도 다른 PC(host)의 것은 따로 둔다
  const repoDir = (repoRoot, host) => join(dir, `${basename(repoRoot).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'repo'}-${createHash('sha1').update(host ? `${host}:${repoRoot}` : repoRoot).digest('hex').slice(0, 8)}`);
  const filesOf = (d) => {
    try { return readdirSync(d).filter((f) => f.endsWith('.json')).sort().reverse(); } catch { return []; }
  };
  // 형식이 어긋난 파일(JSON이지만 보고서가 아닌 것 포함)은 없는 것으로 본다
  const read = (d, f) => {
    try {
      const r = JSON.parse(readFileSync(join(d, f), 'utf8'));
      return r && typeof r === 'object' && Array.isArray(r.results) && Number.isFinite(r.finishedAt) && typeof r.repoRoot === 'string' ? r : null;
    } catch { return null; }
  };

  function forRepo(repoRoot, limit = 20, host) {
    const d = repoDir(repoRoot, host);
    return filesOf(d).slice(0, limit).map((f) => read(d, f)).filter(Boolean);
  }

  // 사용자가 보고서에서 "확인"한 검토 id(재시작해도 유지). 확인된 검토의 배지는 다시 나타나지 않는다.
  const ackFile = join(dir, '_acked.json');
  const acked = {
    ids() {
      try { const a = JSON.parse(readFileSync(ackFile, 'utf8')); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; }
    },
    add(id) {
      const next = [...new Set([...acked.ids(), id])].slice(-500);
      writeAtomic(ackFile, JSON.stringify(next));
    },
  };

  const counterFile = join(dir, '_counter.json');
  const counter = {
    used() {
      try {
        const o = JSON.parse(readFileSync(counterFile, 'utf8'));
        return o.date === kstDate(now()) && Number.isFinite(o.used) ? o.used : 0;
      } catch { return 0; }
    },
    add(n) {
      const next = { date: kstDate(now()), used: Math.max(0, counter.used() + n) };
      writeFileSync(`${counterFile}.tmp`, JSON.stringify(next), { mode: 0o600 });
      renameSync(`${counterFile}.tmp`, counterFile);
    },
  };

  return {
    counter,
    acked,
    forRepo,
    latestFor: (repoRoot, host) => forRepo(repoRoot, 1, host)[0] ?? null,
    save(review) {
      const safe = { ...review, results: maskDeep(review.results), notes: review.notes ? maskDeep(review.notes) : undefined };
      const d = repoDir(review.repoRoot, review.host);
      ensureDir(d);
      writeAtomic(join(d, `${review.finishedAt}-${review.id}.json`), JSON.stringify(safe));
      for (const old of filesOf(d).slice(keep)) { try { unlinkSync(join(d, old)); } catch { /* 이미 없음 */ } }
      const recent = forRepo(review.repoRoot, 30, review.host);
      writeAtomic(join(d, 'latest.md'), renderLatestMd(recent));
    },
    list(limit = 20) {
      const all = [];
      let dirs = [];
      try { dirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { /* 없음 */ }
      for (const e of dirs) {
        const d = join(dir, e.name);
        for (const f of filesOf(d).slice(0, limit)) { const r = read(d, f); if (r) all.push(r); }
      }
      return all.sort((a, b) => b.finishedAt - a.finishedAt).slice(0, limit);
    },
  };
}
