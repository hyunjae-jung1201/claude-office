#!/usr/bin/env bash
# Claude Office 서버를 systemd 사용자 서비스로 등록한다 (WSL 시작 시 자동 실행).
# 기본은 만들 파일 내용만 보여 주고, --apply를 줄 때만 설치하고 시작한다.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="$(command -v node)"
unit_dir="$HOME/.config/systemd/user"
unit="$unit_dir/claude-office.service"

content="[Unit]
Description=Claude Office (Claude Code 작업 상태 사무실 화면)
After=network.target

[Service]
ExecStart=$node_bin $root/src/server.js
WorkingDirectory=$root
Environment=CLAUDE_OFFICE_CONFIG=$root/config.json
Environment=PATH=$PATH
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target"

echo "만들 파일: $unit"
echo "------------------------------------------------"
echo "$content"
echo "------------------------------------------------"

if [ "${1:-}" != "--apply" ]; then
  echo "설치하려면 --apply 를 붙여 다시 실행하세요. (아직 아무것도 바꾸지 않았습니다)"
  exit 0
fi

mkdir -p "$unit_dir"
printf '%s\n' "$content" > "$unit"
systemctl --user daemon-reload
systemctl --user enable --now claude-office.service
echo "시작했습니다. 상태: $(systemctl --user is-active claude-office.service)"
