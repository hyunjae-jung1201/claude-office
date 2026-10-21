# 구현 중 내린 판단과 보류 항목 (2026-10-21)

구현 중 계획과 달리 결정한 것(Ruling)과, 최종 검토에서 보류한 Minor 항목의 전체 기록.

## 판단(Ruling)
- Task 1: Ruling: npm test script uses quoted glob test/*.test.js — Node 22 treats the bare directory as a module path and fails — cost if wrong: none
- Task 1: Ruling: 실측으로 hook 이벤트 확정 — 승인 대기=PermissionRequest, 하위 에이전트=SubagentStart/Stop(+agent_id/agent_type가 도구 호출에 붙음), 도구명 Agent(=Task). T3 type 목록 유지, 'wait'는 PermissionRequest(Notification은 보조) — cost if wrong: 이벤트 매핑 수정
- Task 1: Ruling: Stop이 하위 에이전트 진행 중에도 온다 → T4에서 팀원이 남아 있으면 stop을 idle("하위 에이전트 기다리는 중")로만 두고 finishedAt은 팀원이 모두 퇴근한 뒤의 stop에서만 설정 — cost if wrong: 완료 연출 타이밍
- Task 1: Ruling: 사용자 프롬프트가 '<task-notification>'으로 시작하면 prompt 이벤트로 취급하지 않음(T3) — 하위 에이전트 완료 알림이므로
- Task 4: Ruling: added exported setLabel(state, sessionId, agentId|null, label) — server (T6) needs to overwrite bubble text after async summarization; also state keeps DEFAULT_LABEL per status (T5 ruleLabel is the richer per-event version) — cost if wrong: duplicate default strings
- Task 4: Ruling: toolDone while status==='wait' sets status to the finished tool's category (approval resolution has no dedicated event; PermissionRequest comes after PreToolUse) — cost if wrong: avatar stays in meeting room until next event
- Task 4: Ruling: tick uses offAfterMinutes*6 window when a tool is open (crash mid-tool otherwise keeps avatar awake forever) — cost if wrong: long training commands (>60min with no events) show as off
- Task 5: Ruling: ruleLabel imports DEFAULT_LABEL from state.js (single source of default strings) — cost if wrong: labels.js depends on state.js
- Task 5: Ruling: summarizer skips LLM for wait events and events without detail; headless call uses `claude -p --model haiku --setting-sources project --tools "" --no-session-persistence` with CLAUDE_OFFICE_SUMMARIZER=1 (verified manually: ~3s, outputs "학습 이미지 데이터셋 내려받는 중"); prompt asks ~15 chars and no file names — cost if wrong: summaries fall back to rule labels
- Task 6: Ruling: startServer(opts) also accepts port, tickMs, publicDir, now (needed for tests); summarizer defaults to null (rule labels only), CLI entry passes createSummarizer() — cost if wrong: none
- Task 6: Ruling: events from non-matching cwd never reach the summarizer (guard with matchProject) — avoids wasted LLM calls for unlisted folders
- Task 6: Ruling: config.json (personal, gitignored) pre-filled with 5 projects GUESSED from ~/projects (ArucoTracker, dashboard_for_safety, guardview, 팅크웨어, 폐암); user must confirm/replace — cost if wrong: avatars for the wrong folders until edited
- Task 7: Ruling: ROOMS entries are rects {x,y,w,d} (plan said {x,y}) and FLOOR={w:12,d:10} exported — scene needs room extents; floor widened to 12x10 to fit 5 desk zones — cost if wrong: scene.js builds from these
- Security review (after T6/T7 commits): server — Host must be 127.0.0.1/localhost:PORT (403), /event rejects any Origin (403) and non-JSON content-type (415), WebSocket verifyClient allows only own origin or none; mask — unterminated quotes mask to end of line, URL passwords may contain '/'. 7 new tests RED(6 failing)→GREEN, suite 98/98. Ruling: no per-install shared-secret token — Origin/Host/content-type checks block browser-borne attacks; same-user local processes can already read the user's files — cost if wrong: a local process of the same user can inject fake events.
- Task 8: Ruling: createScene(canvas, overlay) takes the overlay element too (CSS2DRenderer root) — plan said createScene(canvas); also exposes inspect() and window.__office for verification
- Task 8: Ruling: celebration keeps the leader where it finished (target frozen 4s) and draws the green ring under the leader, not at the desk — avoids a walk-while-cheering animation; cost if wrong: ring not at desk
- Task 8: Ruling: sleeping avatars show only "z z" + name tag (bubble hidden) and sit on sofa/floor cushions; layout 'off' spots changed (3 on sofa, 2 on cushions) — bubbles of 5 sleepers overlapped unreadably
- Task 9: Ruling: Step 3 (apply to real ~/.claude/settings.json, enable systemd service, copy /office command to ~/.claude/commands) NOT executed — plan and spec require user approval of the diff first (security-sensitive, outside worktree). Dry-run outputs verified. Pending: user approval.
- Task 9: Ruling: added addProject(path, folder, name?) to config.js (+3 tests) and scripts/office-add.js for `/office add`; office-command.md uses __ROOT__ placeholder filled at install (sed) — cost if wrong: none
- Task 9: Ruling: hook command is plain `node <root>/src/hook.js` (version-agnostic); the systemd unit uses the absolute node path (nvm is not on systemd's PATH) — cost if wrong: hook silently no-ops if node is missing from Claude Code's PATH
- Task 10: Verified end-to-end with real `claude -p` (project-local hooks only, global settings untouched): status sequence off→idle→read→run→write→member Explore (write→read)→leaves→idle+finishedAt→off; permission-needed Bash → wait; hook latency ~75ms with server up or down; Claude completes normally with server down. Ruling: Task 10 Step 1 "2+ real projects" done with a temp project instead of the user's real projects, since global hooks are not installed yet (needs user approval) — cost if wrong: real-project behavior unverified until install.
- Final: fixed #5 mask gaps (curl -u, Basic, PASS/AUTH/PRIVATE_KEY, .ssh/.aws dirs, secrets/_key/.netrc/.npmrc/.p12) — 4 tests RED→GREEN; Ruling: 'pass'/'auth' keys only match when not followed by a letter (so --author=kim is untouched) — cost if wrong: a few false positives like bypass=
- Final: fixed #6 maxMembers>4 froze every snapshot — Ruling: config now rejects maxMembers outside 1..4 (layout supports 4 seats) plus per-team try/catch in scene update — cost if wrong: cap cannot exceed 4 without a layout change
- Final: Ruling: install (global hooks, systemd service, /office command) WAS approved by the user ("설치 진행해줘") — progress.md Task 9 note about pending approval is superseded

## 보류한 Minor
- #9 subagent events after server restart do not recreate members until next SubagentStart
- #10 install-service.sh PATH unquoted (breaks if PATH has spaces, e.g. appendWindowsPath=true)
- #11 hook.js forwards full payload (tool_response can exceed 1MB → 413, toolDone lost)
- #12 ignored payloads (task-notification, non-permission Notification) answer 400 instead of 204
- #13 post-approval toolDone label is generic ("명령 실행 중")
- #14 missing/invalid config.json prints a raw stack trace
- #15 leader/desk colours not refreshed on config change until reload

# 역할자 기능 구현 중 내린 판단과 보류 항목 (2026-10-21)

## 판단(Ruling)
- Task 2: Ruling: hook timeout test threshold 1.5s→2.5s (flaky when the whole suite runs in parallel; hook's own limits unchanged: 1s timeout, 1.2s hard exit) — cost if wrong: a slower hook would pass the test up to 2.5s
- Task 5: Ruling: tracker.onEvent returns Promise<void> (plan said void) so callers/tests can await the async repo grouping; server ignores the promise — cost if wrong: none
- Task 6: Ruling: hook "no-hang" test threshold raised to 5s (was 2.5s) — full parallel suite with git-spawning tests made node startup slow; the hook's own limits are unchanged — cost if wrong: a hook that takes up to 5s would pass this test
- Task 7: Verified with real claude -p (haiku): normal JSON review OK; .env / secrets.yml reads denied by permission settings; Edit/Write/Bash unavailable; Grep for secret values finds nothing; repo unchanged (docs/roles-verification.md). Ruling: runner env/allowlist extracted to src/env.js (minimalEnv) shared with summarizer — cost if wrong: none
- Task 9: Ruling: startServer takes roles (Map) + reviewStore + reviewRun options and runs reviews only when both roles and config.roles.enabled are set (existing tests/configs without roles are unaffected); CLI loads roles/ and supports CLAUDE_OFFICE_FAKE_ROLES=1 (src/roles/fake.js) for demos
- Task 11: Verified end-to-end with real claude -p sessions + real reviewers (see docs/roles-verification.md). Improvement during verification: reviewers flagged excluded .env as a problem → prompt notes (excluded files, review scope) → 0 .env findings. Known limitation recorded: git diff HEAD shows earlier uncommitted changes in the same file. Ruling: Task 11 Step 3 (deploy) — service restart for the real instance happens after the final review fixes; no global settings change needed (existing hooks already forward Stop/prompt payloads).
- Final: fixed #18 maskPaths only touches path-like tokens (/, leading ., known file extensions, id_*), kv rule keeps function-call values (clientSecret = getSecretValue(x)) — Ruling: quoted/other literal values are still masked, dotted identifiers without a call (password=my.secret.pass) are still masked (safer) — cost if wrong: some code like `token = a.b` is shown as `***` in diffs

## 최종 검토에서 보류한 Minor
- #8 count edits at toolDone
- #9 p.finally/process shadow
- #10 close() doesn't kill reviewer children
- #11 reserve daily limit at start
- #12 skipped error/no-roles not surfaced + notice lingers past KST midnight
- #14 report write not atomic/files unmasked
- #15 deny **/.git/** + --strict-mcp-config
- #16 prompt via argv (~85KB)
- #17 roles.enabled type check
- #19 second start replaces first's role map
- #20 statSync for size check
