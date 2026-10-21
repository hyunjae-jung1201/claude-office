import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildRoleSpawn, runRole } from '../src/roles/runner.js';

const ROLE = { id: 'dev', name: '개발자', color: '#2a7f8f', model: 'sonnet', when: 'code', tools: ['Read', 'Grep', 'Glob'], prompt: 'p' };

function after(args, flag) {
  const i = args.indexOf(flag);
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
  return out;
}

test('buildRoleSpawn: 읽기 도구만 허용하고, 쓰기·실행 계열은 허용 목록에 없고 거부 목록에 있다', () => {
  const { args } = buildRoleSpawn(ROLE, '프롬프트', '/r/app');
  assert.deepEqual(args.slice(0, 2), ['-p', '프롬프트']);
  // 읽기 도구는 저장소(작업 폴더) 안으로만 허용한다
  assert.deepEqual(after(args, '--allowedTools'), ['Read(./**)', 'Grep(./**)', 'Glob(./**)']);
  const denied = after(args, '--disallowedTools');
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'Agent']) {
    assert.ok(denied.includes(t), t);
    assert.ok(!after(args, '--allowedTools').some((a) => a === t || a.startsWith(`${t}(`)), t);
  }
  assert.deepEqual(after(args, '--model'), ['sonnet']);
});

test('buildRoleSpawn: 민감 경로 읽기 거부 규칙이 Read/Grep/Glob에 걸려 있다', () => {
  const denied = after(buildRoleSpawn(ROLE, 'p', '/r').args, '--disallowedTools');
  for (const tool of ['Read', 'Grep', 'Glob']) {
    for (const pat of ['**/.env*', '~/.ssh/**', '~/.aws/**', '**/*.pem', '**/id_*', '~/.claude/**', '~/.config/**', '~/.docker/**', '~/.kube/**', '~/.git-credentials']) assert.ok(denied.includes(`${tool}(${pat})`), `${tool}(${pat})`);
  }
});

test('buildRoleSpawn: 설정 파일을 읽지 않고 세션을 남기지 않는다', () => {
  const { args } = buildRoleSpawn(ROLE, 'p', '/r');
  const i = args.indexOf('--setting-sources');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], '');
  assert.ok(args.includes('--no-session-persistence'));
});

test('buildRoleSpawn: 작업 폴더는 저장소 루트, 환경변수는 허용 목록 + CLAUDE_OFFICE_ROLE만', () => {
  process.env.SUPER_SECRET_FOR_TEST = 'leak-me';
  const { options } = buildRoleSpawn(ROLE, 'p', '/r/app');
  delete process.env.SUPER_SECRET_FOR_TEST;
  assert.equal(options.cwd, '/r/app');
  assert.equal(options.env.CLAUDE_OFFICE_ROLE, '1');
  assert.ok(options.env.PATH && options.env.HOME);
  assert.equal(options.env.SUPER_SECRET_FOR_TEST, undefined);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
});

function fakeSpawn() {
  const calls = [];
  const spawnFn = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = [];
    child.kill = (sig) => { child.killed.push(sig); };
    calls.push({ cmd, args, options, child });
    return child;
  };
  return { spawnFn, calls };
}

test('runRole: 표준출력을 모아 돌려준다', async () => {
  const { spawnFn, calls } = fakeSpawn();
  const p = runRole({ role: ROLE, prompt: 'p', repoRoot: '/r', spawnFn });
  const c = calls[0].child;
  c.stdout.emit('data', Buffer.from('{"verdict":'));
  c.stdout.emit('data', Buffer.from('"ok"}'));
  c.emit('close', 0);
  assert.equal(await p, '{"verdict":"ok"}');
  assert.equal(calls[0].cmd, 'claude');
});

test('runRole: 종료 코드가 0이 아니면 Error(stderr 일부 포함)', async () => {
  const { spawnFn, calls } = fakeSpawn();
  const p = runRole({ role: ROLE, prompt: 'p', repoRoot: '/r', spawnFn });
  calls[0].child.stderr.emit('data', Buffer.from('권한 오류'));
  calls[0].child.emit('close', 1);
  await assert.rejects(p, /실행 실패.*1.*권한 오류/);
});

test('runRole: claude를 실행할 수 없으면(error 이벤트) Error', async () => {
  const { spawnFn, calls } = fakeSpawn();
  const p = runRole({ role: ROLE, prompt: 'p', repoRoot: '/r', spawnFn });
  calls[0].child.emit('error', new Error('ENOENT'));
  await assert.rejects(p, /실행 실패.*ENOENT/);
});

test('runRole: 시간 제한(기본 180초)을 넘기면 프로세스를 종료하고 Error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { spawnFn, calls } = fakeSpawn();
  const p = runRole({ role: ROLE, prompt: 'p', repoRoot: '/r', spawnFn });
  p.catch(() => {});
  t.mock.timers.tick(179_000);
  assert.equal(calls[0].child.killed.length, 0);
  t.mock.timers.tick(1_000);
  await assert.rejects(p, /시간 초과/);
  assert.ok(calls[0].child.killed.length >= 1);
});

test('runRole: 정상 종료하면 타이머는 정리된다(늦게 시간 초과가 나지 않음)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { spawnFn, calls } = fakeSpawn();
  const p = runRole({ role: ROLE, prompt: 'p', repoRoot: '/r', spawnFn, timeoutMs: 1000 });
  calls[0].child.stdout.emit('data', Buffer.from('ok'));
  calls[0].child.emit('close', 0);
  assert.equal(await p, 'ok');
  t.mock.timers.tick(5000);
  assert.equal(calls[0].child.killed.length, 0);
});

test('runRole: 5MB 출력도 처리하고, 한도(8MB)를 넘는 출력은 잘라서 받는다', async () => {
  const { spawnFn, calls } = fakeSpawn();
  const p = runRole({ role: ROLE, prompt: 'p', repoRoot: '/r', spawnFn });
  const chunk = Buffer.alloc(1024 * 1024, 'a');
  for (let i = 0; i < 5; i++) calls[0].child.stdout.emit('data', chunk);
  calls[0].child.emit('close', 0);
  assert.equal((await p).length, 5 * 1024 * 1024);

  const q = runRole({ role: ROLE, prompt: 'p', repoRoot: '/r', spawnFn });
  for (let i = 0; i < 12; i++) calls[1].child.stdout.emit('data', chunk);
  calls[1].child.emit('close', 0);
  assert.ok((await q).length <= 8 * 1024 * 1024);
});
