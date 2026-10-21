# Role Agents (역할자 자동 검토) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code 세션이 파일을 편집하고 응답을 끝내면, PM·개발자·QA 등 역할자가 읽기 전용 `claude -p`로 자동 검토하고, 그 모습을 사무실 화면(역할자 아바타·판정 배지·보고서 패널)과 보고서 파일로 보여준다. 역할은 `roles/<id>.md` 파일 추가로 확장한다.

**Architecture:** 서버로 들어오는 모든 이벤트(화면 팀에 안 맞는 것 포함)를 `ReviewTracker`가 세션별로 모아 검토 시점을 정하고, `ReviewScheduler`가 저장소별 중복·동시 실행·일일 한도를 관리하며 역할마다 `runRole`(읽기 전용 `claude -p`)을 실행한다. 결과는 `ReviewStore`(파일)와 `state`(화면 스냅샷)에 반영된다. git 정보(diff)는 서버가 만들어 프롬프트로 주고, 역할자에게는 셸 도구를 주지 않는다.

**Tech Stack:** 기존과 같음 (Node 22 ESM, `node:test`, 의존성 추가 없음). git은 `execFile`로 호출(셸 미사용). 화면은 기존 Three.js + CSS2D.

**Spec:** `/home/hyeanjae/projects/claude-office/docs/superpowers/specs/2026-10-21-role-agents-design.md` (이 계획은 기존 `docs/superpowers/plans/2026-10-21-claude-office.md` 구조 위에 얹는다)

## Global Constraints

- 역할자 도구는 `Read`, `Grep`, `Glob`만. `tools`에 그 밖의 것이 있는 역할 파일은 거부(오류). 셸 도구는 주지 않는다. 쓰기 계열(`Edit`,`Write`,`NotebookEdit`,`Bash`,`WebFetch`,`WebSearch`,`Task`,`Agent`)은 `--disallowedTools`로도 막는다.
- 역할자 프로세스: `--setting-sources ''`, `--no-session-persistence`, 환경변수 허용 목록만, `CLAUDE_OFFICE_ROLE=1`, 작업 폴더는 저장소 루트. `hook.js`는 `CLAUDE_OFFICE_ROLE` 또는 `CLAUDE_OFFICE_SUMMARIZER`가 있으면 즉시 종료.
- 기본값: `roles.default=["pm","developer","qa"]`, `cooldownMinutes=5`, `minWrites=1`, `dailyLimit=120`(역할자 프로세스 수, KST 자정 기준, `data/reviews/_counter.json`에 저장), 전체 동시 실행 3, 역할당 제한 180초, `deliver="report"`(다른 값은 v1에서 오류).
- 입력 한도: diff 60KB(초과 시 파일 목록+통계만), 요청 최대 5개×300자, 마지막 응답 2000자, 역할 프롬프트 20KB. 모든 문맥·보고서는 `maskSecrets` 후 사용. `.env*`, `*.pem`, `*.key`, `id_*`, `*secret*`, `*credentials*`, `.ssh/`·`.aws/` 아래 파일은 diff에서 내용 제외(파일명만 "설정 파일"로 표기).
- 검토 단위 = 편집된 파일이 속한 git 저장소 루트. git 저장소가 아닌 파일은 검토하지 않는다. 세션이 홈 폴더에서 열려도 홈 전체를 diff하지 않는다.
- 보고서: `claude-office/data/reviews/<저장소명>-<해시8>/<시각>-<review id>.json`, `latest.md`, 저장소당 최근 200개 보관, 폴더 권한 0700. `data/`는 `.gitignore`.
- 판정 값: 역할 `ok|concern|block|failed`, 팀 종합 `ok|concern|block`(failed는 concern으로 센다). 화면 배지: ✓ / ⚠ n / ⛔.
- 시간 표기 KST, 사용자 대면 문구는 한국어, 서버는 `127.0.0.1`·Host/Origin 검사 유지(새 `GET /api/reviews`도 동일).
- 역할 추가 = `roles/<id>.md`(frontmatter: `name`, `color`, `model`, `when`, `tools`). 알 수 없는 frontmatter 키 거부.

## Review Focus

1. 세션을 홈 폴더에서 열고 두 저장소의 파일을 편집한 경우: 저장소별로 따로 검토되고 홈 폴더 전체 diff는 만들어지지 않는다. (Task 4, 5)
2. 역할자 출력이 JSON이 아닌 문장, 코드 펜스(```json) 포함, 앞뒤 설명 포함, 빈 출력, 알 수 없는 verdict/severity인 경우: 관대하게 파싱하거나 `failed/concern`으로 표시하고 서버는 죽지 않는다. (Task 3)
3. diff·요청·응답에 비밀값(토큰, `.env` 변경, 키 파일)이 있는 경우: 프롬프트·보고서·화면·로그 어디에도 원문이 없다. (Task 4, 6)
4. 일일 한도 도달, 날짜 바뀜(KST 자정), 서버 재시작: 카운터가 유지되고 한도 도달은 오류 없이 건너뛰며 화면에 한 줄로 알린다. (Task 6, 8)
5. `tools`에 `Bash`/`Edit`가 들어간 역할 파일, 알 수 없는 역할 id, 알 수 없는 frontmatter 키: 서버 시작 시 명확한 한국어 오류. 역할자가 민감 파일(`.env`, `~/.ssh`)을 읽으려 하면 거부된다. (Task 2, 7)

---

## File Structure

```
claude-office/
  roles/pm.md developer.md qa.md security.md docs.md      # 역할 정의(내용은 사용자가 고칠 수 있음)
  src/roles/loader.js        # loadRoles, rolesFor
  src/roles/parse.js         # parseRoleOutput, aggregateVerdict
  src/roles/context.js       # repoRootOf, groupFilesByRepo, buildDiff, buildPrompt
  src/roles/tracker.js       # createReviewTracker (언제 검토할지)
  src/roles/store.js         # createReviewStore (보고서·카운터)
  src/roles/runner.js        # buildRoleSpawn, runRole
  src/roles/scheduler.js     # createScheduler (큐·한도·역할 실행)
  src/events.js (수정)       # toolName, filePath, promptText, assistantText 추가
  src/config.js (수정)       # roles 설정 검증
  src/state.js (수정)        # 역할자 팀원·배지·최근 검토
  src/server.js (수정)       # 배선, GET /api/reviews
  src/hook.js (수정)         # CLAUDE_OFFICE_ROLE 가드
  public/ (수정)             # 역할자 아바타·배지·보고서 패널
  test/roles-*.test.js
```

---

### Task 1: 이벤트 보강과 hook 가드

**Files:**
- Modify: `src/events.js`, `src/hook.js`
- Test: `test/events.test.js`, `test/hook.test.js`

**Interfaces:**
- Produces: `OfficeEvent`에 선택 필드 추가 — `toolName?: string`(tool/toolDone), `filePath?: string`(편집 도구의 `file_path`/`notebook_path` 원문, 마스킹하지 않음, 1000자 제한, UI·LLM으로 직접 보내지 않는 서버 내부용), `promptText?: string`(prompt 이벤트, 마스킹 후 앞 300자), `assistantText?: string`(stop 이벤트의 `last_assistant_message`, 마스킹 후 앞 2000자).
- Produces: `hook.js`는 `CLAUDE_OFFICE_ROLE`이 설정돼 있으면 아무것도 보내지 않고 종료 코드 0.

- [ ] **Step 1: 실패하는 테스트** — `PreToolUse Edit {file_path:'/r/a.js'}` → `{type:'tool', toolName:'Edit', filePath:'/r/a.js'}`; Read 도구는 `filePath` 없음(편집 도구만); `NotebookEdit`은 `notebook_path`를 `filePath`로; `UserPromptSubmit {prompt:'요청 …'}` → `promptText`(비밀값 마스킹, 300자 제한, `<task-notification>`은 여전히 null); `Stop {last_assistant_message:'… sk-…'}` → `assistantText`(마스킹, 2000자 제한); 기존 테스트 전부 유지. hook: `CLAUDE_OFFICE_ROLE=1`이면 서버에 아무것도 도착하지 않는다.
- [ ] **Step 2: 실행해 FAIL 확인.** Run: `node --test test/events.test.js test/hook.test.js` / Expected: 새 테스트만 FAIL
- [ ] **Step 3: `normalizeEvent`와 `hook.js` 구현.** 편집 도구 집합 `EDIT_TOOLS = {Edit, Write, NotebookEdit, MultiEdit}`.
- [ ] **Step 4: 전체 통과 확인.** Run: `npm test` / Expected: PASS
- [ ] **Step 5: Commit** — `feat: events carry tool name, edited file path, prompt and last response; hook role guard`

### Task 2: 역할 로더와 설정

**Files:**
- Create: `src/roles/loader.js`, `roles/pm.md`, `roles/developer.md`, `roles/qa.md`, `roles/security.md`, `roles/docs.md`
- Modify: `src/config.js`
- Test: `test/roles-loader.test.js`, `test/config.test.js`

**Interfaces:**
- Produces: `loadRoles(dir: string): Map<string, Role>` — `Role = { id, name, color, model, when: 'always'|'code'|'docs', tools: string[], prompt: string }`. `id`는 파일명(확장자 제외, `[a-z0-9_-]+`). frontmatter 파싱은 `key: value` 줄과 `tools: [A, B]`만 지원(YAML 라이브러리 미사용). 오류는 `Error("역할 <id>: <사유>")`: 알 수 없는 키, `tools`에 `Read|Grep|Glob` 외 항목, 필수 키(`name`) 없음, `when` 값 오류, 프롬프트 20KB 초과, `color`가 `#rrggbb`가 아님. `model` 기본 `sonnet`, `when` 기본 `always`, `tools` 기본 `[Read, Grep, Glob]`.
- Produces: `config.roles = { enabled: true, default: string[], cooldownMinutes: number, minWrites: number, dailyLimit: number, deliver: 'report', projects: Record<string, { roles?: string[], cooldownMinutes?: number, minWrites?: number }> }` (기본값은 Global Constraints). `loadConfig`가 형식을 검증한다(`deliver`가 `report`가 아니면 오류).
- Produces: `rolesFor(config: Config, repoRoot: string, teamName?: string): string[]` — 우선순위: 팀 항목(`projects[]`의 `roles`) → `roles.projects`에서 가장 긴 경로 접두사 → `roles.default`. `validateRoleIds(config: Config, known: Map<string, Role>): void` — 알 수 없는 id가 어디에든 있으면 `Error`.
- Produces: `roles/*.md` 5개(보안·문서는 `roles.default`에 포함되지 않음). 각 프롬프트 본문은 역할 지침(한국어)이며 출력 형식은 `buildPrompt`가 덧붙인다.

- [ ] **Step 1: 실패하는 테스트(loader)** — 임시 폴더에 역할 파일을 만들어: 정상 파싱(기본값 채움), `tools: [Read, Bash]` → Error(메시지에 역할 id와 `Bash` 포함), 알 수 없는 키 → Error, `name` 없음 → Error, 21KB 프롬프트 → Error, `color: red` → Error, 같은 id 중복은 파일 시스템상 불가이므로 제외. 실제 `roles/` 폴더의 5개가 모두 로드되고 `pm|developer|qa`의 `when`이 각각 `always|code|always`(구현에서 확정한 값과 일치)인지 검사.
- [ ] **Step 2: 실패하는 테스트(config)** — `roles` 기본값, `deliver:'session'` → Error, `rolesFor`의 우선순위 3단계와 가장 긴 접두사 규칙(`/a/b`와 `/a/bc` 경계), `validateRoleIds`의 알 수 없는 id(전역·`roles.projects`·팀 항목 각각).
- [ ] **Step 3: FAIL 확인.** Run: `node --test test/roles-loader.test.js test/config.test.js`
- [ ] **Step 4: 구현.** 역할 프롬프트는 짧고 구체적으로: PM(요구사항 충족·범위 이탈·누락), 개발자(버그·예외 처리·테스트 부재), QA(검증 시나리오·회귀 위험·엣지 케이스), 보안(비밀값·입력 검증·권한), 문서(README·주석·변경 설명 누락).
- [ ] **Step 5: 통과 확인, Commit** — `feat: role loader, role files, roles config`

### Task 3: 출력 파서와 종합 판정

**Files:**
- Create: `src/roles/parse.js`
- Test: `test/roles-parse.test.js`

**Interfaces:**
- Produces: `parseRoleOutput(text: string, roleId: string): RoleResult` — `RoleResult = { roleId, verdict: 'ok'|'concern'|'block'|'failed', summary: string(최대 80자), findings: Finding[], error?: string }`, `Finding = { severity: 'info'|'minor'|'major'|'critical', text: string(최대 300자), file?: string, line?: number }`. 순수 함수이며 예외를 던지지 않는다. 처리: 앞뒤 설명 문장·```json 코드 펜스를 벗기고 첫 번째 균형 잡힌 `{…}`를 파싱; 알 수 없는 `verdict`→`concern`, 알 수 없는 `severity`→`minor`; `findings`가 배열이 아니면 빈 배열; 파싱 불가·빈 출력이면 `{verdict:'failed', error:'형식 오류'|'빈 응답', summary: 원문 앞 60자}`; 모든 문자열은 `maskSecrets` 적용; `verdict:'ok'`인데 `critical|major` 지적이 있으면 `concern`으로 올린다.
- Produces: `aggregateVerdict(results: RoleResult[]): 'ok'|'concern'|'block'` — block이 하나라도 있으면 block, concern·failed가 있으면 concern, 아니면 ok(빈 목록은 ok). `countConcerns(results): number` — ok가 아닌 역할의 지적(`minor` 이상) 수 + failed 역할 수.

- [ ] **Step 1: 실패하는 테스트** — 정상 JSON, 코드 펜스, 앞뒤 설명, 중첩 중괄호가 든 문자열 값, 알 수 없는 verdict/severity, `findings: "x"`, 빈 문자열·`null`·숫자·JSON 아님, 비밀값(`sk-…`) 마스킹, 긴 summary 자르기, ok+major 승격, `aggregateVerdict`의 4가지 조합과 빈 목록, `countConcerns`. *(Review Focus 2)*
- [ ] **Step 2: FAIL 확인, 구현(균형 괄호 스캔은 문자열 안의 괄호·이스케이프를 무시), 통과 확인, Commit** — `feat: tolerant role output parser and verdict aggregation`

### Task 4: git 문맥과 프롬프트 만들기

**Files:**
- Create: `src/roles/context.js`
- Modify: `src/mask.js` (`isSensitivePath(path: string): boolean` 내보내기, 기존 내부 규칙 재사용)
- Test: `test/roles-context.test.js`, `test/mask.test.js`

**Interfaces:**
- Produces: `repoRootOf(filePath: string): Promise<string | null>` — 파일의 가장 가까운 존재하는 상위 폴더에서 `git rev-parse --show-toplevel`; 저장소가 아니면 `null`; 같은 폴더 결과는 캐시. `groupFilesByRepo(files: string[]): Promise<Map<string, string[]>>` — 저장소 밖 파일은 제외, 중복 제거, 저장소 루트 아래 상대 경로가 아니라 절대 경로 유지.
- Produces: `buildDiff(repoRoot: string, files: string[], opts?: { limit?: number }): Promise<{ diff: string, truncated: boolean, stats: string, excluded: string[] }>` — `git -C <root> diff HEAD -- <files>`(`execFile`, maxBuffer 제한), 추적되지 않는 새 파일은 앞 4KB만 `diff` 형태로 포함, `isSensitivePath`인 파일은 내용 대신 `excluded`에 넣고 diff에 "설정 파일 변경(내용 제외)" 한 줄, `diff`는 `maskSecrets` 적용, 합계가 `limit`(기본 60000)을 넘으면 `diff`는 비우고 `truncated: true`와 `stats`(`git diff --stat`)만 사용. HEAD가 없는 저장소(첫 커밋 전)에서도 동작.
- Produces: `buildPrompt(role: Role, bundle: Bundle): string` — `Bundle = { repoRoot, repoName, requests: string[], lastResponse: string, files: string[], diff: string, truncated: boolean, stats: string, excluded: string[] }`. 구성: 역할 지침 → 읽기 전용 규칙("파일을 수정·실행하지 말고, `.env`·키 파일은 읽지 마라") → 사용자 요청들 → Claude의 마지막 응답 → 변경 파일 목록 → diff(또는 통계) → **출력 형식 지침(JSON 스키마, 한국어 summary 60자)**. 모든 사용자 유래 텍스트는 `maskSecrets` 적용, 요청 5개×300자·응답 2000자 제한 재적용.

- [ ] **Step 1: 실패하는 테스트** — 임시 git 저장소 2개와 저장소 아닌 폴더를 만들어: `groupFilesByRepo`가 두 저장소로 나누고 폴더 밖 파일 제외 *(Review Focus 1)*, 홈 같은 큰 폴더가 아니라 파일 소속 저장소 루트를 돌려줌; `buildDiff`: 수정 파일 diff 포함, `.env` 수정은 내용 제외·`excluded`에 기록 *(Review Focus 3)*, diff 속 `ghp_…` 토큰 마스킹, 새 파일 앞부분 포함, 60KB 초과 시 `truncated`와 통계만, 커밋 없는 저장소 동작; `buildPrompt`: 비밀값이 든 요청·응답이 마스킹되고 출력 형식 지침과 읽기 전용 규칙이 항상 들어 있음, 요청 6개를 주면 최근 5개만; `isSensitivePath` 표(`.env`, `a/.ssh/config`, `x.pem`, `src/app.js`).
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인, Commit** — `feat: git diff context and reviewer prompt builder`

### Task 5: 검토 시점 추적기

**Files:**
- Create: `src/roles/tracker.js`
- Test: `test/roles-tracker.test.js`

**Interfaces:**
- Consumes: `OfficeEvent`(Task 1), `groupFilesByRepo`(Task 4, 주입 가능: `opts.repoGroups`).
- Produces: `createReviewTracker(opts: { config: Config, now?: () => number, groupFiles: (files: string[]) => Promise<Map<string, string[]>>, onDue: (job: ReviewJob) => void, quietMs?: number }): { onEvent(ev: OfficeEvent): void, tick(): Promise<void>, pendingCount(): number }` — `ReviewJob = { repoRoot: string, sessionId: string, files: string[], requests: string[], lastResponse: string, team?: string(호출자가 채움) , reason: 'stop'|'deferred' }`.
- 규칙(세션별 상태: 편집 파일 집합, 요청 목록, 마지막 응답, 마지막 활동 시각): `prompt` → 요청 추가(최대 5개 유지); 편집 도구의 `tool`+`filePath` → 파일 추가; `stop` → 그 세션의 팀원이 없을 때(`agentStart`/`agentStop` 추적) `groupFiles`로 저장소별 묶음을 만들고, 저장소마다 파일 수 ≥ `minWrites`(해당 저장소의 `roles.projects` 덮어쓰기 반영)이고 마지막 검토 시작 후 `cooldownMinutes`가 지났으면 `onDue({reason:'stop'})`; 쿨다운 중이면 보류로 남김; `tick()` → 보류 중인 저장소의 쿨다운이 끝났고 그 세션이 `quietMs`(기본 30초) 이상 조용하면 `onDue({reason:'deferred'})`; `end` → 세션 상태 삭제(보류 중이던 변경은 즉시 `deferred`로 한 번 내보낸다). 검토가 시작되면(`onDue` 호출 시) 그 저장소의 파일 집합을 비우고 마지막 검토 시각을 기록한다.

- [ ] **Step 1: 실패하는 테스트** — 가짜 시계와 가짜 `groupFiles`로: 편집 없이 stop → due 없음; Edit 후 stop → due 1회(파일·요청·응답 포함); 같은 저장소에서 쿨다운 안의 두 번째 stop → due 없음, 쿨다운 후 조용하면 `tick`이 `deferred`로 1회; 조용하지 않으면 보류 유지; 세션이 두 저장소를 편집하면 저장소별 due 2개 *(Review Focus 1)*; 팀원이 남은 채 stop → due 없음, 모두 퇴근 후 stop → due; Read 도구 편집 아님; `roles.projects`의 `minWrites: 3` 덮어쓰기; 다른 세션이 같은 저장소를 편집해도 파일 집합은 세션별로 분리되고 쿨다운은 저장소 공유; `end`가 보류 변경을 내보냄; 요청 6개 중 최근 5개; `host`가 있는 원격 이벤트는 무시(원격 PC 검토 제외); 알 수 없는 입력에도 예외 없음.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인, Commit** — `feat: review tracker (when to review)`

### Task 6: 보고서 저장소와 일일 카운터

**Files:**
- Create: `src/roles/store.js`
- Modify: `.gitignore`(`data/`)
- Test: `test/roles-store.test.js`

**Interfaces:**
- Produces: `createReviewStore(opts: { dir: string, now?: () => number, keep?: number }): ReviewStore`.
  - `Review = { id: string, repoRoot: string, repoName: string, team?: string, startedAt: number, finishedAt: number, verdict: 'ok'|'concern'|'block', concerns: number, results: RoleResult[], files: string[], notes?: string[] }` (`results`·`notes`의 문자열은 저장 전 `maskSecrets`, 사용자 요청 원문은 저장하지 않는다).
  - `save(review: Review): void` — `<dir>/<repoName>-<hash8>/<finishedAt>-<id>.json`, 저장소 폴더 0700, 저장 후 최근 `keep`(기본 200)개만 남기고 삭제, `latest.md` 재생성(역할마다 가장 최근 결과, KST 시각, 한국어).
  - `list(limit?: number): Review[]`(전체 최근순), `forRepo(repoRoot: string, limit?: number): Review[]`, `latestFor(repoRoot: string): Review | null`.
  - `counter: { used(): number, add(n: number): void }` — `<dir>/_counter.json`에 `{ date: 'YYYY-MM-DD'(KST), used }` 저장, 날짜(KST)가 바뀌면 0으로 초기화, 파일이 깨져 있으면 0으로 시작, 쓰기는 임시 파일 후 이름 변경.
  - `kstDate(ms: number): string`.

- [ ] **Step 1: 실패하는 테스트** — 저장 후 `list`/`forRepo`/`latestFor`; 201개 저장 시 200개만 남음; 폴더 권한 `0700`; `latest.md`에 역할별 결과와 KST 시각이 들어가고 비밀값(`sk-…`)이 없음 *(Review Focus 3)*; 카운터: `add`가 합산되고 새 저장소 인스턴스(재시작)에서도 유지, UTC 15:00 직후(= KST 자정)에 0으로 초기화되는 경계, 깨진 `_counter.json`에서 오류 없이 0 *(Review Focus 4)*; 같은 이름의 서로 다른 저장소 경로가 다른 폴더(해시)로 저장.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인, Commit** — `feat: review store with daily counter`

### Task 7: 읽기 전용 역할 실행기

**Files:**
- Create: `src/roles/runner.js`
- Test: `test/roles-runner.test.js`

**Interfaces:**
- Produces: `buildRoleSpawn(role: Role, prompt: string, repoRoot: string): { args: string[], options: object }` — 인자: `-p <prompt> --model <role.model> --setting-sources "" --allowedTools <role.tools…> --disallowedTools Edit Write NotebookEdit MultiEdit Bash WebFetch WebSearch Task Agent` + 민감 경로 읽기 거부 규칙(`Read(**/.env*)`, `Read(**/*.pem)`, `Read(**/*.key)`, `Read(**/id_*)`, `Read(~/.ssh/**)`, `Read(~/.aws/**)`, `Read(~/.gnupg/**)`와 같은 Grep/Glob 규칙) `--no-session-persistence`; `options`: `cwd: repoRoot`, `stdio: ['ignore','pipe','pipe']`, 환경변수는 `PATH, HOME, USER, LANG, LC_ALL, TMPDIR, XDG_*`만 + `CLAUDE_OFFICE_ROLE=1`.
- Produces: `runRole(args: { role: Role, prompt: string, repoRoot: string, timeoutMs?: number, spawnFn?: typeof spawn }): Promise<string>` — 표준출력을 모아 돌려주고, 종료 코드 ≠ 0 또는 시간 초과(기본 180초, 초과 시 프로세스 종료)이면 `Error('시간 초과'|'실행 실패: …')`.

- [ ] **Step 1: 실패하는 테스트(가짜 spawn)** — `buildRoleSpawn`: `Bash`/`Edit`가 `--allowedTools`에 없고 `--disallowedTools`에 있음, `--setting-sources`의 값이 빈 문자열, 환경에 `SUPER_SECRET` 같은 임의 변수가 없고 `CLAUDE_OFFICE_ROLE=1`이 있음, `cwd`가 저장소 루트; `runRole`: 정상 출력 반환, 종료 코드 1이면 Error, 가짜 타이머로 180초 초과 시 Error와 프로세스 종료 호출, 큰 출력(5MB)도 처리.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인.**
- [ ] **Step 3: 실제 `claude`로 읽기 전용·민감 파일 거부 검증(수동, 결과를 `docs/roles-verification.md`에 기록)** — 임시 git 저장소에 `.env`(가짜 값 `FAKE_SECRET_VALUE_12345`)와 소스 파일을 만들고, `buildRoleSpawn`으로 실행해 (a) 정상 파일 읽기와 JSON 형식 응답이 나오는지, (b) 프롬프트로 ".env를 읽어라", "파일을 수정해라", "`ls`를 실행해라"를 시켰을 때 모두 거부되고 파일이 바뀌지 않고 응답에 `FAKE_SECRET_VALUE_12345`가 없는지 확인한다. 거부가 안 되면 `--disallowedTools` 규칙 문법을 고치고 다시 확인한다. 이 단계가 통과하지 못하면 이후 작업을 진행하지 않는다.
- [ ] **Step 4: Commit** — `feat: read-only role runner with verified deny rules`

### Task 8: 검토 스케줄러

**Files:**
- Create: `src/roles/scheduler.js`
- Test: `test/roles-scheduler.test.js`

**Interfaces:**
- Consumes: `Role`/`rolesFor`(Task 2), `parseRoleOutput`/`aggregateVerdict`/`countConcerns`(Task 3), `buildDiff`/`buildPrompt`(Task 4), `ReviewStore`(Task 6), `runRole`(Task 7, 주입).
- Produces: `createScheduler(opts: { config: Config, roles: Map<string, Role>, store: ReviewStore, run: (a: { role: Role, prompt: string, repoRoot: string }) => Promise<string>, buildBundle?: (job: ReviewJob) => Promise<Bundle>, resolveTeam?: (job: ReviewJob) => string | undefined, emit: (e: ReviewEvent) => void, now?: () => number, concurrency?: number }): { submit(job: ReviewJob): void, idle(): Promise<void>, stats(): { running: number, queued: number, dailyUsed: number, limitReached: boolean } }`.
- `ReviewEvent`: `{ type:'start', repoRoot, repoName, team?, roles: {id,name,color}[] }` | `{ type:'role', repoRoot, team?, roleId, status:'running'|'done'|'failed', summary? }` | `{ type:'done', repoRoot, team?, review: Review }` | `{ type:'skipped', repoRoot, team?, reason:'limit'|'no-roles'|'no-files' }`.
- 규칙: 역할 선택은 `rolesFor(config, repoRoot, team)`를 `when`(`code`: 코드 확장자 파일이 있을 때, `docs`: `.md|.txt|.rst` 파일이 있을 때)으로 거른다; 선택된 역할 수만큼 일일 카운터 여유가 있어야 시작하고 부족하면 `skipped:'limit'`; 같은 저장소가 실행 중이면 새 job은 "다시 필요"로 표시만 하고, 끝난 뒤 쿨다운(`cooldownMinutes`)이 지났을 때 한 번만 재제출; 전체 동시 실행 `concurrency`(기본 3) 초과분은 대기열; 역할이 실패하면 `failed` 결과로 기록하고 나머지는 계속; 완료 시 `store.save`, 카운터 `add(역할 수)`, `done` 이벤트; 서버 종료 시 진행 중 job은 버려진다(오류 없이).

- [ ] **Step 1: 실패하는 테스트(가짜 run·가짜 store·가짜 buildBundle)** — 정상 흐름: start→role×3→done 순서와 저장·카운터 증가; `when: code`인 보안 역할이 문서만 바뀐 job에서 제외; 한 역할 예외 시 failed 결과와 나머지 정상; 동시에 5개 역할 실행 요청 시 동시 실행이 3을 넘지 않음; 같은 저장소 중복 job이 병렬 실행되지 않고 "다시 필요"가 한 번만 재실행; 일일 한도 도달 시 `skipped:'limit'`이고 카운터 불변·예외 없음 *(Review Focus 4)*; 알 수 없는 역할 id는 건너뛰고 `no-roles`; run이 JSON 아닌 문장을 돌려주면 `failed`/`concern`으로 기록 *(Review Focus 2)*; 저장된 review에 사용자 요청 원문이 없음.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인, Commit** — `feat: review scheduler (queue, limits, role runs)`

### Task 9: 서버·상태 통합과 보고서 API

**Files:**
- Modify: `src/state.js`, `src/server.js`
- Test: `test/state.test.js`, `test/server.test.js`

**Interfaces:**
- Consumes: Task 1~8 전부.
- Produces(state): `Team`에 `roles: { id: string, name: string, color: string, status: 'running'|'done'|'failed', label: string }[]`(검토 중이거나 끝난 지 `ROLE_LINGER_MS`(기본 8초) 이내인 역할자)와 `badge: { verdict: 'ok'|'concern'|'block', concerns: number, at: number } | null`을 추가한다. `Snapshot`에 `reviews: { repoName: string, team?: string, verdict, concerns: number, at: number, summary: string }[]`(최근 20건)와 `reviewNotice?: string`(예: "오늘 검토 한도에 도달했습니다")를 추가한다. 함수: `applyReviewEvent(state: State, ev: ReviewEvent, now: number): void`, `setReviewHistory(state, reviews: Review[]): void`.
- Produces(server): `startServer`에 `roles?: Map<string, Role>`, `reviewStore?`, `reviewRun?`(기본 `runRole`), `rolesDir?` 옵션. `config.roles.enabled`가 참이고 `roles`가 있으면 모든 이벤트를 **지정하지 않은 폴더 조기 반환 이전에** `tracker.onEvent`에 먼저 넘긴다. `onDue`는 `resolveTeam`(세션의 팀 → 저장소 경로를 덮는 팀 → 없음)을 채워 `scheduler.submit`. 스케줄러 이벤트는 `applyReviewEvent` 후 브로드캐스트. 30초 `tick`에서 `tracker.tick()` 호출. `GET /api/reviews?repo=<저장소 루트>`는 `store.forRepo(repo, 20)`을 JSON으로 돌려준다(없으면 `[]`; `repo` 없으면 `store.list(20)`; 기존 Host/Origin 검사 적용, `repo`에 경로 문자열 외 입력은 400). 서버 시작 시 `validateRoleIds`로 검증하고 실패하면 한국어 오류로 시작을 중단한다. 서버 종료 시 스케줄러/타이머 정리.

- [ ] **Step 1: 실패하는 테스트(state)** — `applyReviewEvent`: start→팀의 `roles`에 3명(running), role done/failed 갱신, done→`badge` 설정·역할자는 `ROLE_LINGER_MS` 뒤 스냅샷에서 사라짐, 팀이 없는 저장소의 `done`은 `reviews` 목록에만 반영, `skipped:'limit'`→`reviewNotice`; 기존 스냅샷 필드 불변.
- [ ] **Step 2: 실패하는 테스트(server, 가짜 run과 임시 git 저장소·임시 store)** — Edit 이벤트 후 Stop을 POST하면 WebSocket 스냅샷에 역할자 3명이 나타났다가 `badge`가 생기고 `reviews`에 항목이 생김; 세션이 홈 폴더(`cwd`)에서 두 저장소를 편집하면 저장소마다 검토 *(Review Focus 1)*; 지정하지 않은 폴더 세션의 검토도 `GET /api/reviews`로 보임; `GET /api/reviews`가 다른 Origin/Host에서 403; 비밀값이 든 diff가 가짜 `run`의 프롬프트에 원문으로 전달되지 않음 *(Review Focus 3)*; `tools`에 `Bash`가 든 역할 파일이 있으면 `startServer`가 한국어 오류로 reject *(Review Focus 5)*; `config.roles.enabled=false`면 검토 없음; 검토 진행 중 서버 종료가 오류 없이 끝남.
- [ ] **Step 3: FAIL 확인, 구현, 통과 확인.** Run: `npm test` / Expected: 전부 PASS
- [ ] **Step 4: Commit** — `feat: wire role reviews into server and state, add /api/reviews`

### Task 10: 화면 — 역할자 아바타·배지·보고서 패널

**Files:**
- Modify: `public/js/scene.js`, `public/js/main.js`, `public/index.html`

**Interfaces:**
- Consumes: 스냅샷의 `team.roles`, `team.badge`, `snapshot.reviews`, `snapshot.reviewNotice`, `GET /api/reviews`.
- Produces: 역할자는 기존 팀원과 같은 방식으로 입구에서 들어와 팀 책상 구역에 앉아 일하고(`running`), 끝나면 퇴근한다. 이름표는 역할 이름, 셔츠 색은 역할 색, 말풍선은 상태 문구("검토 중", "문제 발견", "검토 실패"). 팀장 머리 옆에 판정 배지(✓ 초록 / ⚠ n 주황 / ⛔ 빨강)를 CSS2D로 표시하고 다음 검토까지 유지. 화면 오른쪽 위 "보고서" 버튼 → 패널(최근 검토 목록: 프로젝트, 판정, 시각 KST, 한 줄 요약; 항목 클릭 시 `/api/reviews?repo=`로 지적 상세: 역할, 심각도, 파일·줄, 설명). `reviewNotice`는 패널 상단에 한 줄. 모든 텍스트는 `textContent`로만 넣는다(HTML 주입 금지).
- 데모용: 서버에 환경변수 `CLAUDE_OFFICE_FAKE_ROLES=1`이면 `reviewRun`이 역할별 고정 JSON(ok/concern/block 순환)을 1~3초 뒤 돌려주는 가짜 실행기를 쓴다(화면 검증용, 기본 꺼짐).

- [ ] **Step 1: 구현.** 기존 팀원 엔티티 생성/제거 경로(`disposeEntity` 포함)를 재사용하고, 퇴근한 역할자의 DOM·GPU 정리를 보장한다.
- [ ] **Step 2: Playwright로 확인(가짜 실행기, 1280×820):** (a) Edit+Stop 이벤트 후 역할자 3명이 팀 구역에 나타나 일하고 퇴근한 뒤 배지가 팀장 곁에 남음, (b) 보고서 패널에 목록·상세가 표시되고 상세의 `<script>` 같은 문자열이 그대로 글자로 보임(주입 없음), (c) 퇴근 후 `#overlay` 자식 수가 기준값으로 돌아옴, (d) 역할자 5명(4명 초과)이면 "+N", (e) 콘솔 오류 0건, 스크린샷 확인.
- [ ] **Step 3: Commit** — `feat: role agent avatars, verdict badge and report panel`

### Task 11: 종단 확인과 문서

**Files:**
- Modify: `README.md`, `docs/hook-payloads.md`
- Create: `docs/roles-verification.md`(Task 7에서 시작), `docs/roles-howto.md`

- [ ] **Step 1: 실제 `claude`로 종단 확인** — 임시 git 저장소에서 서버를 켜고(`CLAUDE_OFFICE_FAKE_ROLES` 없이), 이 저장소를 편집하는 실제 `claude -p` 세션(프로젝트 로컬 hook만)을 돌려 Edit 후 Stop이 오면 실제 역할자 3명이 실행되어 보고서(JSON·`latest.md`)가 생기고, 보고서·로그에 비밀값 원문이 없고, 역할자가 프로젝트 파일을 바꾸지 않았음(`git status` 동일)을 확인한다. 쿨다운 안의 두 번째 편집이 즉시 검토되지 않고 쿨다운 후 타이머로 검토되는지 확인한다.
- [ ] **Step 2: 문서** — `README.md`에 역할자 개요·설정(`roles`)·보고서 위치·한계(Bash 편집 미검출, git 아닌 폴더 제외, 원격 PC 제외)·비용 안내, `docs/roles-howto.md`에 "새 역할 추가하기"(예시 파일 포함)와 역할 파일 문법·검증 오류 목록.
- [ ] **Step 3: 배포 확인** — 전역 설정 변경은 없다(기존 hook이 그대로 신호를 보냄). 서비스 재시작(`systemctl --user restart claude-office`) 후 실제 작업에서 첫 검토가 도는지 확인하고, 구독 사용량 안내와 함께 결과를 보고한다.
- [ ] **Step 4: Commit** — `docs: role agents usage and verification`

---

## Self-Review

- **스펙 커버리지:** §3-1 보고만(`deliver` 값 검증) → Task 2·9, §3-2 트리거 → Task 5, §3-3·§6 읽기 전용 실행 → Task 7(+검증), §3-4 보고서 저장 → Task 6, §3-5 비용 제한 → Task 2·6·8, §3-6 기본/선택 역할 → Task 2, §4.1 역할 파일 → Task 2, §4.2 문맥 → Task 4, §4.3 출력 형식 → Task 3·4, §4.4 화면 → Task 10, §5.1 규칙 → Task 5·8, §5.2 식별·설정 → Task 2·4·5·9, §5.3 실패·한도·보관·API → Task 6·8·9, §6 보안 전반 → Task 1(hook 가드)·4·6·7·9. 빠진 것 없음. 원격 PC 제외는 Task 9에서 원격 이벤트가 추적기에 들어가지 않도록 `ev.host`가 있으면 무시(구현 항목: Task 5 테스트에 포함).
- **타입 일관성:** `ReviewJob`(Task 5)을 Task 8·9가 같은 필드로 사용, `Review`/`RoleResult`(Task 3·6)를 Task 8·9·10이 사용, `ReviewEvent`(Task 8)를 Task 9의 `applyReviewEvent`가 소비.
- **비례:** 설계 문서 대비 계획은 시그니처·규칙·테스트 항목 위주이며 함수 본문은 넣지 않았다.
