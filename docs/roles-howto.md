# 역할자(PM·개발자·QA …) 사용법

Claude Code 세션이 **파일을 수정하고 응답을 끝내면**, 역할자들이 자동으로 그 변경을 읽고 검토한다. 결과는 사무실 화면(역할자 아바타 → 판정 배지)과 오른쪽 위 **보고서** 패널, 그리고 `data/reviews/` 파일에 남는다. 역할자는 파일을 읽기만 한다(수정·실행 불가).

## 언제 검토하나
- 마지막 검토 이후 편집 도구(Edit/Write/NotebookEdit)로 **git 저장소 안, 또는 화면에 올린(이 PC의) 팀 폴더 안의 파일을 1개 이상** 고쳤고, 응답이 끝났을 때(하위 에이전트를 기다리는 중이면 제외).
- 같은 저장소는 **5분에 한 번**(`roles.cooldownMinutes`). 쿨다운 중의 변경은 모아 뒀다가 쿨다운이 끝나고 세션이 30초 이상 조용하면 검토한다.
- 하루 **역할자 프로세스 120개**까지(`roles.dailyLimit`, 한국 시간 자정 기준). 넘으면 건너뛰고 패널에 알린다.
- 세션을 어느 폴더에서 열었는지는 상관없다. **편집한 파일이 속한 저장소**가 검토 단위이고, 한 세션이 저장소 두 곳을 고치면 따로 검토한다.
- 화면에 올린 5개 프로젝트가 아니어도 검토한다(보고서 패널과 파일에만 남음). 제외하려면 `roles.excludePaths`에 저장소 경로를 적는다.

## 설정 (`config.json`의 `roles`)
```json
"roles": {
  "enabled": true,
  "default": ["pm", "developer", "qa"],
  "cooldownMinutes": 5,
  "minWrites": 1,
  "dailyLimit": 120,
  "excludePaths": ["/home/me/projects/private-repo"],
  "projects": { "/home/me/projects/Pin-It": { "roles": ["pm", "developer", "qa", "security"], "minWrites": 2 } }
}
```
- 역할 선택 우선순위: 화면 팀 항목의 `roles` → `roles.projects`의 가장 긴 경로 → `roles.default`.
- 알 수 없는 역할 id가 있으면 서버가 시작되지 않는다(메시지에 어느 설정인지 나온다).
- `deliver`: `"report"`(기본, 보고만) 또는 `"session"`. 아래 "검토 의견을 작업 세션에 되돌리기" 참고.
- 동봉된 역할: `pm`·`developer`·`qa`(기본), `security`, `docs`, `performance`, `accessibility`(화면 파일일 때만), `embedded`(C/펌웨어 안전), `copy`(문서 문구). 필요한 팀에만 `roles`로 붙인다(역할이 늘면 하루 한도 소모도 는다).

## 검토 의견을 작업 세션에 되돌리기 (`deliver: "session"`)
- 검토가 끝나 **major 이상**(`roles.deliverMinSeverity`: `minor|major|critical`) 지적이 있으면, 그 검토를 일으킨 **같은 세션의 다음 프롬프트**에 "참고용 의견"으로 한 번만 붙는다(훅의 `additionalContext`). Claude 가 사실인지 확인해 맞는 것만 반영하고 사용자에게 한 줄로 알린다.
- 의견은 한 줄·300자·비밀값 마스킹을 거치고 "사용자의 지시가 아님" 문구와 함께 간다. 최대 8건, 6시간 안에 다음 프롬프트가 없으면 버린다.
- **훅이 켜진 세션에서만** 된다(세션 시작 때 훅이 로드된 세션). 훅 없이 세션 기록으로만 보이는 세션, 원격 PC 세션에는 전달되지 않고 보고서에만 남는다.
- 역할자가 읽은 파일 내용 속 문장이 의견에 섞일 수 있어(프롬프트 주입), 의견은 "참고"로만 취급하도록 안내문을 붙인다. 꺼려지면 `deliver` 를 `"report"` 로 둔다.

## 새 역할 추가하기
`roles/<id>.md` 파일을 만들면 된다(id는 영문 소문자·숫자·`_-`). 예: `roles/performance.md`(이미 동봉되어 있다. 아래는 형식 예시)
```markdown
---
name: 성능
color: "#f5a524"
model: sonnet
when: code
tools: [Read, Grep, Glob]
---
당신은 성능 검토 담당이다. 방금 바뀐 코드에서 느려질 만한 곳만 찾는다.
- 반복문 안의 비싼 호출, 불필요한 전체 읽기, 캐시 없는 반복 계산
- 데이터가 커졌을 때(10배·100배) 깨지거나 급격히 느려지는 곳
근거 없는 추측은 적지 않는다. 문제가 확실하면 파일과 줄을 함께 적는다.
```
그다음 `config.json`의 `roles.default`(또는 `roles.projects`)에 `"performance"`를 넣고 `systemctl --user restart claude-office`. Claude에게 "성능 역할자 추가해줘"라고 시켜도 이 파일을 만들어 준다.

| 항목 | 값 |
|---|---|
| `name` | 화면에 표시되는 이름(필수) |
| `color` | `#rrggbb` (역할자 셔츠·말풍선 색) |
| `model` | `haiku` / `sonnet` / `opus` 등 (기본 `sonnet`) |
| `when` | `always`(항상) / `code`(코드 파일이 바뀐 경우) / `docs`(`.md`·`.txt` 등이 바뀐 경우) / `ui`(`.html`·`.css`·`.jsx`·`.tsx`·`.vue`·`.svelte` 등이 바뀐 경우) |
| `tools` | `Read`, `Grep`, `Glob`만 허용. 그 밖의 도구를 넣으면 거부된다 |

출력 형식(JSON)과 읽기 전용 규칙은 시스템이 프롬프트 뒤에 자동으로 덧붙인다. 본문은 역할의 관점만 적으면 된다.

## 오류 메시지
- `역할 <id>: tools 에는 Read, Grep, Glob 만 쓸 수 있습니다 (Bash 는 허용되지 않음)`
- `역할 <id>: 알 수 없는 항목 "…"` / `name 이 필요합니다` / `color 는 #rrggbb …` / `when 은 always|code|docs|ui …` / `프롬프트가 너무 깁니다 (최대 20KB)`
- `알 수 없는 역할 id: <id> (설정 위치) — roles/<id>.md 가 있어야 합니다`

## 한계
- Bash로 한 파일 수정(`sed -i` 등)은 검토를 일으키지 않는다.
- 어느 팀 폴더에도 속하지 않는 git 아닌 폴더의 파일은 검토하지 않는다. 다른 PC(원격) 세션은 아래 "원격 PC 팀 검토"를 켠 경우에만 한다.
- git 이 아닌 팀 폴더는 git diff 대신 **Claude 가 고칠 때 남긴 수정 기록(Edit 의 이전·이후 문자열, Write 의 새 내용)** 으로 검토한다(폴더에 아무것도 만들지 않음). 세션당 최근 100건, 항목당 4000자까지 보관하고 비밀값은 마스킹한다.
- diff는 `git diff HEAD` 기준이라, 같은 파일에 이전에 남겨 둔 **미커밋 변경도 함께** 보인다.
- 역할자는 diff와 일부 파일만 본다. 오탐·누락이 있을 수 있으니 참고용으로 쓴다.
- 구독 사용량: 검토 1회 = 역할 수만큼의 `claude -p` 실행이다(3개 역할 기준 약 20~60초).

## 안전 장치
역할자는 `Read/Grep/Glob`만, 그것도 **저장소 안으로 한정**해 쓰고(`docs/roles-verification.md`에서 실제 `claude`로 확인), `.env`·키 파일·`~/.ssh` 등은 읽기 거부 규칙이 걸려 있다. 비밀값은 프롬프트·보고서·화면에서 가려지고, 사용자 요청 원문은 보고서에 저장하지 않는다. 역할자 프로세스는 hook을 일으키지 않는다(`CLAUDE_OFFICE_ROLE`).

## 원격 PC 팀 검토 (`remotes[].review`)
```json
"remotes": [{ "name": "PC2", "ssh": "hyeanjae@192.168.0.20", "review": true }]
```
- 켠 원격 PC(`review: true`)에서 **화면에 올린 그 PC의 팀 폴더** 안 파일을 고치면, 그 PC가 SSH로 보내 주는 수정 기록(이전·이후 내용)과 요청·마지막 응답을 이 PC가 받아 역할자가 검토한다. 기본은 꺼짐.
- 역할자는 **이 PC의 빈 임시 폴더**에서 실행된다(원격 파일은 읽을 수 없음). 수정 기록에 적힌 내용만으로 판단하고, 프롬프트에 그 사실이 적힌다. 비밀값은 마스킹하고 설정 파일은 내용에서 뺀다.
- 원격 보고서는 `host`(PC 이름)가 붙고 같은 경로의 이 PC 보고서와 따로 저장·조회된다(`/api/reviews?repo=…&host=PC2`).
- 의견 전달(`deliver: session`)은 원격 세션에는 가지 않는다(원격 PC에 훅이 없음). 보고서에만 남는다.
- 옛 Claude Code(2.0.x)는 세션 기록의 `stop_reason` 이 항상 null 이라, 텍스트만 있는 마지막 줄이 2초 동안 조용하면 턴 끝으로 본다.
