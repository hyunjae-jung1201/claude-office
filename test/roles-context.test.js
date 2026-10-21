import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRootOf, groupFilesByRepo, buildDiff, buildPrompt } from '../src/roles/context.js';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
function repo(files = { 'a.js': 'const a = 1;\n' }, { commit = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ctx-repo-')));
  git(root, 'init', '-q');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  if (commit) { git(root, 'add', '-A'); git(root, 'commit', '-qm', 'init'); }
  return root;
}

test('repoRootOf: 파일이 속한 저장소 루트, 저장소 밖이면 null, 아직 없는 새 파일도 상위 폴더로 판단', async () => {
  const r = repo();
  assert.equal(await repoRootOf(join(r, 'a.js')), r);
  assert.equal(await repoRootOf(join(r, 'new', 'deep', 'file.js')), r);
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'ctx-plain-')));
  writeFileSync(join(plain, 'x.txt'), 'x');
  assert.equal(await repoRootOf(join(plain, 'x.txt')), null);
});

test('groupFilesByRepo: 저장소별로 나누고 저장소 밖·중복·상대 경로를 제외한다', async () => {
  const r1 = repo();
  const r2 = repo({ 'b.js': 'x' });
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'ctx-plain-')));
  writeFileSync(join(plain, 'x.txt'), 'x');
  const g = await groupFilesByRepo([join(r1, 'a.js'), join(r1, 'a.js'), join(r2, 'b.js'), join(plain, 'x.txt'), 'relative/path.js']);
  assert.deepEqual([...g.keys()].sort(), [r1, r2].sort());
  assert.deepEqual(g.get(r1), [join(r1, 'a.js')]);
  assert.deepEqual(g.get(r2), [join(r2, 'b.js')]);
});

test('groupFilesByRepo: 홈 폴더 자체가 저장소여도 그 전체를 검토 대상으로 삼지 않는다', async () => {
  const home = repo({ 'notes.txt': 'x' });
  const g = await groupFilesByRepo([join(home, 'notes.txt')], { homeDir: home });
  assert.equal(g.size, 0);
});

test('buildDiff: 수정된 파일의 diff와 통계', async () => {
  const r = repo({ 'a.js': 'const a = 1;\n', 'b.js': 'x\n' });
  writeFileSync(join(r, 'a.js'), 'const a = 2;\n');
  const d = await buildDiff(r, [join(r, 'a.js')]);
  assert.match(d.diff, /-const a = 1;/);
  assert.match(d.diff, /\+const a = 2;/);
  assert.equal(d.truncated, false);
  assert.match(d.stats, /a\.js/);
  assert.ok(!d.diff.includes('b.js'));
});

test('buildDiff: .env 같은 민감 파일은 내용을 제외하고 excluded에 알린다', async () => {
  const r = repo({ 'a.js': 'x\n', '.env': 'API_KEY=abc123\n' });
  writeFileSync(join(r, '.env'), 'API_KEY=SUPERSECRETVALUE9999\n');
  writeFileSync(join(r, 'a.js'), 'y\n');
  const d = await buildDiff(r, [join(r, '.env'), join(r, 'a.js')]);
  assert.ok(!d.diff.includes('SUPERSECRETVALUE9999'));
  assert.ok(!d.stats.includes('.env'));
  assert.equal(d.excluded.length, 1);
  assert.match(d.diff, /설정 파일 변경.*내용 제외/);
  assert.match(d.diff, /\+y/);
});

test('buildDiff: diff 속 토큰은 마스킹된다', async () => {
  const r = repo({ 'a.js': 'x\n' });
  writeFileSync(join(r, 'a.js'), 'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
  const d = await buildDiff(r, [join(r, 'a.js')]);
  assert.ok(!d.diff.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
});

test('buildDiff: 새 파일(추적 안 됨)은 앞부분 4KB만, 바이너리는 표시만', async () => {
  const r = repo();
  writeFileSync(join(r, 'new.js'), 'line\n'.repeat(2000));
  writeFileSync(join(r, 'img.bin'), Buffer.from([0, 1, 2, 0, 3]));
  const d = await buildDiff(r, [join(r, 'new.js'), join(r, 'img.bin')]);
  assert.match(d.diff, /new file.*new\.js|new\.js/);
  assert.ok(d.diff.length < 6000);
  assert.match(d.diff, /바이너리/);
});

test('buildDiff: 60KB를 넘으면 diff는 비우고 truncated와 통계만', async () => {
  const r = repo({ 'big.txt': 'a\n' });
  writeFileSync(join(r, 'big.txt'), Array.from({ length: 6000 }, (_, i) => `row ${i} ${'z'.repeat(20)}`).join('\n') + '\n');
  const d = await buildDiff(r, [join(r, 'big.txt')]);
  assert.equal(d.truncated, true);
  assert.equal(d.diff, '');
  assert.match(d.stats, /big\.txt/);
});

test('buildDiff: 커밋이 아직 없는 저장소와 삭제된 파일도 처리한다', async () => {
  const fresh = repo({ 'a.js': 'hello\n' }, { commit: false });
  const d1 = await buildDiff(fresh, [join(fresh, 'a.js')]);
  assert.match(d1.diff, /hello/);
  const r = repo({ 'gone.js': 'bye\n' });
  execFileSync('rm', [join(r, 'gone.js')]);
  const d2 = await buildDiff(r, [join(r, 'gone.js')]);
  assert.match(d2.diff, /-bye/);
});

const ROLE = { id: 'dev', name: '개발자', color: '#2a7f8f', model: 'sonnet', when: 'code', tools: ['Read', 'Grep', 'Glob'], prompt: '당신은 개발자다.' };
const bundle = (over = {}) => ({ repoRoot: '/r/app', repoName: 'app', requests: ['로그인 고쳐줘'], lastResponse: '고쳤습니다.', files: ['/r/app/a.js'], diff: '+x', truncated: false, stats: ' a.js | 1 +', excluded: [], ...over });

test('buildPrompt: 역할 지침, 읽기 전용 규칙, 출력 형식 지침이 항상 들어 있다', () => {
  const p = buildPrompt(ROLE, bundle());
  assert.match(p, /당신은 개발자다\./);
  assert.match(p, /수정하거나 실행하지/);
  assert.match(p, /"verdict"/);
  assert.match(p, /로그인 고쳐줘/);
  assert.match(p, /고쳤습니다\./);
  assert.match(p, /\+x/);
});

test('buildPrompt: 요청·응답의 비밀값 마스킹, 요청은 최근 5개×300자, 응답 2000자', () => {
  const reqs = Array.from({ length: 7 }, (_, i) => `요청${i} ` + 'x'.repeat(400));
  const p = buildPrompt(ROLE, bundle({ requests: [...reqs, '마지막 token=abcd1234efgh'], lastResponse: 'sk-abcdefghijklmnopqrstuvwx1234 ' + 'y'.repeat(5000) }));
  assert.ok(!p.includes('abcd1234efgh'));
  assert.ok(!p.includes('sk-abcdefghijklmnopqrstuvwx1234'));
  assert.ok(!p.includes('요청0') && !p.includes('요청2') && p.includes('요청3'));
  assert.ok(!p.includes('x'.repeat(301)));
  assert.ok(!p.includes('y'.repeat(2001)));
});

test('buildPrompt: diff가 잘렸으면 통계만 보여 주고 읽어서 확인하라고 안내', () => {
  const p = buildPrompt(ROLE, bundle({ diff: '', truncated: true, stats: ' big.txt | 6000 ++++' }));
  assert.match(p, /big\.txt/);
  assert.match(p, /너무 커서|직접 읽/);
});

// ---- 보안 리뷰 반영: git 경로 패턴(글롭) 해석과 심볼릭 링크로 민감 파일이 새지 않게
import { symlinkSync } from 'node:fs';

test('이름에 글롭 문자가 든 파일을 편집해도 다른 파일(.env 등)의 diff가 따라오지 않는다', async () => {
  const r = repo({ 'a.js': 'x\n', '.env': 'KEY=old\n', '*': 'star\n' });
  writeFileSync(join(r, '.env'), 'KEY=GLOBLEAKVALUE777\n');
  writeFileSync(join(r, 'a.js'), 'CHANGED_A\n');
  writeFileSync(join(r, '*'), 'star2\n');
  const d = await buildDiff(r, [join(r, '*')]);
  assert.ok(!d.diff.includes('GLOBLEAKVALUE777'));
  assert.ok(!d.diff.includes('CHANGED_A'));
  assert.match(d.diff, /star2/);
});

test('추적 안 되는 심볼릭 링크는 가리키는 파일 내용을 읽지 않는다', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'ctx-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'OUTSIDESECRET12345\n');
  const r = repo();
  symlinkSync(join(outside, 'secret.txt'), join(r, 'link.txt'));
  const d = await buildDiff(r, [join(r, 'link.txt')]);
  assert.ok(!d.diff.includes('OUTSIDESECRET12345'));
  assert.match(d.diff, /링크|특수/);
});

test('민감 파일을 가리키는 새 심볼릭 링크도 내용을 읽지 않는다', async () => {
  const r = repo();
  writeFileSync(join(r, '.env'), 'ENVSECRET98765\n');
  symlinkSync(join(r, '.env'), join(r, 'innocent.txt'));
  const d = await buildDiff(r, [join(r, 'innocent.txt')]);
  assert.ok(!d.diff.includes('ENVSECRET98765'));
});

test('buildPrompt: 제외한 설정 파일이 있으면 "내용을 못 보는 것은 문제로 지적하지 마라"고 안내한다', () => {
  const p = buildPrompt(ROLE, bundle({ excluded: ['설정 파일'], diff: '+x\n\n# 설정 파일 변경(내용 제외): 1개\n' }));
  assert.match(p, /일부러 제외|의도적으로 제외/);
  assert.match(p, /지적하지 마라/);
  const none = buildPrompt(ROLE, bundle());
  assert.ok(!/일부러 제외|의도적으로 제외/.test(none));
});

test('buildPrompt: 이번에 바뀐 파일 밖의 변경(다른 작업)은 지적하지 말라고 범위를 안내한다', () => {
  const p = buildPrompt(ROLE, bundle());
  assert.match(p, /이번에 바뀐 파일.*범위|범위.*이번에 바뀐 파일/s);
  assert.match(p, /다른 작업/);
});
