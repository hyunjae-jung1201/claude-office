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
cp config.example.json config.json      # 프로젝트 폴더 최대 6개를 적는다

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
| 자료실 | 파일 읽기·검색(Read/Grep/Glob/LSP), 읽기 전용 셸 명령(`ls`·`cat`·`grep`·`head`·`sed -n`…), 기억 조회·코드 리뷰 스킬 |
| 리서치실 | 웹 검색·조회(WebSearch/WebFetch), 문서 조회(context7)·메일·캘린더·드라이브 |
| 작업실 | 일반 코드 편집, 요청 파악, 파일을 만지는 셸(`sed -i`·`cp`·`mv`·`mkdir`…)과 일반 스크립트 실행 — 팀마다 책상. 무슨 일인지 모르면 여기 |
| 문서실 | 글·문서 편집(`.md`·`.txt`·`.docx`·`.pptx`·`.xlsx`·`.pdf`·README), **PPT·워드·PDF 를 만드는 스크립트**(`make_ppt.py`·`pandoc`·`soffice`…)와 글 파일에 쓰는 셸(`cat > a.md`·`>> log.md`), 문서 스킬·Artifact |
| 기획실 | 할 일·계획(TodoWrite, 계획 모드, 계획·브레인스토밍 스킬), 예약(Cron/ScheduleWakeup), Jira(Atlassian)·sequential-thinking |
| 서버실 | **서버·인프라 일만**: `ssh`·`docker`·`systemctl`·`journalctl`·`kill`·`ps`·`nvidia-smi`·`curl localhost`·`adb`·서버 실행(`npm start`·`uvicorn`), 서버·환경 설정 파일(`.env`·nginx·`.service`) 편집 |
| 데이터 창고 | `wget`·`curl -O`·`scp`·`rsync`·`unzip`·`tar`, DB 질의(`sqlite3`·`mongosh`·`psql`·`duckdb`)·MongoDB 도구, `.csv`·`.parquet`·`.jsonl`·`.sqlite` 편집 |
| 테스트 랩 | `npm test`·`pytest`·`eslint`, 끝난 작업을 지켜보는 `Monitor`·백그라운드 명령, **학습·평가 스크립트**(`train.py`·`eval_*.py`), 테스트 파일 편집, 노트북, Playwright·모바일·Jupyter·Semgrep 도구, 테스트·디버깅 스킬 |
| 빌드실 | `npm run build/install`·`pip install`·`make`·`docker build`·`gradlew`, 빌드 설정 파일(`package.json`·`Makefile`·`Dockerfile`·CI·`requirements.txt`) 편집 |
| 형상관리실 | `git …`·`gh …`, GitHub 도구, 작업 트리 전환 |
| 브리핑룸 | 하위 에이전트에게 일을 맡기는 중(Agent/Task/SendMessage) |
| **응답 대기실** | **사용자의 응답이 필요할 때**: 승인 요청·질문·계획 승인을 기다리거나, 턴이 끝나 다음 지시를 기다리는 동안(5분, `responseWaitMinutes`). 이때 아바타에 **초록색**(링·느낌표)이 나타나고 왼쪽 목록의 줄도 초록색이 된다. 승인이 끝나면 원래 하던 일의 방으로 돌아간다 |
| 휴게실 | 일이 없을 때(응답 대기 시간이 지난 뒤 포함)의 휴식 — 소파, 가끔 카페 카운터에서 커피. 꺼진 세션은 같은 방의 침대에서 잔다 |

여러 명령이 섞이면 우선순위는 형상관리 > 테스트 > 빌드 > 데이터 > 문서 > 서버 > 작업 > 읽기다(`cd x && ls && git status` 는 형상관리실). `<<'EOF'` 본문(글·스크립트 내용)은 명령으로 세지 않는다.

하위 에이전트(팀원)와 역할자는 맡은 일의 방으로 가서 일하고(역할자는 팀 책상), 끝나면 입구로 퇴근한다. 초록색은 "응답 필요"의 표시색이다.

## 가구와 아바타 자리는 함께 바꾼다
방의 가구(탁자·의자·작업대·보드)와 아바타가 서거나 앉는 자리·바라보는 방향은 항상 짝이다. 가구를 옮기거나 새로 놓을 때는 아바타도 그에 맞게 행동하도록 같이 고친다.
- 자리(좌표·`face`)는 `public/js/layout.js` 의 `SPOTS` 가 정한다. 앉는 방(리서치실·문서실)은 탁자·자리 정의(`RESEARCH_TABLES`/`researchSeats()`, `DOCS_TABLE`/`docsSeats()`)에서 의자·탁자·노트북을 `office.js` 가 만들고, 팀장 자리도 같은 값을 쓴다 — 값을 고치면 가구와 아바타가 함께 바뀐다.
- 팀원(하위 에이전트·역할자)은 작업실이 아니면 그 방의 비어 있는 자리(`freeSpotFor`)에 팀장과 같은 방식으로 앉거나 서서 가구 쪽을 본다. 자리가 모자랄 때만 팀장 곁에 비켜 선다.
- 새 가구가 아바타의 자리·동선을 막지 않는지 `test/layout.test.js` 와 화면(`__office.forceRoom('방')`·`viewAt(x, y, 확대)`)으로 확인한다. 방마다 하는 동작(자세)은 `layout.js` 의 `POSE` 와 `scene.js` 의 `pose()`.

## 사용
- `/office` 화면 열기, `/office add <폴더> [이름]` 프로젝트 추가(최대 6개), `/office list`
- 자동 작업 아바타: 테스터(테스트 랩, `testCommand` 실행 중)·기록원(문서실, 작업 로그 초안 갱신 중)도 역할자처럼 잠깐 나타났다 사라진다.
- **왼쪽 목록**: 아바타 모습·이름·지금 하는 일(예전 말풍선 내용)을 팀별로 나열하고, 그 아래에 팀원·역할자를 들여써서 보여 준다. 위 검색창으로 찾고 `목록` 버튼으로 접는다. 아바타 위에는 이름표만 둔다.
- 상태 색(목록의 점): 파랑 읽는 중 / 청록 코드 작성 / 보라 명령 실행 / 주황 승인 대기(느낌표 깜빡임) / 회색 쉬는 중
- 30초(`celebrateAfterSeconds`) 이상 일하고 끝나면 팔 들기 + "완료!" + 초록 링이 4초 나온다.
- 한계: 승인을 눌러도 hook이 승인 완료 신호를 주지 않아서, 그 명령이 끝날 때까지 "승인 기다리는 중"으로 보인다.
- Claude가 꺼져 있으면 휴게실에서 앉아서 잔다. 10분(`offAfterMinutes`) 동안 신호가 없어도 꺼진 것으로 본다.

## 다른 PC 에서도 보기 (push 원격)
다른 PC 에도 Claude Office 를 설치하고, 이 PC 의 작업을 그쪽 화면에서도 보게 할 수 있다. 이 PC 가 ssh 로 세션 기록을 **밀어 넣는** 방식이라 그쪽에서 이 PC 로 접속할 필요가 없다(키 권한도 그대로: 명령 실행만).
1. 다른 PC 의 `config.json`: `"remotes": [{ "name": "PC1", "push": true }]` 와, 이 PC 의 프로젝트를 `"host": "PC1"` 을 붙여 팀으로 적는다.
2. 이 PC 에서: `bash scripts/install-push-service.sh PC1 사용자@주소 ~/projects/claude-office` 로 미리보기 → `--apply` 로 설치.
3. **팀을 추가·이름 변경·삭제하면 다른 PC 설정도 맞춘다**: 이 PC 의 `config.json` 에 `"mirrors": [{ "name": "PC1", "ssh": "사용자@주소", "root": "/절대/경로/claude-office" }]` 를 적어 두고 `node scripts/sync-teams.js`(미리보기는 `--dry-run`). `/office add` 는 자동으로 실행한다. 다른 PC 자체 팀은 그대로 두고 이 PC 팀만 `host` 를 붙여 교체한 뒤 그쪽 서비스를 다시 시작한다.
4. 다른 PC 서버는 `POST /ingest?remote=PC1`(루프백만)로 받아 그 PC 팀의 상태로 처리한다. 읽기 전용이며 파일·명령은 건드리지 않는다.

## 실행 중인 세션과 백그라운드 작업
Claude Code가 `~/.claude/sessions/<pid>.json`에 적는 **세션 등록 정보**(프로세스가 살아 있는지, 상태)를 3초마다 읽는다(원격 PC는 SSH 스크립트가 같은 파일을 읽는다).
- 프로세스가 살아 있으면 꺼진 것이 아니라 **지시 대기 구역에서 대기**로 보인다. 프로세스가 사라지면 휴게실에서 잔다.
- 상태가 `shell`(응답은 끝났지만 백그라운드 명령이 도는 중)이면 **테스트 랩에서 "백그라운드 작업 중"**으로 보인다(끝난 작업이 오류 없이 도는지 지켜보는 일이라 검증하는 방). `Monitor` 도구도 테스트 랩이다. (`busy`는 등록 정보가 오래 남는 경우가 있어 사용하지 않는다.)

## 역할자(PM·개발자·QA …) 자동 검토
세션이 파일을 수정하고 응답을 끝내면 PM·개발자·QA 역할자가 읽기 전용 `claude -p`로 변경을 검토한다. 검토 중에는 역할자 아바타가 팀 책상에 나타나 일하고, 끝나면 퇴근하며 팀장 곁에 판정 배지(✓ 통과 / ⚠ 우려 n / ⛔ 중단 권고)가 남는다. 오른쪽 위 **보고서** 버튼에서 최근 검토와 지적 상세를 볼 수 있고, 파일은 `data/reviews/`에 저장된다. 역할은 `roles/<id>.md` 파일을 추가해 늘린다. 기본으로 도는 것은 PM·개발자·QA 이고, 접근성·문구·문서·임베디드·성능·보안·아키텍트·데이터베이스·배포·운영(`devops`)·UX·의존성·릴리스·ML 검토(`mlreview`)는 `config.json` 의 `roles.default` 또는 팀별 `projects[].roles` 에 id 를 적어야 켜진다(켠 역할 수만큼 `claude` 실행이 늘어 일일 한도를 쓴다). 자세한 사용법·설정·한계는 `docs/roles-howto.md`, 읽기 전용 검증은 `docs/roles-verification.md`.
- 화면 확인용: `CLAUDE_OFFICE_FAKE_ROLES=1 CLAUDE_OFFICE_REVIEW_DIR=/tmp/x node src/server.js` (가짜 역할자 결과, 실제 claude 호출 없음)

## 다른 AI 도구(Codex)도 함께 보기
Codex 는 **전용 팀**(외계인 아바타)으로 보인다. 어느 폴더에서 일하든 Codex 의 활동은 이 팀 하나로 모이고, 하는 일에 맞는 방에서 일한다. Codex 세션은 역할자 검토·작업 일지 대상이 아니다.
- 팀 만들기: `config.json` 의 `projects` 에 `{ "name": "Codex", "ai": "codex", "color": "#6fd6a0" }` 를 추가한다(`path` 없음, 팀 6개 한도에 포함). 이 팀은 다른 PC 로 미러하지 않는다.
- hook 켜기: `node scripts/install-hooks.js --codex --apply` (`~/.codex/hooks.json` 에 hook 만 추가, 기존 항목은 그대로 두고 백업을 남긴다). 이미 떠 있는 Codex 세션은 새로 시작해야 반영된다. hook 은 `CLAUDE_OFFICE_AI=codex` 를 달아 보내고, 서버가 `exec_command`·`apply_patch` 같은 도구를 Bash·Edit 로 맞춰 방을 고른다(모르는 도구는 작업실).
- Claude 작업의 자동 코드 검사(`~/.claude/hooks/codex-review.py`)가 도는 동안에는 이 팀이 **테스트 랩**에서 "코드 리뷰 실행 중"으로 보이고, 끝나면 휴게실로 돌아간다.
- `ai` 팀이 없으면 Codex 는 그 폴더 팀의 외계인 팀원으로 나온다.

## 보고서에서 검토 확인하기
**보고서** 패널에서 검토를 열어 지적을 살펴본 뒤, 상세 위쪽의 버튼으로 처리한다.
- **확인 · 대화로 전달**: 그 검토가 "확인됨"이 되어 팀장 옆 판정 배지가 지워지고(서버를 재시작해도 유지), 지적(경미 이상, 참고 제외)이 그 팀의 Claude 대화로 전달된다. 전달은 **그 대화에 다음 메시지를 보낼 때** 이뤄진다(실행 중인 대화에 끼어들 수는 없다). `config.json` 의 `roles.deliver` 가 `session` 이어야 한다.
- **확인만**: 배지만 지운다(전달 없음).
- 이 동작은 브라우저 화면(같은 출처)에서만 받는다. 자동 전달(`deliverMinSeverity`)은 그대로이며, 확인해 전달한 의견은 "사용자가 확인하고 전달함"으로 표시된다.

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
