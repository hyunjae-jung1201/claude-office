#!/usr/bin/env bash
# 이 PC 의 세션 기록을 다른 PC 의 Claude Office 로 계속 밀어 넣는 systemd 사용자 서비스를 만든다.
# 사용: bash scripts/install-push-service.sh <원격에서 부를 이름> <사용자@주소> <원격의 claude-office 폴더> [--apply] [--key ~/.ssh/키]
# 기본은 만들 파일 내용만 보여 주고, --apply 를 줄 때만 설치하고 시작한다. 원격 쪽 config.json 에는 remotes: [{ "name": "<이름>", "push": true }] 가 있어야 한다.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
name="$1"; target="$2"; remote_root="$3"; shift 3
apply=0; key="$HOME/.ssh/claude_office_ed25519"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --key) key="$2"; shift ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
  shift
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="$(command -v node)"
unit_dir="$HOME/.config/systemd/user"
unit="$unit_dir/claude-office-push-$name.service"

ssh_cmd="ssh -i $key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ConnectTimeout=10 $target \"node $remote_root/src/ingest.js $name\""
content="[Unit]
Description=Claude Office: 이 PC 의 세션 기록을 $name 로 보내기
After=network-online.target

[Service]
ExecStart=/bin/bash -o pipefail -c 'exec $node_bin $root/src/remote-tail.cjs | $ssh_cmd'
Environment=PATH=$PATH
Restart=always
RestartSec=5

[Install]
WantedBy=default.target"

echo "만들 파일: $unit"
echo "------------------------------------------------"
echo "$content"
echo "------------------------------------------------"
if [ "$apply" != 1 ]; then
  echo "설치하려면 --apply 를 붙여 다시 실행하세요. (아직 아무것도 바꾸지 않았습니다)"
  exit 0
fi

mkdir -p "$unit_dir"
printf '%s\n' "$content" > "$unit"
systemctl --user daemon-reload
systemctl --user enable --now "claude-office-push-$name.service"
echo "시작했습니다. 상태: $(systemctl --user is-active "claude-office-push-$name.service")"
