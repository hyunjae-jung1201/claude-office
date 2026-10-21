# Claude Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지정한 5개 프로젝트의 Claude Code 상태를 hook으로 받아, 브라우저 탭의 3D 아이소메트릭 사무실에서 팀장(메인)·팀원(하위 에이전트) 아바타로 보여준다.

**Architecture:** Claude Code hook 스크립트가 로컬 서버로 이벤트를 POST → 서버가 마스킹·상태 계산·요약 후 WebSocket으로 스냅샷을 브로드캐스트 → 정적 웹 페이지(Three.js)가 렌더링. 상태 계산과 방 배치는 순수 함수로 분리해 Node 테스트로 검증한다.

**Tech Stack:** Node 22 (ESM, 빌드 도구 없음), `ws@8.18.0`, `three@0.160.0`(서버가 `/vendor/three`로 제공), 테스트는 `node:test`, 서비스는 systemd 사용자 서비스, 화면 검증은 Playwright MCP.

**Spec:** `/home/hyeanjae/projects/claude-office/docs/superpowers/specs/2026-10-21-claude-office-design.md` (목업: `docs/mockups/office-style-v4.html`)

## Global Constraints

- 프로젝트 5개 = 팀 5개. 팀장 = 메인 Claude 세션, 팀원 = 하위 에이전트(일할 때만 나타나고 끝나면 사라짐), 한 팀 최대 표시 4명, 초과는 "+N".
- 상태는 `off | idle | read | write | run | wait` 6종. 색: read `#4c8dff`, write `#13a58a`, run `#8b5cf6`, wait `#f5a524`, idle/off `#8a94a6`.
- 방 매핑: read→자료실, write→작업실(팀 책상), run→서버실, wait→회의실, idle→복도/창가, off→휴게실 소파에서 수면.
- 말풍선: 실제 작업을 한국어 20자 안팎 한 줄. 요약 실패 시 규칙 기반 문구가 기본 동작.
- hook은 도구 호출을 절대 막지 않는다: fire-and-forget, 타임아웃 1초, 서버가 꺼져 있어도 종료 코드 0.
- 서버는 `127.0.0.1`에만 바인딩. 세션 종료 신호 없이 10분(설정값) 조용하면 `off`.
- 같은 프로젝트의 세션이 여러 개면 아바타 1명, 가장 최근 활동 세션을 표시. 지정하지 않은 폴더(홈 포함)의 이벤트는 버린다.
- 비밀값은 요약기에 넘기기 전에 마스킹하고, 말풍선과 로그에도 마스킹된 문장만 쓴다.
- 전역 `~/.claude/settings.json`은 스크립트가 **diff를 보여 주고 사용자가 `--apply`를 줄 때만** 수정한다. 기존 hook은 유지하고 추가만 한다.
- 알림은 화면 안 연출만: 완료(30초 이상 일한 뒤 끝났을 때, 팔 들기 + "완료!" + 초록 링 약 4초), 승인 대기(주황 느낌표 깜빡임). 탭 제목·소리·데스크톱/폰 알림은 만들지 않는다.
- 탭이 숨겨지면 렌더링 중단. 모든 시각 표기는 KST. 사용자 대면 문구는 한국어.

## Review Focus

1. 작업 폴더가 프로젝트의 하위 폴더이거나 지정되지 않은 폴더(홈)일 때: 하위는 가장 긴 접두사 프로젝트로 매핑, 미지정은 무시. (Task 2)
2. 같은 프로젝트에서 세션 2개가 동시에 일할 때: 가장 최근 이벤트의 세션이 표시되고, 한쪽이 끝나도 다른 쪽이 살아 있으면 `off`가 되지 않는다. (Task 4)
3. 필드가 빠졌거나 알 수 없는 hook 페이로드, 깨진 JSON: 서버가 죽지 않고 400을 돌려주며 상태가 바뀌지 않는다. (Task 3, 6)
4. 명령어에 토큰·비밀번호·`.env` 경로가 있을 때: 요약기 입력, 말풍선, 로그 어디에도 원문이 나오지 않는다. (Task 3, 5)
5. 긴 한국어 문구나 서버 재시작: 말풍선이 잘리지 않고 말줄임표로 줄며, 서버가 재시작되어 상태가 비어도 아바타는 `off`(수면)로 시작해 다음 이벤트에서 복구된다. (Task 8, 6)

---

## File Structure

```
claude-office/
  package.json
  config.example.json          # projects[], port, offAfterMinutes, maxMembers
  src/config.js                # loadConfig, matchProject
  src/mask.js                  # maskSecrets
  src/events.js                # normalizeEvent, toolCategory
  src/state.js                 # createState, applyEvent, tick, snapshot
  src/labels.js                # ruleLabel
  src/summarizer.js            # createSummarizer
  src/server.js                # HTTP + WebSocket + static
  src/hook.js                  # Claude Code hook entry (stdin -> POST)
  public/index.html
  public/js/layout.js          # pure: roomPositions, targetFor, memberSeats
  public/js/scene.js           # Three.js office, avatars, bubbles
  public/js/main.js            # WebSocket client, render loop
  scripts/install-hooks.js     # diff / --apply
  scripts/install-service.sh   # systemd user service
  scripts/office-command.md    # /office slash command source
  test/*.test.js
  docs/hook-payloads.md        # Task 1 output
```

---

### Task 1: 프로젝트 골격 + 실제 hook 신호 확인

**Files:**
- Create: `package.json`, `.gitignore`, `src/hook.js`, `scripts/capture-hooks.js`, `docs/hook-payloads.md`

**Interfaces:**
- Produces: `src/hook.js` — stdin의 hook JSON을 `POST http://127.0.0.1:{port}/event`로 보내고(타임아웃 1초) 항상 종료 코드 0. 서버 주소는 환경변수 `CLAUDE_OFFICE_URL`(기본 `http://127.0.0.1:7410`).
- Produces: `docs/hook-payloads.md` — 실제로 받은 이벤트별 필드 목록과 아래 4가지 질문의 답.

- [ ] **Step 1: `git init`, `package.json`(type module, scripts.test = `node --test test/`), `npm i ws@8.18.0 three@0.160.0`**
- [ ] **Step 2: `src/hook.js` 구현.** 요청 본문은 stdin JSON 그대로. 실패·타임아웃은 조용히 무시.
- [ ] **Step 3: 테스트 `test/hook.test.js`** — 닫힌 포트로 실행해도 종료 코드 0이고 1.5초 안에 끝난다 / 임시 HTTP 서버로 실행하면 본문이 도착한다.
- [ ] **Step 4: 실행해 통과 확인.** Run: `npm test` / Expected: PASS
- [ ] **Step 5: `scripts/capture-hooks.js` 작성** — 받은 stdin JSON을 `/tmp/claude-office-capture.jsonl`에 한 줄씩 추가하는 hook 대상. 임시 프로젝트 폴더의 `.claude/settings.local.json`에만 SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStart, SubagentStop을 등록한다(전역 설정은 건드리지 않음).
- [ ] **Step 6: 그 폴더에서 Claude Code를 실행해 파일 읽기, 편집, Bash, 권한 승인 요청, 하위 에이전트 1개를 일으키고 캡처를 확인한다.**
- [ ] **Step 7: `docs/hook-payloads.md`에 이벤트별 실제 필드를 적고 다음 4가지에 답한다:** (a) 승인 대기를 구분할 수 있는 이벤트/필드는? (b) 하위 에이전트 시작·종료 이벤트가 있나? (c) 하위 에이전트 안에서 일어난 도구 호출을 `agent_id` 등으로 구분할 수 있나? (d) 세션 종료(`SessionEnd`)는 터미널을 닫을 때도 오나? **이 답이 Task 3·4의 매핑 표를 확정한다. 답이 "아니오"면 스펙 §7-2의 단순화 규칙("하위 에이전트 N명 작업 중")을 적용하고 사용자에게 알린다.**
- [ ] **Step 8: Commit** — `git add -A && git commit -m "chore: scaffold, hook relay, captured hook payloads"`

### Task 2: 설정 로더와 프로젝트 매칭

**Files:**
- Create: `config.example.json`, `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `loadConfig(path: string): Config` — `Config = { port: number, offAfterMinutes: number, maxMembers: number, celebrateAfterSeconds: number, projects: Project[] }`, `Project = { name: string, path: string, color: string }`. 기본값 port 7410, offAfterMinutes 10, maxMembers 4, celebrateAfterSeconds 30. `projects`가 5개를 넘거나 `name`/`path` 중복이면 `Error`.
- Produces: `matchProject(config: Config, cwd: string): Project | null` — 경로 접두사(경로 경계 기준, `/a/b`는 `/a/bc`와 매칭되지 않음) 중 가장 긴 것.

- [ ] **Step 1: 실패하는 테스트** — 정확히 같은 폴더, 하위 폴더, `/a/b`와 `/a/bc`, 홈 폴더(미지정→`null`), 접두사가 겹치는 두 프로젝트(긴 쪽 승), 6번째 프로젝트 → Error, 기본값 채우기.
- [ ] **Step 2: 실행해 FAIL 확인.** Run: `node --test test/config.test.js`
- [ ] **Step 3: `src/config.js` 구현.** 경로는 끝 슬래시 제거 후 `startsWith(p + "/")` 또는 같음으로 비교.
- [ ] **Step 4: 통과 확인, Commit** — `feat: config loader and project matching`

### Task 3: 비밀값 마스킹과 이벤트 정규화

**Files:**
- Create: `src/mask.js`, `src/events.js`
- Test: `test/mask.test.js`, `test/events.test.js`

**Interfaces:**
- Produces: `maskSecrets(text: string): string` — `sk-…`, `ghp_…`, `AKIA…`, `Bearer …`, `password=…`/`token=…`/`api_key=…` 값, 길이 20 이상의 base64/hex 덩어리를 `***`로 바꾼다. `.env`, `*.pem`, `id_rsa*`, `credentials*` 경로는 `설정 파일`로 바꾼다.
- Produces: `toolCategory(toolName: string): "read"|"write"|"run"` — Read/Grep/Glob/WebFetch/WebSearch→read, Edit/Write/NotebookEdit/Task(하위 에이전트 호출)/`mcp__*`→write, Bash→run, 그 외→write.
- Produces: `normalizeEvent(payload: unknown, now: number): OfficeEvent | null` — `OfficeEvent = { sessionId: string, cwd: string, type: "start"|"end"|"prompt"|"tool"|"toolDone"|"wait"|"stop"|"agentStart"|"agentStop", category?: "read"|"write"|"run", detail?: string, agentId?: string, agentType?: string, ts: number }`. `detail`은 마스킹된 도구 입력 요약(명령 앞 200자 또는 파일 경로). 필수 필드(`session_id`, `cwd`, `hook_event_name`)가 없거나 알 수 없는 이벤트면 `null`. 이벤트→type 매핑은 `docs/hook-payloads.md`(Task 1)를 따른다.

- [ ] **Step 1: 실패하는 테스트(마스킹)** — 각 패턴 한 줄씩, `curl -H "Authorization: Bearer abc123def456ghi789jkl" x` 에 원문이 남지 않음, `cat .env` → `cat 설정 파일`, 일반 문장은 그대로. *(Review Focus 4)*
- [ ] **Step 2: 실패하는 테스트(정규화)** — Task 1에서 캡처한 실제 페이로드 3종을 `test/fixtures/`에 저장해 type/category가 기대값, 필드 누락·문자열·`null` 입력은 `null`, `detail`에 비밀값이 없다. *(Review Focus 3, 4)*
- [ ] **Step 3: 실행해 FAIL 확인.** Run: `node --test test/mask.test.js test/events.test.js`
- [ ] **Step 4: 구현, 통과 확인, Commit** — `feat: secret masking and hook event normalization`

### Task 4: 사무실 상태 모델

**Files:**
- Create: `src/state.js`
- Test: `test/state.test.js`

**Interfaces:**
- Consumes: `OfficeEvent`(Task 3), `Config`/`matchProject`(Task 2).
- Produces:
  - `createState(config: Config): State`
  - `applyEvent(state: State, ev: OfficeEvent, now: number): void` — 프로젝트에 매칭되지 않으면 무시. 세션별 `{status, label, lastEventAt}`와 `members: Map<agentId, {type, status, label, startedAt}>` 갱신.
  - `tick(state: State, now: number): void` — 진행 중 도구가 없고 `offAfterMinutes` 동안 이벤트가 없는 세션을 `off`로.
  - `snapshot(state: State, now: number): Snapshot` — `Snapshot = { ts: number, teams: Team[] }`, `Team = { name, color, status, label, members: Member[], overflow: number, finishedAt: number | null }`. 프로젝트마다 가장 최근 활동 세션의 값을 팀장으로, 세션이 없으면 `status: "off"`.
- `finishedAt`: stop 이벤트 시점에 팀장이 `celebrateAfterSeconds` 이상 연속으로 일(prompt 이후 stop까지)했다면 그 시각, 아니면 `null`. 새 prompt/tool 이벤트가 오면 `null`로 되돌린다.
- 전이 규칙: start→idle, end→해당 세션만 제거(다른 세션이 남아 있으면 `off`로 가지 않음), prompt→read(label `요청 파악 중`), tool→category 상태, toolDone→상태 유지, wait→`wait`, stop→idle(label `다음 지시 기다리는 중`), agentStart→member 추가, agentStop→member 삭제. 팀원 수가 `maxMembers`를 넘으면 `members`는 앞의 `maxMembers`명, `overflow`는 나머지 수.

- [ ] **Step 1: 실패하는 테스트** — 전이 규칙 전부, 세션 2개가 한 프로젝트에 있을 때 최신 이벤트 세션이 표시되고 한쪽 `end` 후에도 다른 쪽이 살아 있으면 `off` 아님 *(Review Focus 2)*, 지정되지 않은 cwd는 스냅샷에 영향 없음 *(Review Focus 1)*, 팀원 6명 → members 4 + overflow 2, `tick`이 10분 지난 세션을 `off`로, 이벤트가 없는 프로젝트도 `off`로 스냅샷에 포함, 40초 일한 뒤 stop이면 `finishedAt`이 설정되고 10초 일한 뒤 stop이면 `null`, 이후 새 prompt가 오면 `null`.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인.** Run: `node --test test/state.test.js`
- [ ] **Step 3: Commit** — `feat: office state model`

### Task 5: 말풍선 문구 (규칙 기반 + 요약)

**Files:**
- Create: `src/labels.js`, `src/summarizer.js`
- Test: `test/labels.test.js`, `test/summarizer.test.js`

**Interfaces:**
- Consumes: `OfficeEvent`(Task 3).
- Produces: `ruleLabel(ev: OfficeEvent): string` — 최대 20자. 예: read→`파일 읽는 중`, write→`코드 작성 중`, run→`명령 실행 중`, wait→`승인 기다리는 중`. `detail`에 파일 이름이 있으면 `{이름} 읽는 중`처럼 넣는다.
- Produces: `createSummarizer(opts: { run: (prompt: string) => Promise<string>, minIntervalMs: number }): { summarize(ev: OfficeEvent): Promise<string> }` — 같은 프로젝트·같은 `category`가 `minIntervalMs`(기본 5000) 안에 다시 오면 호출 없이 `ruleLabel` 반환, `run`이 실패·타임아웃(8초)이면 `ruleLabel`, 결과는 줄바꿈 제거 후 20자로 자르고 넘치면 `…`. `run`에는 이미 마스킹된 `detail`만 넣는다.
- 기본 `run` 구현은 헤드리스 `claude -p --model haiku`를 부르되 hook이 재귀 발생하지 않도록 환경변수 `CLAUDE_OFFICE_SUMMARIZER=1`을 주고, `src/hook.js`는 이 변수가 있으면 즉시 종료한다.

- [ ] **Step 1: 실패하는 테스트** — `ruleLabel` 4종과 파일명 포함, 20자 초과 잘림, 가짜 `run`이 호출 수/입력을 기록: 마스킹된 입력만 받음 *(Review Focus 4)*, 5초 안 재호출은 `run` 미호출, `run` 예외 시 규칙 문구, 8초 타임아웃은 가짜 타이머로 검증, `CLAUDE_OFFICE_SUMMARIZER=1`이면 `hook.js`가 아무것도 보내지 않음.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인.**
- [ ] **Step 3: 실제 `claude -p` 호출이 헤드리스로 동작하고 hook이 재귀하지 않는지 수동 확인**(`/tmp/claude-office-capture.jsonl`에 이벤트가 늘지 않아야 함). 안 되면 요약 계층을 끄고(`run`이 항상 실패) 규칙 문구만 쓰며 사용자에게 알린다.
- [ ] **Step 4: Commit** — `feat: bubble labels with rule-based fallback and summarizer`

### Task 6: 서버 (HTTP + WebSocket + 정적 파일)

**Files:**
- Create: `src/server.js`, `config.json`(사용자 5개 프로젝트, 예시 파일에서 복사)
- Test: `test/server.test.js`

**Interfaces:**
- Consumes: `loadConfig`, `normalizeEvent`, `createState/applyEvent/tick/snapshot`, `createSummarizer`.
- Produces: `startServer(opts: { config: Config, summarizer?: Summarizer, now?: () => number }): Promise<{ port: number, close(): Promise<void> }>`
  - `POST /event` — 본문 JSON을 `normalizeEvent`→`applyEvent`. 깨진 JSON/`null` 이벤트는 400, 정상은 204. 요약은 응답을 기다리지 않고 비동기로 끝나면 팀장/팀원 `label`을 갱신해 브로드캐스트.
  - `GET /ws` (WebSocket) — 접속 즉시 현재 `snapshot` JSON 전송, 이후 변화·`tick`(30초마다)마다 전송.
  - `GET /` 및 `/js/*`는 `public/`, `GET /vendor/three/*`는 `node_modules/three/`에서 제공.
  - `127.0.0.1`에만 listen.

- [ ] **Step 1: 실패하는 테스트** — 정상 이벤트 204 후 WS 클라이언트가 해당 팀의 `status`를 받음, 깨진 JSON·알 수 없는 이벤트 400이고 스냅샷 불변 *(Review Focus 3)*, 이후 클라이언트가 접속하면 즉시 스냅샷 수신, `0.0.0.0`이 아닌 `127.0.0.1` 바인딩, 요약이 늦어도 `/event` 응답은 즉시, 서버를 새로 띄우면 모든 팀이 `off` *(Review Focus 5)*.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인.** Run: `node --test test/server.test.js`
- [ ] **Step 3: 수동 확인** — `node src/server.js`를 띄우고 `curl -X POST localhost:7410/event -d '<fixture>'` 후 `wscat`/브라우저 콘솔로 스냅샷 확인.
- [ ] **Step 4: Commit** — `feat: event server with websocket broadcast`

### Task 7: 방 배치와 이동 목표 (순수 로직)

**Files:**
- Create: `public/js/layout.js`
- Test: `test/layout.test.js`

**Interfaces:**
- Produces:
  - `ROOMS: Record<"library"|"work"|"server"|"meeting"|"lounge"|"hall", { x: number, y: number }>` — 타일 좌표(스펙 목업 C와 같은 10×10 바닥, 팀 5개분 책상 구역은 작업실 쪽에 배치).
  - `targetFor(status: Status, teamIndex: number): { x: number, y: number, pose: "sit"|"stand"|"sleep"|"type" }` — read→자료실, write→팀 책상(`teamIndex`별 고정 자리, 앉아서 타이핑), run→서버실, wait→회의실, idle→복도/창가 서 있기, off→휴게실 소파 수면.
  - `memberSeat(teamIndex: number, memberIndex: number): { x: number, y: number }` — 팀 책상 구역 안에서 팀장 옆 자리.
  - `deskZone(teamIndex: number): { x: number, y: number, w: number, d: number }`
- 같은 `(status, teamIndex)`가 같은 좌표를 돌려주고, 서로 다른 팀의 책상 자리·팀원 자리는 겹치지 않는다.

- [ ] **Step 1: 실패하는 테스트** — 상태 6종×5팀 좌표가 방 영역 안, off는 모두 휴게실 소파 위(팀마다 다른 자리, 겹침 없음), 책상 구역끼리 겹침 없음, 팀원 4명 자리가 서로 다름.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인, Commit** — `feat: room layout and avatar targets`

### Task 8: 3D 사무실 화면

**Files:**
- Create: `public/index.html`, `public/js/scene.js`, `public/js/main.js`

**Interfaces:**
- Consumes: `layout.js`(Task 7), WebSocket `Snapshot`(Task 6).
- Produces: `main.js`가 `/ws`에 접속하고 끊기면 3초 후 재접속(끊김 동안 화면 상단에 "연결 끊김" 배지), `scene.js`는 `createScene(canvas): { update(snapshot: Snapshot): void, render(dt: number): void }`.
- 화면 요소: 목업 C의 방 배치와 색 분위기, 아이소메트릭 카메라(마우스 회전·휠 확대), 팀장 아바타(팀 색 셔츠, 이름표, 상태색 말풍선), 팀원 아바타(나타날 때 입구에서 걸어 들어오고 끝나면 입구로 걸어 나가 제거), 목표 위치로 걸어가는 이동, 상태별 포즈(타이핑/수면 "z" 표시), 말풍선 텍스트는 한 줄이며 폭을 넘으면 `…`로 줄임 *(Review Focus 5)*. 완료 연출: `snapshot.teams[i].finishedAt`이 새로 설정되면 팔 들기, 말풍선 "완료!", 초록 링을 약 4초 보여 준 뒤 원래 상태로. 승인 대기(`wait`): 머리 위 주황 느낌표 깜빡임, 상태가 바뀌면 제거. `document.visibilityState`가 hidden이면 렌더 루프 중단, 보이면 재개.

- [ ] **Step 1: `index.html`(importmap으로 `three`→`/vendor/three/build/three.module.js`), `scene.js`, `main.js` 작성.** 말풍선은 CSS 오버레이(`CSS2DRenderer` 사용 가능, `three/examples/jsm`).
- [ ] **Step 2: 서버를 띄우고 가짜 이벤트 스크립트로 5팀 모든 상태를 순서대로 일으킨다**(`scripts/demo.js`: 상태 6종과 팀원 3명 투입·퇴근을 돌려 가며 POST).
- [ ] **Step 3: Playwright MCP로 `http://localhost:7410`을 열어 스크린샷을 찍어 확인:** 5팀 모두 보임, 말풍선 겹침 없음, 긴 한국어 문구가 말줄임표로 줄어 있음, 팀원이 나타났다 사라짐, 콘솔 에러 0건. 문제가 있으면 고치고 다시 찍는다.
- [ ] **Step 3-0: `scripts/demo.js`에 40초 일한 뒤 끝나는 팀(완료 연출), 10초 만에 끝나는 팀(연출 없음), 승인 대기 팀을 포함해 Playwright 스크린샷으로 초록 링과 주황 느낌표가 보이는지, 짧은 작업은 연출이 없는지 확인한다.**
- [ ] **Step 3-1: 탭을 숨겼다 다시 켰을 때 렌더가 멈췄다 재개되는지 확인**(`document.hidden` 에뮬레이션 또는 탭 전환).
- [ ] **Step 4: Commit** — `feat: 3D isometric office view`

### Task 9: 설치 스크립트와 `/office` 명령

**Files:**
- Create: `scripts/install-hooks.js`, `scripts/install-service.sh`, `scripts/office-command.md`
- Test: `test/install-hooks.test.js`

**Interfaces:**
- Produces: `buildHookSettings(existing: object, hookCommand: string): object` — 기존 `hooks`를 그대로 두고 대상 이벤트(Task 1에서 확정한 목록)마다 `{ type: "command", command: hookCommand }`를 **추가**만 한다. 이미 추가돼 있으면 중복하지 않는다(멱등).
- `node scripts/install-hooks.js`는 변경 diff만 출력하고, `--apply`일 때만 `~/.claude/settings.json`을 쓴다(쓰기 전 `settings.json.bak-YYYYMMDD` 백업).
- `install-service.sh`는 `~/.config/systemd/user/claude-office.service`를 만들고 `systemctl --user enable --now`로 켠다(실행 전 만들 내용을 출력).
- `office-command.md`: `/office`(서버가 안 떠 있으면 시작하고 URL 안내, Windows 브라우저로 여는 명령 포함), `/office add <폴더> [이름]`(config.json에 프로젝트 추가, 5개 초과 시 거절).

- [ ] **Step 1: 실패하는 테스트** — 기존 hook이 있는 설정에 추가 후에도 기존 항목이 그대로, 두 번 적용해도 항목 수가 같음, 빈 설정에서도 동작.
- [ ] **Step 2: FAIL 확인, 구현, 통과 확인.**
- [ ] **Step 3: `node scripts/install-hooks.js`의 diff를 사용자에게 보여 주고 승인받은 뒤에만 `--apply`, 서비스 설치, `/office` 명령 파일 배치를 실행한다. WSL 네트워크(미러드/NAT)에서 Windows 브라우저가 `http://localhost:7410`에 접속되는지 확인하고, 안 되면 사용자에게 알리고 대안(포트 포워딩 또는 `--host`)을 제안한다.**
- [ ] **Step 4: Commit** — `feat: installers and /office command`

### Task 10: 실제 환경 종합 확인

**Files:**
- Modify: `docs/hook-payloads.md`(실측 결과 갱신), `README.md`(사용법, 5분 요약)

- [ ] **Step 1: 실제 프로젝트 5곳 중 2곳 이상에서 Claude Code를 돌려 말풍선 문구, 방 이동, 팀원 출퇴근, 승인 대기(회의실), 세션 종료(수면)를 화면에서 확인한다.** Playwright 스크린샷으로 근거를 남긴다.
- [ ] **Step 2: 서버를 껐다 켜고, 서버가 꺼진 동안 Claude Code 작업 속도에 영향이 없는지(체감 지연 없음) 확인한다.**
- [ ] **Step 3: 한 줄씩 결과 보고:** 통과한 항목, 단순화한 항목(예: 승인 대기 구분 불가), 남은 위험. 사용자에게 보고하고 `README.md`와 작업 로그를 갱신, Commit — `docs: usage and verification notes`

---

## Self-Review

- **스펙 커버리지:** §2 요구(5팀·3D·말풍선 요약·탭 상시·수면/휴식) → Task 4·7·8·5, 상태 수집·구분 불확실성 → Task 1·10, `/office` → Task 9, 팀장/팀원·퇴근 → Task 4·8, 마스킹 → Task 3·5, 서버 자동 시작 → Task 9, hook 비차단 → Task 1, 탭 숨김 → Task 8, 설정 변경 승인 → Task 9. 빠진 것 없음.
- **타입 일관성:** `OfficeEvent`(Task 3)를 Task 4·5·6이 같은 필드명으로 사용. `Snapshot/Team/Member`(Task 4)를 Task 6·8이 사용. `Status` 6종과 `targetFor`(Task 7)가 Global Constraints와 일치.
- **비례:** 스펙 대비 구현 세부는 시그니처와 테스트 항목 위주로 적었고 함수 본문은 넣지 않았다.
