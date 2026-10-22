# Claude Office

프로젝트별 Claude Code 작업 상태를 3D 사무실에서 한눈에 보는 화면. 프로젝트 = 팀, 메인 Claude = 팀장, 하위 에이전트 = 팀원(일할 때만 나타나고 끝나면 퇴근).

- 설계: `docs/superpowers/specs/2026-10-21-claude-office-design.md`
- 계획: `docs/superpowers/plans/2026-10-21-claude-office.md`
- 실측한 hook 신호: `docs/hook-payloads.md`

## 구조
Claude Code hook → `src/hook.js`(1초 타임아웃, 항상 종료 코드 0) → 로컬 서버 `src/server.js`(마스킹, 상태 계산, 요약, WebSocket) → 브라우저 `public/`(Three.js).

## 설치 (모두 직접 확인한 뒤 적용)
```bash
cd /home/hyeanjae/projects/claude-office
npm install
cp config.example.json config.json      # 프로젝트 폴더 최대 5개를 적는다

node scripts/install-hooks.js            # 추가될 hook만 보여 줌 (아무것도 바꾸지 않음)
node scripts/install-hooks.js --apply    # ~/.claude/settings.json 에 추가만 함 (백업 생성)

bash scripts/install-service.sh          # 만들 systemd 서비스 파일을 보여 줌
bash scripts/install-service.sh --apply  # WSL 시작 시 서버 자동 실행

mkdir -p ~/.claude/commands
sed "s#__ROOT__#$PWD#g" scripts/office-command.md > ~/.claude/commands/office.md   # /office 명령
```
브라우저에서 `http://localhost:9410` 을 열어 두면 된다. (포트 9410: Windows가 예약한 7317~7416 구간을 피하기 위함 — 그 안의 포트는 Windows 브라우저에서 안 열린다.) 새로 시작하는 Claude Code 세션부터 반영된다.

## 사무실 방 13개
하는 일의 종류(도구와 명령어)에 따라 아바타가 서로 다른 방으로 걸어가 일한다. 분류 기준은 `src/events.js`의 `activityOf`. **관련 있는 방은 붙어 있다**: 윗줄은 읽기(자료실·리서치실)와 만들기(작업실·문서실·기획실), 복도 건너 가운데 줄은 인프라(서버실·데이터 창고)와 검증 흐름(테스트 랩 → 빌드실 → 형상관리실), 아랫줄은 기다림과 쉼(응답 대기실·휴게실)이다.

| 방 | 언제 가나 |
|---|---|
| 자료실 | 파일 읽기·검색(Read/Grep/Glob), 요청 파악 |
| 리서치실 | 웹 검색·조회(WebSearch/WebFetch) |
| 작업실 | 코드 편집(Edit/Write) — 팀마다 책상 |
| 문서실 | `.md`·`.txt`·`.rst`·README 편집 |
| 기획실 | 할 일·계획 정리(TodoWrite, 계획 모드) |
| 서버실 | 그 밖의 셸 명령, 응답이 끝난 뒤에도 도는 백그라운드 작업 |
| 데이터 창고 | `wget`, `curl -O`, `scp`, `rsync`, `unzip`, `tar` 등 |
| 테스트 랩 | `npm test`, `pytest`, `eslint`, `cargo test` 등 |
| 빌드실 | `npm run build/install`, `pip install`, `make`, `docker build` 등 |
| 형상관리실 | `git …`, `gh …` |
| 브리핑룸 | 하위 에이전트에게 일을 맡기는 중 |
| **응답 대기실** | **사용자의 응답이 필요할 때**: 승인 요청·질문·계획 승인을 기다리거나, 턴이 끝나 다음 지시를 기다리는 동안(5분, `responseWaitMinutes`). 이때 아바타에 **초록색**(링·느낌표·말풍선)이 나타난다 |
| 휴게실 | 일이 없을 때(응답 대기 시간이 지난 뒤 포함)의 휴식 — 소파. 꺼진 세션은 같은 방의 침대에서 잔다 |

하위 에이전트(팀원)와 역할자는 맡은 일의 방으로 가서 일하고(역할자는 팀 책상), 끝나면 입구로 퇴근한다. 초록색은 "응답 필요"의 표시색이다.

## 사용
- `/office` 화면 열기, `/office add <폴더> [이름]` 프로젝트 추가(최대 5개), `/office list`
- 말풍선 색: 파랑 읽는 중 / 청록 코드 작성 / 보라 명령 실행 / 주황 승인 대기(느낌표 깜빡임) / 회색 쉬는 중
- 30초(`celebrateAfterSeconds`) 이상 일하고 끝나면 팔 들기 + "완료!" + 초록 링이 4초 나온다.
- 한계: 승인을 눌러도 hook이 승인 완료 신호를 주지 않아서, 그 명령이 끝날 때까지 "승인 기다리는 중"으로 보인다.
- Claude가 꺼져 있으면 휴게실에서 앉아서 잔다. 10분(`offAfterMinutes`) 동안 신호가 없어도 꺼진 것으로 본다.

## 실행 중인 세션과 백그라운드 작업
Claude Code가 `~/.claude/sessions/<pid>.json`에 적는 **세션 등록 정보**(프로세스가 살아 있는지, 상태)를 3초마다 읽는다(원격 PC는 SSH 스크립트가 같은 파일을 읽는다).
- 프로세스가 살아 있으면 꺼진 것이 아니라 **지시 대기 구역에서 대기**로 보인다. 프로세스가 사라지면 휴게실에서 잔다.
- 상태가 `shell`(응답은 끝났지만 백그라운드 명령이 도는 중)이면 **서버실에서 "백그라운드 작업 중"**으로 보인다. (`busy`는 등록 정보가 오래 남는 경우가 있어 사용하지 않는다.)

## 역할자(PM·개발자·QA …) 자동 검토
세션이 파일을 수정하고 응답을 끝내면 PM·개발자·QA 역할자가 읽기 전용 `claude -p`로 변경을 검토한다. 검토 중에는 역할자 아바타가 팀 책상에 나타나 일하고, 끝나면 퇴근하며 팀장 곁에 판정 배지(✓ 통과 / ⚠ 우려 n / ⛔ 중단 권고)가 남는다. 오른쪽 위 **보고서** 버튼에서 최근 검토와 지적 상세를 볼 수 있고, 파일은 `data/reviews/`에 저장된다. 역할은 `roles/<id>.md` 파일을 추가해 늘린다. 자세한 사용법·설정·한계는 `docs/roles-howto.md`, 읽기 전용 검증은 `docs/roles-verification.md`.
- 화면 확인용: `CLAUDE_OFFICE_FAKE_ROLES=1 CLAUDE_OFFICE_REVIEW_DIR=/tmp/x node src/server.js` (가짜 역할자 결과, 실제 claude 호출 없음)

## 세션 이름으로 팀 찾기
세션을 홈 폴더에서 열고 이름만 프로젝트 이름으로 붙여 쓰는 경우가 많아서, 폴더가 안 맞으면 Claude Code가 `~/.claude/sessions`에 적어 둔 **세션 이름**을 팀 이름/`aliases`와 비교한다(대소문자 무시). 폴더가 맞으면 폴더가 우선이다.
```json
{ "name": "Standup", "path": "/home/me/projects/standup-bot", "aliases": ["standup 봇"] }
```

## 다른 PC 연결 (읽기 전용)
다른 PC의 Claude Code 세션 기록(`~/.claude/projects/*/*.jsonl`)과 실행 중 세션 등록 정보를 SSH로 읽는다. 그 PC의 Claude Code 설정은 바꾸지 않고, 이미 켜져 있는 세션도 바로 반영된다. 대신 승인 대기와 세션 종료 신호는 없어서 10분 조용하면 꺼진 것으로 본다. 하위 에이전트(팀원)는 표시되지 않는다.
```json
{
  "remotes": [{ "name": "PC2", "ssh": "사용자@192.168.0.20" }],
  "projects": [{ "name": "사고 판별", "path": "/home/사용자/accident", "host": "PC2", "aliases": ["사고 판별 모델"] }]
}
```
- 키 전용 접속: `~/.ssh/claude_office_ed25519` (원격 `authorized_keys`에 `no-port-forwarding,no-pty` 옵션으로 등록). 비밀번호는 저장하지 않는다.
- 원격에는 `node`(18 이상)가 있어야 한다. 끊기면 3초부터 최대 30초 간격으로 다시 연결한다.

## 화면 확인용 데모
```bash
node src/server.js
node scripts/demo.js          # 가짜 이벤트로 모든 상태와 팀원 출퇴근을 재현
```

## 테스트
`npm test` (Node 내장 test runner). 3D 화면은 Playwright로 직접 확인한다.

## 보안
- 서버는 `127.0.0.1`에만 바인딩하고, Host/Origin/Content-Type을 확인해 웹 페이지를 통한 접근을 막는다.
- 명령어·파일 경로의 비밀값(키, 토큰, 비밀번호, URL 자격증명, `.env` 등)은 요약기에 넘기기 전에 가린다.
- 요약용 `claude -p`는 전용 비공개 폴더, 설정 파일 없음, 최소 환경변수로 실행되며 hook이 재귀하지 않는다.
