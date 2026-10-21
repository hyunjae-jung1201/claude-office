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

## 사용
- `/office` 화면 열기, `/office add <폴더> [이름]` 프로젝트 추가(최대 5개), `/office list`
- 말풍선 색: 파랑 읽는 중 / 청록 코드 작성 / 보라 명령 실행 / 주황 승인 대기(느낌표 깜빡임) / 회색 쉬는 중
- 30초(`celebrateAfterSeconds`) 이상 일하고 끝나면 팔 들기 + "완료!" + 초록 링이 4초 나온다.
- 한계: 승인을 눌러도 hook이 승인 완료 신호를 주지 않아서, 그 명령이 끝날 때까지 "승인 기다리는 중"으로 보인다.
- Claude가 꺼져 있으면 휴게실에서 앉아서 잔다. 10분(`offAfterMinutes`) 동안 신호가 없어도 꺼진 것으로 본다.

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
