# Claude Code hook 실측 결과 (2026-10-21, Claude Code 2.1.306)

`scripts/capture-hooks.js`를 임시 프로젝트의 `.claude/settings.local.json`에만 등록하고, 헤드리스(`claude -p --setting-sources project,local`)로 파일 읽기·쓰기·Bash·하위 에이전트·승인 필요 상황을 일으켜 캡처했다.

## 모든 페이로드 공통 필드
`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `prompt_id`(일부)

## 이벤트별 추가 필드
| 이벤트 | 추가 필드 |
|---|---|
| SessionStart | `source` |
| SessionEnd | `reason` (예: `other`) |
| UserPromptSubmit | `prompt`, `permission_mode` |
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id`, `permission_mode`, `effort` |
| PostToolUse | 위 + `tool_response`, `duration_ms` |
| PermissionRequest | `tool_name`, `tool_input`, `permission_suggestions` |
| Stop | `last_assistant_message`, `stop_hook_active`, `background_tasks`, `session_crons` |
| SubagentStart | `agent_id`, `agent_type` |
| SubagentStop | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message` |
| Notification | 헤드리스에서는 발생하지 않음(대화형 전용 추정). 미검증 |

도구 이름: 파일 읽기 `Read`, 쓰기 `Write`, 셸 `Bash`, 하위 에이전트 호출 `Agent`(예전 이름 `Task`도 함께 처리).

## 4가지 질문의 답
- **(a) 승인 대기:** `PermissionRequest` 이벤트가 정확히 승인이 필요할 때 온다. 승인/거절이 끝났다는 전용 이벤트는 없고, 이후 `PostToolUse`·`PreToolUse`·`Stop` 중 먼저 오는 것으로 해제한다. `Notification`은 대화형에서만 올 수 있어 보조로만 처리한다.
- **(b) 하위 에이전트 시작·종료:** 있다. `SubagentStart`, `SubagentStop`(둘 다 `agent_id`, `agent_type` 포함).
- **(c) 하위 에이전트 안의 도구 호출 구분:** 가능하다. 그 안에서 발생한 `PreToolUse`/`PostToolUse`에 `agent_id`, `agent_type`이 붙는다(메인 Claude의 호출에는 없음).
- **(d) 세션 종료:** `SessionEnd`는 정상 종료에서 온다(`reason` 포함). 터미널을 강제로 닫거나 WSL이 죽는 경우는 미검증이므로 10분 무신호 시 `off`로 보는 규칙을 유지한다.

## 설계에 영향을 주는 관찰
1. `Agent` 도구의 `PostToolUse`는 하위 에이전트가 끝나기 전에 즉시 온다(백그라운드 실행). 이 호출 자체는 팀장의 "작업 위임"일 뿐이다.
2. `Stop`이 하위 에이전트가 아직 도는 중에도 온다(`background_tasks`가 있음). 팀원이 남아 있으면 팀장은 "끝남"이 아니라 `idle`(하위 에이전트 기다리는 중)로 두고, 완료 연출은 **팀원이 모두 퇴근한 뒤**의 `Stop`에서만 한다. `SubagentStop` 직후 알림 성격의 `UserPromptSubmit`(`<task-notification>…`)이 다시 오고 이어서 `Stop`이 한 번 더 온다.
3. 사용자가 입력한 프롬프트와 하위 에이전트 완료 알림이 모두 `UserPromptSubmit`으로 온다. 본문이 `<task-notification>`으로 시작하면 사용자 요청이 아니다.

## 종단 확인 (2026-10-21)
임시 프로젝트의 로컬 설정에만 hook을 넣고 실제 `claude -p`로 확인했다. 서버 화면 상태가 `off → idle → read → run → write → (팀원 Explore 등장: write→read → 퇴근) → idle(완료) → off` 순으로 바뀌었고, 승인이 필요한 명령은 `wait`(승인 기다리는 중)으로 표시됐다. hook 1회 지연은 약 75ms(서버 켜짐/꺼짐 동일, 대부분 node 시작 시간)이고, 서버가 꺼져 있어도 Claude 작업은 정상 종료됐다.
