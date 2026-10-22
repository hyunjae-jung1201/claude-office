// 검토 실행 관리: 저장소별 중복 방지, 전체 동시 실행 제한, 일일 한도, 역할별 실행과 결과 저장.
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { aggregateVerdict, countConcerns, parseRoleOutput } from './parse.js';
import { buildDiff, buildEditsBundle, buildPrompt } from './context.js';
import { rolesFor } from './loader.js';

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.kts', '.c', '.cc', '.cpp', '.h', '.hpp', '.go', '.rs', '.sh', '.rb', '.php', '.cs', '.swift', '.m', '.sql', '.html', '.css', '.vue', '.svelte']);
const DOC_EXT = new Set(['.md', '.txt', '.rst', '.adoc']);
const UI_EXT = new Set(['.html', '.htm', '.css', '.scss', '.jsx', '.tsx', '.vue', '.svelte']);
const MIN = 60_000;

const hasKind = (files, set) => files.some((f) => set.has(extname(f).toLowerCase()));
const matchesWhen = (role, files) => role.when === 'always' || (role.when === 'code' && hasKind(files, CODE_EXT)) || (role.when === 'docs' && hasKind(files, DOC_EXT)) || (role.when === 'ui' && hasKind(files, UI_EXT));

export async function defaultBuildBundle(job) {
  if (job.edits) return buildEditsBundle(job);
  const { diff, truncated, stats, excluded } = await buildDiff(job.repoRoot, job.files, { base: job.baseSha });
  return { repoRoot: job.repoRoot, repoName: basename(job.repoRoot), requests: job.requests, lastResponse: job.lastResponse, files: job.files, diff, truncated, stats, excluded };
}

export function createScheduler({ config, roles, store, run, buildBundle = defaultBuildBundle, resolveTeam, emit, now = Date.now, concurrency = 3 }) {
  const running = new Set(); // 실행 중인 저장소
  const dirty = new Map(); // 실행 중에 새로 들어온 요청(저장소 -> 합쳐진 job)
  const inflight = new Set(); // idle() 용
  let active = 0;
  const waiters = [];
  let closed = false;

  const acquire = () => new Promise((resolve) => {
    const go = () => { active++; resolve(); };
    if (active < concurrency) go(); else waiters.push(go);
  });
  const release = () => { active--; waiters.shift()?.(); };

  const safeEmit = (e) => { try { emit(e); } catch { /* 화면 쪽 오류가 검토를 멈추지 않게 */ } };

  async function review(job) {
    const team = resolveTeam?.(job);
    const base = { repoRoot: job.repoRoot, team };
    let bundle;
    try { bundle = await buildBundle(job); } catch { safeEmit({ type: 'skipped', ...base, reason: 'error' }); return; }

    // 바뀐 내용이 전혀 없으면(예: 편집이 바로 되돌려진 경우) 역할자를 돌리지 않는다
    if (!bundle.diff && !bundle.stats && !bundle.truncated && !(bundle.excluded?.length)) { safeEmit({ type: 'skipped', ...base, reason: 'no-changes' }); return; }

    const selected = rolesFor(config, job.repoRoot, team).map((id) => roles.get(id)).filter(Boolean).filter((r) => matchesWhen(r, job.files));
    if (selected.length === 0) { safeEmit({ type: 'skipped', ...base, reason: 'no-roles' }); return; }
    if (store.counter.used() + selected.length > config.roles.dailyLimit) { safeEmit({ type: 'skipped', ...base, reason: 'limit' }); return; }

    const startedAt = now();
    safeEmit({ type: 'start', ...base, repoName: bundle.repoName, roles: selected.map((r) => ({ id: r.id, name: r.name, color: r.color })) });

    const results = await Promise.all(selected.map(async (role) => {
      await acquire();
      const t0 = now();
      try {
        safeEmit({ type: 'role', ...base, roleId: role.id, status: 'running' });
        let result;
        try {
          result = parseRoleOutput(await run({ role, prompt: buildPrompt(role, bundle), repoRoot: job.repoRoot }), role.id);
        } catch (e) {
          result = { roleId: role.id, verdict: 'failed', summary: '', findings: [], error: String(e.message ?? e).slice(0, 200) };
        }
        result = { ...result, roleName: role.name, durationMs: now() - t0 };
        safeEmit({ type: 'role', ...base, roleId: role.id, status: result.verdict === 'failed' ? 'failed' : 'done', summary: result.summary });
        return result;
      } finally {
        release();
      }
    }));

    if (closed) return; // 서버가 종료되는 중이면 결과를 버린다
    const finishedAt = now();
    const review = {
      id: randomUUID().slice(0, 8), repoRoot: job.repoRoot, repoName: bundle.repoName, team, startedAt, finishedAt,
      verdict: aggregateVerdict(results), concerns: countConcerns(results), results, files: job.files,
    };
    store.save(review);
    store.counter.add(selected.length);
    safeEmit({ type: 'done', ...base, review, sessionId: job.sessionId });
  }

  async function process(job) {
    if (closed) return;
    if (running.has(job.repoRoot)) {
      const prev = dirty.get(job.repoRoot);
      dirty.set(job.repoRoot, prev ? { ...job, files: [...new Set([...prev.files, ...job.files])], baseSha: prev.baseSha ?? job.baseSha, ...(prev.edits || job.edits ? { edits: [...(prev.edits ?? []), ...(job.edits ?? [])].slice(-100) } : {}) } : job);
      return;
    }
    running.add(job.repoRoot);
    const startedAt = now();
    try {
      await review(job);
    } catch { /* 한 검토의 예기치 못한 오류가 다른 검토를 막지 않게 */ } finally {
      running.delete(job.repoRoot);
    }
    const again = dirty.get(job.repoRoot);
    if (again && !closed) {
      dirty.delete(job.repoRoot);
      const cooldown = (config.roles.projects?.[job.repoRoot]?.cooldownMinutes ?? config.roles.cooldownMinutes) * MIN;
      const delay = Math.max(0, cooldown - (now() - startedAt));
      const p = new Promise((resolve) => {
        const timer = setTimeout(() => { submit(again); resolve(); }, delay);
        timer.unref?.();
      });
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
  }

  function submit(job) {
    const p = process(job);
    inflight.add(p);
    p.finally(() => inflight.delete(p));
  }

  return {
    submit,
    async idle() {
      while (inflight.size) await Promise.all([...inflight]);
    },
    close() { closed = true; },
    stats: () => ({ running: running.size, queued: waiters.length, dailyUsed: store.counter.used(), limitReached: store.counter.used() >= config.roles.dailyLimit }),
  };
}
