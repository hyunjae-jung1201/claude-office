import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeEvent, toolCategory } from '../src/events.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const NOW = 1_000_000;

test('toolCategory: 읽기/쓰기/실행 분류', () => {
  for (const t of ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']) assert.equal(toolCategory(t), 'read');
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'Task', 'Agent', 'mcp__x__y', 'Whatever']) assert.equal(toolCategory(t), 'write');
  assert.equal(toolCategory('Bash'), 'run');
});

test('Bash PreToolUse → tool/run, detail에 명령', () => {
  const ev = normalizeEvent(fx('pre-tool-bash'), NOW);
  assert.deepEqual(
    { type: ev.type, category: ev.category, sessionId: ev.sessionId, cwd: ev.cwd, ts: ev.ts, agentId: ev.agentId },
    { type: 'tool', category: 'run', sessionId: 'sess-1', cwd: '/work/a', ts: NOW, agentId: undefined },
  );
  assert.match(ev.detail, /wget https:\/\/example\.com\/train\.zip/);
});

test('PermissionRequest → wait', () => {
  const ev = normalizeEvent(fx('permission-request'), NOW);
  assert.equal(ev.type, 'wait');
  assert.equal(ev.detail, 'rm -f out.txt');
});

test('하위 에이전트 안의 도구 호출은 agentId/agentType을 가진다', () => {
  const ev = normalizeEvent(fx('subagent-tool'), NOW);
  assert.equal(ev.type, 'tool');
  assert.equal(ev.category, 'read');
  assert.equal(ev.agentId, 'a4502aa6e3dc370ca');
  assert.equal(ev.agentType, 'general-purpose');
  assert.equal(ev.detail, '/work/a/data/notes.txt');
});

test('세션/에이전트 수명 이벤트', () => {
  const base = { session_id: 's', cwd: '/c' };
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'SessionStart' }, NOW).type, 'start');
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'SessionEnd' }, NOW).type, 'end');
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'Stop' }, NOW).type, 'stop');
  const a = normalizeEvent({ ...base, hook_event_name: 'SubagentStart', agent_id: 'x', agent_type: 'Explore' }, NOW);
  assert.deepEqual([a.type, a.agentId, a.agentType], ['agentStart', 'x', 'Explore']);
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'SubagentStop', agent_id: 'x' }, NOW).type, 'agentStop');
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} }, NOW).type, 'toolDone');
});

test('사용자 프롬프트는 prompt, 하위 에이전트 완료 알림은 무시(null)', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'UserPromptSubmit' };
  assert.equal(normalizeEvent({ ...base, prompt: '로그인 고쳐줘' }, NOW).type, 'prompt');
  assert.equal(normalizeEvent({ ...base, prompt: '<task-notification>\n<task-id>x</task-id>' }, NOW), null);
});

test('필드 누락·알 수 없는 이벤트·이상한 입력은 null', () => {
  assert.equal(normalizeEvent({ cwd: '/c', hook_event_name: 'Stop' }, NOW), null);
  assert.equal(normalizeEvent({ session_id: 's', hook_event_name: 'Stop' }, NOW), null);
  assert.equal(normalizeEvent({ session_id: 's', cwd: '/c' }, NOW), null);
  assert.equal(normalizeEvent({ session_id: 's', cwd: '/c', hook_event_name: 'Mystery' }, NOW), null);
  for (const bad of [null, undefined, 'str', 42, [], true]) assert.equal(normalizeEvent(bad, NOW), null);
});

test('detail에는 비밀값이 없고 200자로 제한된다', () => {
  const ev = normalizeEvent({
    session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'curl -H "Authorization: Bearer abc123def456ghi789jkl" ' + 'x'.repeat(400) },
  }, NOW);
  assert.ok(!ev.detail.includes('abc123def456ghi789jkl'));
  assert.ok(ev.detail.length <= 200);
  const env = normalizeEvent({ session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/work/a/.env' } }, NOW);
  assert.ok(!env.detail.includes('.env'));
});

test('아주 긴 명령도 빠르게 처리되고 detail은 200자 이하이며 비밀이 새지 않는다', () => {
  const t0 = Date.now();
  const ev = normalizeEvent({
    session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'sk-aaaaaaaaaaaaaaaaaaaa '.repeat(5000) },
  }, NOW);
  assert.ok(Date.now() - t0 < 500);
  assert.ok(ev.detail.length <= 200);
  assert.ok(!ev.detail.includes('sk-'));
});
test('자르는 경계에 걸친 토큰의 일부가 detail에 남지 않는다', () => {
  const ev = normalizeEvent({
    session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'x '.repeat(399) + 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
  }, NOW);
  assert.ok(!ev.detail.includes('ghp_'));
});

test('AskUserQuestion/ExitPlanMode PreToolUse는 wait(답변/계획 승인)이고, PermissionRequest는 approval', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse' };
  const ask = normalizeEvent({ ...base, tool_name: 'AskUserQuestion', tool_input: {} }, NOW);
  assert.deepEqual([ask.type, ask.waitKind], ['wait', 'answer']);
  const plan = normalizeEvent({ ...base, tool_name: 'ExitPlanMode', tool_input: {} }, NOW);
  assert.deepEqual([plan.type, plan.waitKind], ['wait', 'plan']);
  const perm = normalizeEvent({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' } }, NOW);
  assert.deepEqual([perm.type, perm.waitKind], ['wait', 'approval']);
});

// ---- 역할자 검토용 보강 필드
test('편집 도구는 toolName과 마스킹하지 않은 filePath를 가진다, 읽기 도구는 filePath가 없다', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse' };
  const edit = normalizeEvent({ ...base, tool_name: 'Edit', tool_input: { file_path: '/r/src/0123456789abcdef0123456789abcdef.js' } }, NOW);
  assert.deepEqual([edit.toolName, edit.filePath], ['Edit', '/r/src/0123456789abcdef0123456789abcdef.js']);
  const nb = normalizeEvent({ ...base, tool_name: 'NotebookEdit', tool_input: { notebook_path: '/r/a.ipynb' } }, NOW);
  assert.equal(nb.filePath, '/r/a.ipynb');
  const write = normalizeEvent({ ...base, tool_name: 'Write', tool_input: { file_path: '/r/new.md' } }, NOW);
  assert.equal(write.filePath, '/r/new.md');
  const read = normalizeEvent({ ...base, tool_name: 'Read', tool_input: { file_path: '/r/a.js' } }, NOW);
  assert.equal(read.toolName, 'Read');
  assert.equal(read.filePath, undefined);
  const done = normalizeEvent({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/r/a.js' } }, NOW);
  assert.equal(done.toolName, 'Edit');
});

test('filePath는 1000자까지만, 문자열이 아니면 없다', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Edit' };
  assert.equal(normalizeEvent({ ...base, tool_input: { file_path: '/' + 'a'.repeat(3000) } }, NOW).filePath, undefined);
  assert.equal(normalizeEvent({ ...base, tool_input: { file_path: 42 } }, NOW).filePath, undefined);
  assert.equal(normalizeEvent({ ...base, tool_input: null }, NOW).filePath, undefined);
});

test('prompt는 마스킹된 promptText(300자), 하위 에이전트 알림은 여전히 null', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'UserPromptSubmit' };
  const ev = normalizeEvent({ ...base, prompt: '로그인을 고쳐줘 sk-abcdefghijklmnopqrstuvwx1234 ' + 'x'.repeat(500) }, NOW);
  assert.equal(ev.type, 'prompt');
  assert.ok(ev.promptText.length <= 300);
  assert.ok(!ev.promptText.includes('sk-abcdefghijklmnopqrstuvwx1234'));
  assert.ok(ev.promptText.startsWith('로그인을 고쳐줘'));
  assert.equal(normalizeEvent({ ...base, prompt: '<task-notification>x' }, NOW), null);
  assert.equal(normalizeEvent({ ...base }, NOW).promptText, undefined);
});

test('stop은 마스킹된 assistantText(2000자)를 가진다', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'Stop' };
  const ev = normalizeEvent({ ...base, last_assistant_message: '완료했습니다. token=abcd1234efgh ' + 'y'.repeat(3000) }, NOW);
  assert.ok(ev.assistantText.length <= 2000);
  assert.ok(!ev.assistantText.includes('abcd1234efgh'));
  assert.equal(normalizeEvent(base, NOW).assistantText, undefined);
});

// ---- 작업 종류(방) 분류
import { activityOf } from '../src/events.js';

test('activityOf: 도구와 입력으로 어느 방에서 하는 일인지 정한다', () => {
  const cases = [
    ['Read', '/r/a.js', 'library'], ['Grep', 'foo', 'library'], ['Glob', '**/*.js', 'library'],
    ['WebSearch', 'node test runner', 'research'], ['WebFetch', 'https://x.dev', 'research'],
    ['Edit', '/r/src/a.js', 'work'], ['Write', '/r/b.py', 'work'], ['NotebookEdit', '/r/n.ipynb', 'lab'],
    ['Edit', '/r/README.md', 'docs'], ['Write', '/r/docs/notes.txt', 'docs'], ['Edit', '/r/guide.rst', 'docs'],
    ['TodoWrite', '', 'planning'], ['EnterPlanMode', '', 'planning'],
    ['Agent', '조사', 'briefing'], ['Task', '조사', 'briefing'],
    ['AskUserQuestion', '', 'response'], ['ExitPlanMode', '', 'response'],
    ['Bash', 'npm test', 'lab'], ['Bash', 'pytest -q tests/', 'lab'], ['Bash', 'node --test test/', 'lab'], ['Bash', 'eslint src', 'lab'], ['Bash', 'cargo test', 'lab'],
    ['Bash', 'npm run build', 'build'], ['Bash', 'npm install', 'build'], ['Bash', 'pip install -r req.txt', 'build'], ['Bash', 'make -j8', 'build'], ['Bash', 'docker build .', 'build'],
    ['Bash', 'git status', 'git'], ['Bash', 'git commit -m x', 'git'], ['Bash', 'gh pr create', 'git'],
    ['Bash', 'wget https://x/train.zip', 'data'], ['Bash', 'curl -O https://x/a.bin', 'data'], ['Bash', 'rsync -av a b', 'data'], ['Bash', 'unzip data.zip', 'data'], ['Bash', 'scp a host:/b', 'data'],
    ['Bash', 'systemctl status nginx', 'server'], ['Bash', 'ls -la', 'library'], ['Bash', 'python train.py', 'lab'], ['Bash', 'ssh host uptime', 'server'],
    ['mcp__x__y', '', 'work'], ['Whatever', '', 'work'],
  ];
  for (const [tool, detail, want] of cases) assert.equal(activityOf(tool, detail), want, `${tool} ${detail}`);
});

test('activityOf: git이 테스트·빌드보다 먼저, 앞쪽 환경변수·sudo·cd 접두는 건너뛴다', () => {
  assert.equal(activityOf('Bash', 'git commit -m "npm test 추가"'), 'git');
  assert.equal(activityOf('Bash', 'CI=1 npm test'), 'lab');
  assert.equal(activityOf('Bash', 'sudo apt-get install -y curl'), 'build');
  assert.equal(activityOf('Bash', 'cd /r && npm run build'), 'build');
  assert.equal(activityOf('Bash', 'cd /r && git push'), 'git');
});

test('activityOf: 이상한 입력에도 예외 없이 기본 방', () => {
  for (const [t, d] of [[undefined, undefined], ['Bash', undefined], ['Bash', 42], ['Edit', null], ['Read', {}]]) assert.doesNotThrow(() => activityOf(t, d));
  assert.equal(activityOf('Bash', ''), 'work');
});

test('이벤트에 activity가 붙는다 (tool, wait, 하위 에이전트 호출)', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse' };
  assert.equal(normalizeEvent({ ...base, tool_name: 'Bash', tool_input: { command: 'npm test' } }, NOW).activity, 'lab');
  assert.equal(normalizeEvent({ ...base, tool_name: 'Edit', tool_input: { file_path: '/r/README.md' } }, NOW).activity, 'docs');
  assert.equal(normalizeEvent({ ...base, tool_name: 'Agent', tool_input: { description: '조사' } }, NOW).activity, 'briefing');
  assert.equal(normalizeEvent({ ...base, tool_name: 'AskUserQuestion', tool_input: {} }, NOW).activity, 'response');
  assert.equal(normalizeEvent({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' } }, NOW).activity, 'response');
});

// ---- git 없는 검토: 수정 전·후 내용(edit)
test('Edit/Write/MultiEdit 신호에 수정 전·후 내용(edit)이 담긴다 (마스킹·크기 제한)', () => {
  const base = { session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse' };
  const e1 = normalizeEvent({ ...base, tool_name: 'Edit', tool_input: { file_path: '/p/a.js', old_string: 'const a = 1;', new_string: 'const a = 2; // token=abcd1234efgh' } }, NOW);
  assert.deepEqual([e1.edit.kind, e1.edit.file, e1.edit.old], ['edit', '/p/a.js', 'const a = 1;']);
  assert.ok(e1.edit.new.startsWith('const a = 2;') && !e1.edit.new.includes('abcd1234efgh'));
  const e2 = normalizeEvent({ ...base, tool_name: 'Write', tool_input: { file_path: '/p/new.md', content: '# 제목\n' + 'x'.repeat(9000) } }, NOW);
  assert.deepEqual([e2.edit.kind, e2.edit.file], ['write', '/p/new.md']);
  assert.ok(e2.edit.new.length <= 4000 && e2.edit.old === undefined);
  const e3 = normalizeEvent({ ...base, tool_name: 'MultiEdit', tool_input: { file_path: '/p/b.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] } }, NOW);
  assert.deepEqual([e3.edit.kind, e3.edit.edits.map((x) => [x.old, x.new])], ['multi', [['a', 'b'], ['c', 'd']]]);
  assert.equal(normalizeEvent({ ...base, tool_name: 'Read', tool_input: { file_path: '/p/a.js' } }, NOW).edit, undefined);
  assert.equal(normalizeEvent({ ...base, tool_name: 'Edit', tool_input: { file_path: 'relative.js', old_string: 'a', new_string: 'b' } }, NOW).edit, undefined);
});

// ---- 셸 명령 분류: 서버실은 서버·인프라 일만. 읽기는 자료실, 문서 만들기는 문서실, 그 밖은 작업실
test('activityOf(Bash): 문서(PPT·워드·엑셀·PDF·마크다운)를 만드는 일은 서버실이 아니라 문서실', () => {
  const docs = [
    'python3 make_ppt.py', 'python3 gen_slides.py --out report.pptx', 'node build_deck.js && ls out/', 'soffice --headless --convert-to pdf a.docx', 'pandoc notes.md -o notes.docx',
    "python3 - <<'EOF'\nfrom pptx import Presentation\nprs = Presentation()\nprs.save('a.pptx')\nEOF",
    "cat > /w/notes.md <<'EOF'\n# 회의록\nEOF", 'echo "- 오늘 작업" >> "$D/log.md"', 'D="/mnt/c/Users/USER/Desktop/일지"; cat >> "$D/a.md" <<\'EOF\'\n내용\nEOF',
  ];
  for (const c of docs) assert.equal(activityOf('Bash', c), 'docs', c);
});

test('activityOf(Bash): 읽기 전용 명령은 자료실, 파일을 만지는 명령과 일반 스크립트 실행은 작업실', () => {
  for (const c of ['ls -la', 'cat README.txt', 'grep -rn foo src | head', 'head -n 20 a.log', 'find . -name "*.js"', 'wc -l a.js', 'sed -n 1,20p a.js', 'tail -f a.log', 'diff a b', 'tree -L 2']) assert.equal(activityOf('Bash', c), 'library', c);
  for (const c of ['sed -i s/a/b/ a.js', 'mkdir -p out && cp a.js out/', 'mv a b', 'rm -f tmp.txt', 'python3 analyze.py', 'node script.js', 'bash run.sh', './tool --flag', "python3 - <<'EOF'\nprint(1)\nEOF", 'echo hello', 'cat > a.js <<\'EOF\'\nx\nEOF']) assert.equal(activityOf('Bash', c), 'work', c);
});

test('activityOf(Bash): 서버·인프라·원격 접속·프로세스·네트워크는 서버실, 학습·평가 스크립트는 테스트 랩', () => {
  for (const c of ['ssh host uptime', "sshpass -p x ssh -o A=b u@h 'ls /data'", 'docker ps', 'systemctl --user restart claude-office', 'journalctl -u x -n 20', 'kill 123', 'pkill -f node', 'ps aux | grep node', 'nvidia-smi', 'curl -s localhost:9410/api/reviews', 'adb devices', 'lsof -i :9410', 'nohup node src/server.js &', 'uvicorn app:app', 'npm start']) assert.equal(activityOf('Bash', c), 'server', c);
  for (const c of ['python train.py --epochs 3', '.venv/bin/python3 eval_model.py', 'PYTHONPATH=. python benchmark.py', 'python3 -m pytest -q']) assert.equal(activityOf('Bash', c), 'lab', c);
});

test('activityOf(Bash): 우선순위(git > 테스트 > 빌드 > 데이터 > 문서 > 서버 > 작업 > 읽기), heredoc 본문 속 단어는 명령으로 세지 않는다', () => {
  assert.equal(activityOf('Bash', 'cd /r && ls && git status'), 'git');
  assert.equal(activityOf('Bash', 'cat a.js | head && npm test'), 'lab');
  assert.equal(activityOf('Bash', 'ls && ssh host uptime'), 'server');
  assert.equal(activityOf('Bash', 'timeout 250 npm test > out.txt 2>&1; grep -c ok out.txt'), 'lab');
  assert.equal(activityOf('Bash', "cat > /w/notes.md <<'EOF'\ngit add .\nnpm test\nssh host\nEOF"), 'docs'); // 본문의 git/npm/ssh 는 무시
  assert.equal(activityOf('Bash', 'cmd.exe /c gradlew assembleDebug'), 'build');
  assert.equal(activityOf('Bash', 'wget https://x/a.zip && unzip a.zip'), 'data');
});

// ---- 편집 대상 파일의 종류로도 방을 정한다
test('activityOf(Edit/Write): 파일 종류별로 문서실·테스트 랩·빌드실·서버실·데이터 창고·작업실', () => {
  const cases = [
    ['Write', '/r/docs/guide.md', 'docs'], ['Edit', '/r/README', 'docs'], ['Write', '/r/out/report.docx', 'docs'], ['Write', '/r/out/deck.pptx', 'docs'],
    ['Edit', '/r/test/a.test.js', 'lab'], ['Write', '/r/tests/test_calc.py', 'lab'], ['Edit', '/r/src/__tests__/x.js', 'lab'], ['Edit', '/r/calc_test.go', 'lab'], ['Write', '/r/src/foo.spec.ts', 'lab'],
    ['Edit', '/r/package.json', 'build'], ['Edit', '/r/Makefile', 'build'], ['Write', '/r/Dockerfile', 'build'], ['Edit', '/r/.github/workflows/ci.yml', 'build'], ['Edit', '/r/requirements.txt', 'build'], ['Edit', '/r/build.gradle.kts', 'build'], ['Edit', '/r/CMakeLists.txt', 'build'],
    ['Edit', '/etc/nginx/conf.d/a.conf', 'server'], ['Write', '/r/deploy/app.service', 'server'], ['Edit', '/r/.env', 'server'],
    ['Write', '/r/data/train.csv', 'data'], ['Edit', '/r/a.sqlite3', 'data'], ['Write', '/r/rows.jsonl', 'data'],
    ['Edit', '/r/src/main.py', 'work'], ['Write', '/r/web/index.html', 'work'], ['MultiEdit', '/r/lib/util.js', 'work'],
  ];
  for (const [tool, path, want] of cases) assert.equal(activityOf(tool, path), want, `${tool} ${path}`);
});

test('activityOf(Skill): 계획·설계 스킬은 기획실, 테스트·디버깅은 테스트 랩, 리뷰는 자료실, 실행·구현은 작업실', () => {
  const cases = [
    ['superpowers:brainstorming', 'planning'], ['superpowers:writing-plans', 'planning'], ['plan-review', 'planning'],
    ['superpowers:systematic-debugging', 'lab'], ['superpowers:test-driven-development', 'lab'], ['verification-before-completion', 'lab'],
    ['code-review', 'library'], ['superpowers:executing-plans', 'work'], ['frontend-design:frontend-design', 'work'], ['anthropic-skills:pptx', 'docs'], ['docx', 'docs'], ['whatever', 'work'],
  ];
  for (const [skill, want] of cases) assert.equal(activityOf('Skill', skill), want, skill);
});

test('activityOf(MCP·기타 도구): 하는 일의 성격으로 방을 정한다', () => {
  const cases = [
    ['mcp__playwright__browser_click', 'lab'], ['mcp__mobile-mcp__mobile_take_screenshot', 'lab'], ['mcp__jupyter__execute_cell', 'lab'], ['mcp__plugin_semgrep_guardian__get_semgrep_sast_findings', 'lab'],
    ['mcp__plugin_mongodb_mongodb__find', 'data'], ['mcp__plugin_atlassian_atlassian__authenticate', 'planning'], ['mcp__sequential-thinking__sequentialthinking', 'planning'],
    ['mcp__context7__query-docs', 'research'], ['mcp__claude_ai_Gmail__authenticate', 'research'], ['mcp__ai-memory__memory_query', 'library'],
    ['mcp__claude_ai_Claude_Docs__create', 'docs'], ['mcp__plugin_desktop-commander_desktop-commander__read_file', 'library'], ['mcp__plugin_desktop-commander_desktop-commander__write_file', 'work'],
    ['Monitor', 'lab'], ['CronCreate', 'planning'], ['ScheduleWakeup', 'planning'], ['EnterWorktree', 'git'], ['SendMessage', 'briefing'], ['LSP', 'library'], ['Artifact', 'docs'], ['mcp__21st__authenticate', 'work'], ['TaskStop', 'work'],
  ];
  for (const [tool, want] of cases) assert.equal(activityOf(tool, ''), want, tool);
});

test('activityOf(Bash): DB 질의·Windows 래퍼 속 명령도 알맞은 방', () => {
  assert.equal(activityOf('Bash', 'sqlite3 a.db "select 1"'), 'data');
  assert.equal(activityOf('Bash', 'mongosh --eval "db.x.find()"'), 'data');
  assert.equal(activityOf('Bash', 'psql -c "select 1"'), 'data');
  assert.equal(activityOf('Bash', 'duckdb -c "select 1"'), 'data');
  assert.equal(activityOf('Bash', '/mnt/c/Windows/System32/cmd.exe /c "gradlew assembleDebug"'), 'build');
  assert.equal(activityOf('Bash', 'powershell.exe -Command "Get-Process"'), 'server');
});

test('이벤트: Skill 이름이 분류에 쓰이고(detail 에는 이름만), 원격 기록의 Skill 도 같다', () => {
  const e = normalizeEvent({ session_id: 's', cwd: '/c', hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming', args: '비밀 token=abcd1234efgh' } }, NOW);
  assert.equal(e.activity, 'planning');
  assert.ok(!String(e.detail).includes('abcd1234efgh'));
});

test('PermissionRequest 의 wait 이벤트는 승인 뒤에 할 도구의 방(toolActivity)을 함께 담는다', () => {
  const e = normalizeEvent({ session_id: 's', cwd: '/c', hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: '/r/docs/guide.md' } }, NOW);
  assert.deepEqual([e.type, e.waitKind, e.activity, e.toolActivity], ['wait', 'approval', 'response', 'docs']);
  const b = normalizeEvent({ session_id: 's', cwd: '/c', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'python3 make_ppt.py' } }, NOW);
  assert.equal(b.toolActivity, 'docs');
});
