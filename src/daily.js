// 하루 동안 팀별로 한 일(요청·수정한 파일·도구·역할자 검토)을 모아, 작업 로그 초안(자동기록.md)을 날짜 폴더에 쓴다.
// 직접 쓰는 작업 로그와는 별도 파일이다(덮어쓰지 않는다). 쓸 때마다 기록원 아바타(문서실)가 잠깐 나타난다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskSecrets } from './mask.js';
import { kstDate } from './roles/store.js';

const KST_MS = 9 * 3600 * 1000;
const PROMPTS_MAX = 15;
const FILES_LISTED = 30;
const FILES_KEPT = 500;
const PROMPT_CHARS = 120;
const VERDICT_LABEL = { ok: '통과', block: '중단 권고', failed: '검토 실패' };

const hhmm = (ms) => new Date(ms + KST_MS).toISOString().slice(11, 16);
const oneLine = (s, n) => maskSecrets(String(s ?? '').slice(0, n * 2)).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function createDailyLog({ dir, dataDir, now = Date.now, emit = () => {}, intervalMs = 120_000 }) {
  let day = null; // { date, teams: { [name]: { root, first, last, prompts, files, tools, reviews } } }
  const dirty = new Set();
  const dataFile = (date) => join(dataDir, `daily-${date}.json`);

  function load(date) {
    try {
      const o = JSON.parse(readFileSync(dataFile(date), 'utf8'));
      if (o?.date === date && o.teams && typeof o.teams === 'object') return o;
    } catch { /* 처음이거나 깨진 파일: 새로 시작 */ }
    return { date, teams: {} };
  }

  function dayNow() {
    const date = kstDate(now());
    if (day?.date !== date) {
      if (day && dirty.size) flush();
      day = load(date);
      dirty.clear();
    }
    return day;
  }

  const teamOf = (project) => {
    const d = dayNow();
    return (d.teams[project.name] ??= { root: project.path, first: now(), last: now(), prompts: [], files: {}, tools: {}, reviews: [] });
  };

  function record(project, ev) {
    if (!project?.name || !ev) return;
    if (ev.type === 'prompt' && ev.promptText) {
      const t = teamOf(project);
      const text = oneLine(ev.promptText, PROMPT_CHARS);
      if (text && t.prompts.at(-1) !== text && t.prompts.length < PROMPTS_MAX) t.prompts.push(text);
      t.last = now();
      dirty.add(project.name);
    } else if (ev.type === 'tool' && ev.toolName) {
      const t = teamOf(project);
      if (Object.hasOwn(t.tools, ev.toolName) || Object.keys(t.tools).length < 200) t.tools[ev.toolName] = (Object.hasOwn(t.tools, ev.toolName) ? t.tools[ev.toolName] : 0) + 1;
      if (ev.filePath && (Object.hasOwn(t.files, ev.filePath) || Object.keys(t.files).length < FILES_KEPT)) t.files[ev.filePath] = (Object.hasOwn(t.files, ev.filePath) ? t.files[ev.filePath] : 0) + 1;
      t.last = now();
      dirty.add(project.name);
    }
  }

  function recordReview(teamName, review) {
    if (!teamName || !review) return;
    const d = dayNow();
    const t = d.teams[teamName];
    if (!t) return; // 오늘 아무 기록도 없는 팀(예: 복원된 검토)은 건너뛴다
    const bad = (review.results ?? []).find((r) => r.verdict !== 'ok');
    t.reviews.push({
      at: review.finishedAt ?? now(), verdict: review.verdict, concerns: review.concerns ?? 0, summary: oneLine(bad?.summary || '문제 없음', 80),
      ...(review.tests ? { tests: { command: oneLine(review.tests.command, 80), ok: Boolean(review.tests.ok), exitCode: review.tests.exitCode ?? null, timedOut: Boolean(review.tests.timedOut) } } : {}),
    });
    if (t.reviews.length > 30) t.reviews.shift();
    t.last = Math.max(t.last, review.finishedAt ?? 0);
    dirty.add(teamName);
  }

  function render(d) {
    const lines = [`# ${d.date} 자동 기록 (Claude Office)`, '', `> 자동으로 모은 초안입니다. 직접 쓴 작업 로그와 별개입니다. 마지막 갱신 ${hhmm(now())} KST`, ''];
    for (const [name, t] of Object.entries(d.teams)) {
      lines.push(`## ${name}`, `- 작업 시간: ${hhmm(t.first)} ~ ${hhmm(t.last)}`);
      if (t.prompts.length) lines.push(`- 요청 (${t.prompts.length}건)`, ...t.prompts.map((p, i) => `  ${i + 1}. ${p}`));
      const files = Object.entries(t.files).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (files.length) {
        const rel = (f) => (t.root && f.startsWith(`${t.root}/`) ? f.slice(t.root.length + 1) : f);
        lines.push(`- 수정한 파일 (${files.length}개)`, ...files.slice(0, FILES_LISTED).map(([f, n]) => `  - ${oneLine(rel(f), 200)} ×${n}`));
        if (files.length > FILES_LISTED) lines.push(`  - 외 ${files.length - FILES_LISTED}개`);
      }
      const tools = Object.entries(t.tools).sort((a, b) => a[0].localeCompare(b[0]));
      if (tools.length) lines.push(`- 도구 사용: ${tools.map(([k, n]) => `${oneLine(k, 30)} ${n}`).join(', ')}`);
      if (t.reviews.length) {
        lines.push('- 역할자 검토');
        for (const r of t.reviews) {
          const label = r.verdict === 'concern' ? `우려 ${r.concerns}` : (VERDICT_LABEL[r.verdict] ?? r.verdict);
          lines.push(`  - ${hhmm(r.at)} ${label} — ${r.summary}`);
          if (r.tests) lines.push(`    - 테스트 ${r.tests.timedOut ? '시간 초과' : r.tests.ok ? '통과' : '실패'} (${r.tests.command}${!r.tests.ok && !r.tests.timedOut ? `, 종료 코드 ${r.tests.exitCode}` : ''})`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  const job = (team, status, label, extra = {}) => emit({ type: 'job', team, id: 'recorder', status, label, ...extra });

  function flush() {
    if (!day || dirty.size === 0) return;
    const d = day;
    const teams = [...dirty];
    for (const team of teams) job(team, 'running', '작업 일지 정리 중', { name: '기록원', color: '#c76bb0', room: 'docs' });
    try {
      mkdirSync(join(dir, d.date), { recursive: true });
      const file = join(dir, d.date, '자동기록.md');
      writeFileSync(`${file}.tmp`, render(d));
      renameSync(`${file}.tmp`, file);
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      writeFileSync(`${dataFile(d.date)}.tmp`, JSON.stringify(d), { mode: 0o600 });
      renameSync(`${dataFile(d.date)}.tmp`, dataFile(d.date));
      dirty.clear();
      for (const team of teams) job(team, 'done', '일지 갱신');
    } catch {
      for (const team of teams) job(team, 'failed', '일지 기록 실패'); // dirty 를 남겨 다음 주기에 다시 시도한다
    }
  }

  const timer = setInterval(() => { try { flush(); } catch { /* 다음 주기에 */ } }, intervalMs);
  timer.unref?.();

  return {
    record, recordReview, flush,
    close() { clearInterval(timer); try { flush(); } catch { /* 종료 중 */ } },
  };
}
