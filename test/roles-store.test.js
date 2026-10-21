import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewStore, kstDate } from '../src/roles/store.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'rev-store-'));
const result = (roleId, verdict, summary = 's', findings = []) => ({ roleId, roleName: roleId.toUpperCase(), verdict, summary, findings });
let seq = 0;
const review = (over = {}) => ({
  id: `id${++seq}`, repoRoot: '/work/app', repoName: 'app', team: 'T', startedAt: 1_000_000 + seq, finishedAt: 1_000_100 + seq,
  verdict: 'ok', concerns: 0, results: [result('pm', 'ok')], files: ['/work/app/a.js'], ...over,
});
const jsonFiles = (d) => readdirSync(d).filter((f) => f.endsWith('.json'));

test('저장한 검토를 list / forRepo / latestFor로 읽는다 (최근순)', () => {
  const s = createReviewStore({ dir: tmp() });
  const a = review({ finishedAt: 100 });
  const b = review({ finishedAt: 300 });
  const c = review({ repoRoot: '/work/other', repoName: 'other', finishedAt: 200 });
  [a, b, c].forEach((r) => s.save(r));
  assert.deepEqual(s.list().map((r) => r.id), [b.id, c.id, a.id]);
  assert.deepEqual(s.forRepo('/work/app').map((r) => r.id), [b.id, a.id]);
  assert.equal(s.latestFor('/work/app').id, b.id);
  assert.equal(s.latestFor('/nope'), null);
  assert.deepEqual(s.list(1).map((r) => r.id), [b.id]);
  assert.deepEqual(s.forRepo('/nope'), []);
});

test('저장소당 최근 200개만 남기고, 폴더는 0700', () => {
  const dir = tmp();
  const s = createReviewStore({ dir });
  for (let i = 0; i < 201; i++) s.save(review({ finishedAt: 1000 + i }));
  const repoDir = join(dir, readdirSync(dir).find((n) => n.startsWith('app-')));
  assert.equal(jsonFiles(repoDir).length, 200);
  assert.equal(s.forRepo('/work/app', 500).length, 200);
  assert.equal(s.forRepo('/work/app', 500)[199].finishedAt, 1001); // 가장 오래된 1개(1000)만 삭제
  assert.equal(statSync(repoDir).mode & 0o777, 0o700);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('이름이 같은 서로 다른 저장소 경로는 다른 폴더에 저장된다', () => {
  const dir = tmp();
  const s = createReviewStore({ dir });
  s.save(review({ repoRoot: '/a/app' }));
  s.save(review({ repoRoot: '/b/app' }));
  assert.equal(readdirSync(dir).filter((n) => n.startsWith('app-')).length, 2);
  assert.equal(s.forRepo('/a/app').length, 1);
});

test('latest.md: 역할마다 가장 최근 결과와 KST 시각, 비밀값 없음 (Review Focus 3)', () => {
  const dir = tmp();
  const s = createReviewStore({ dir });
  s.save(review({ finishedAt: Date.parse('2026-10-21T00:00:00Z'), results: [result('pm', 'ok', '요구사항 충족'), result('qa', 'concern', '빈 값 미처리', [{ severity: 'major', text: '빈 문자열 처리 없음', file: 'src/a.js', line: 3 }])] }));
  s.save(review({ finishedAt: Date.parse('2026-10-21T01:00:00Z'), results: [result('qa', 'concern', '키 노출 sk-abcdefghijklmnopqrstuvwx1234', [{ severity: 'critical', text: 'token=abcd1234efgh 가 코드에 있음' }])] }));
  const repoDir = join(dir, readdirSync(dir).find((n) => n.startsWith('app-')));
  const md = readFileSync(join(repoDir, 'latest.md'), 'utf8');
  assert.match(md, /PM/);
  assert.match(md, /요구사항 충족/);
  assert.match(md, /2026-10-21 10:00 KST/); // QA 최신 결과 시각(UTC 01:00)
  assert.match(md, /우려/);
  assert.ok(!md.includes('빈 값 미처리')); // QA는 더 최근 결과로 대체됨
  for (const f of [...jsonFiles(repoDir), 'latest.md']) {
    const text = readFileSync(join(repoDir, f), 'utf8');
    assert.ok(!text.includes('sk-abcdefghijklmnopqrstuvwx1234'), f);
    assert.ok(!text.includes('abcd1234efgh'), f);
  }
});

test('저장소 경로와 파일 목록은 마스킹으로 훼손되지 않는다', () => {
  const s = createReviewStore({ dir: tmp() });
  const root = '/work/0123456789abcdef0123456789abcdef/app';
  s.save(review({ repoRoot: root, files: [root + '/a.js'] }));
  assert.equal(s.latestFor(root).repoRoot, root);
  assert.deepEqual(s.latestFor(root).files, [root + '/a.js']);
});

test('일일 카운터: 합산, 재시작 후 유지, KST 자정에 초기화 (Review Focus 4)', () => {
  const dir = tmp();
  let t = Date.parse('2026-10-21T14:59:00Z'); // KST 23:59
  const s1 = createReviewStore({ dir, now: () => t });
  assert.equal(s1.counter.used(), 0);
  s1.counter.add(3);
  s1.counter.add(2);
  assert.equal(s1.counter.used(), 5);
  assert.equal(createReviewStore({ dir, now: () => t }).counter.used(), 5);
  t = Date.parse('2026-10-21T15:00:01Z'); // KST 다음 날 00:00
  assert.equal(s1.counter.used(), 0);
  s1.counter.add(1);
  assert.equal(createReviewStore({ dir, now: () => t }).counter.used(), 1);
  assert.equal(kstDate(Date.parse('2026-10-21T15:00:00Z')), '2026-10-22');
  assert.equal(kstDate(Date.parse('2026-10-21T14:59:59Z')), '2026-10-21');
});

test('깨진 카운터 파일에서도 오류 없이 0으로 시작하고 보고서 목록에 섞이지 않는다', () => {
  const dir = tmp();
  writeFileSync(join(dir, '_counter.json'), '{not json');
  const s = createReviewStore({ dir });
  assert.equal(s.counter.used(), 0);
  s.counter.add(2);
  assert.equal(s.counter.used(), 2);
  s.save(review());
  assert.equal(s.list().length, 1);
});
