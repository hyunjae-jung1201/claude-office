---
description: Claude Office(프로젝트별 Claude 작업 상태 사무실 화면) 열기, 프로젝트 추가
allowed-tools: Bash
---

Claude Office를 다룬다. 사용자가 입력한 인자: `$ARGUMENTS`

경로: `__ROOT__` (설정 파일 `__ROOT__/config.json`, 주소 `http://localhost:9410`)

## 인자가 없을 때: 화면 열기
1. `curl -s -o /dev/null -w "%{http_code}" http://localhost:9410/` 로 서버가 떠 있는지 확인한다.
2. 200이 아니면 `systemctl --user start claude-office` 로 시작하고 2초 기다렸다가 다시 확인한다. 서비스가 설치되어 있지 않으면 `__ROOT__/scripts/install-service.sh` 의 안내를 보여 주고, 설치는 사용자 승인 후에만 한다.
3. 켜져 있으면 Windows 브라우저로 연다: `cmd.exe /c start http://localhost:9410` (실패하면 주소만 알려 준다).
4. 한 줄로 결과를 알린다: 주소, 지정된 프로젝트 수.

## `add <폴더> [이름]`: 프로젝트 추가
1. `node __ROOT__/scripts/office-add.js <폴더> [이름]` 를 실행한다. 최대 5개, 중복은 거절된다. 실패 메시지는 그대로 사용자에게 전달한다.
2. 성공하면 `systemctl --user restart claude-office` 로 설정을 다시 읽게 하고 결과를 한 줄로 알린다.

## `list`: 지정된 프로젝트 보기
`__ROOT__/config.json` 의 projects 이름과 경로를 표로 보여 준다.

그 밖의 인자는 위 사용법을 안내한다.
