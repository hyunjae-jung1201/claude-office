import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayKst, usageCommand, parseUsage, createUsageMonitor } from '../src/usage.js';
import { formatTokens, formatCost } from '../public/js/usage.js';

const CCUSAGE_OUT = JSON.stringify({
  daily: [
    { period: '2026-10-26', totalTokens: 100, totalCost: 1.5 },
    { period: '2026-10-27', totalTokens: 283_212_250, totalCost: 81.4012 },
  ],
  totals: { totalTokens: 283_212_350, totalCost: 82.9 },
});

test('todayKst 는 KST 기준 날짜를 준다 (UTC 자정 직전 = KST 다음날)', () => {
  // 2026-10-26 23:00 UTC = 2026-10-27 08:00 KST
  assert.equal(todayKst(Date.UTC(2026, 9, 26, 23, 0, 0)), '2026-10-27');
  assert.equal(todayKst(Date.UTC(2026, 9, 26, 10, 0, 0)), '2026-10-26');
});

test('usageCommand 는 nvm 로드 + ccusage 오늘치 JSON 호출을 담는다', () => {
  const cmd = usageCommand('2026-10-27');
  assert.ok(cmd.includes('nvm.sh'));
  assert.ok(cmd.includes('ccusage'));
  assert.ok(cmd.includes('--offline'));
  assert.ok(cmd.includes('--json'));
  assert.ok(cmd.includes('--timezone Asia/Seoul'));
  assert.ok(cmd.includes('--since 20261027'));
});

test('parseUsage 는 오늘 행의 토큰·비용을 준다', () => {
  assert.deepEqual(parseUsage(CCUSAGE_OUT, '2026-10-27'), { tokens: 283_212_250, cost: 81.4012 });
});

test('parseUsage 는 오늘 행이 없으면 0을 준다 (아직 사용 전)', () => {
  assert.deepEqual(parseUsage(CCUSAGE_OUT, '2026-10-28'), { tokens: 0, cost: 0 });
});

test('parseUsage 는 잘못된 JSON이면 던진다', () => {
  assert.throws(() => parseUsage('npm warn something', '2026-10-27'));
});

test('모니터: 로컬·원격 소스를 모아 onUpdate 로 알린다', async () => {
  const updates = [];
  const m = createUsageMonitor({
    sources: [{ name: 'PC1', local: true }, { name: 'PC2', ssh: 'u@h' }],
    run: async (source) => (source.local ? CCUSAGE_OUT : JSON.stringify({ daily: [{ period: '2026-10-27', totalTokens: 7, totalCost: 0.2 }] })),
    now: () => Date.UTC(2026, 9, 27, 3, 0, 0),
    onUpdate: (rows) => updates.push(rows),
  });
  await m.refresh();
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], [
    { name: 'PC1', tokens: 283_212_250, cost: 81.4012, at: Date.UTC(2026, 9, 27, 3, 0, 0) },
    { name: 'PC2', tokens: 7, cost: 0.2, at: Date.UTC(2026, 9, 27, 3, 0, 0) },
  ]);
  assert.deepEqual(m.rows(), updates[0]);
});

test('모니터: 소스 하나가 실패하면 그 행만 error 로 표시한다', async () => {
  const T = Date.UTC(2026, 9, 27, 3, 0, 0);
  const m = createUsageMonitor({
    sources: [{ name: 'PC1', local: true }, { name: 'PC2', ssh: 'u@h' }],
    run: async (source) => { if (!source.local) throw new Error('ssh down'); return CCUSAGE_OUT; },
    now: () => T,
    log: { warn: () => {} },
  });
  await m.refresh();
  assert.deepEqual(m.rows(), [
    { name: 'PC1', tokens: 283_212_250, cost: 81.4012, at: T },
    { name: 'PC2', error: true, at: T },
  ]);
});

test('모니터: importRows 가 주는 외부 행을 뒤에 합친다 (같은 이름은 자기 행 우선)', async () => {
  const T = Date.UTC(2026, 9, 27, 3, 0, 0);
  const m = createUsageMonitor({
    sources: [{ name: 'PC2', local: true }],
    run: async () => JSON.stringify({ daily: [{ period: '2026-10-27', totalTokens: 7, totalCost: 0.2 }] }),
    importRows: async () => [
      { name: 'PC1', tokens: 99, cost: 3.3, at: 500 },
      { name: 'PC2', tokens: 1, cost: 0.1, at: 500 }, // 자기 이름은 무시
    ],
    now: () => T,
  });
  await m.refresh();
  assert.deepEqual(m.rows(), [
    { name: 'PC2', tokens: 7, cost: 0.2, at: T },
    { name: 'PC1', tokens: 99, cost: 3.3, at: 500 },
  ]);
});

test('모니터: refresh 후 push 로 현재 행을 내보낸다 (push 실패는 삼킨다)', async () => {
  const pushed = [];
  const m = createUsageMonitor({
    sources: [{ name: 'PC1', local: true }],
    run: async () => CCUSAGE_OUT,
    push: async (rows) => { pushed.push(rows); throw new Error('ssh down'); },
    now: () => Date.UTC(2026, 9, 27, 3, 0, 0),
    log: { warn: () => {} },
  });
  await m.refresh();
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0][0].name, 'PC1');
});

test('formatTokens: 1만 미만은 그대로, 그 위는 K/M/B 한 자리', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(9_999), '9999');
  assert.equal(formatTokens(12_345), '12.3K');
  assert.equal(formatTokens(283_212_250), '283.2M');
  assert.equal(formatTokens(1_038_500_569), '1.0B');
});

test('formatCost: 달러 두 자리', () => {
  assert.equal(formatCost(81.4012), '$81.40');
  assert.equal(formatCost(0), '$0.00');
});
