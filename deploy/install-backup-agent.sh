#!/usr/bin/env bash
# 把"每晚把备份拉回 Mac"装成 launchd 定时任务
#
# 为什么要装成机制：异地副本以前全靠人记得手动跑 pull-backup.sh。
# 实际结果是——只在创建那天跑过一次，之后六天没动过，
# 而服务器上的备份天天在更新。盘要是那几天坏了，六天的活就没了。
# 这个项目已经在"检查存在但没机制"上栽过两次，这是第三次。
#
# 为什么脚本要复制到 Application Support 而不是直接跑仓库里那份：
# TCC 不让 launchd 任务读 ~/Documents。仓库在 Documents 底下，
# 直接指过去只会每晚得到一行 "Operation not permitted"。
#
# 用法：./deploy/install-backup-agent.sh          安装/更新
#       ./deploy/install-backup-agent.sh --remove 卸载
set -euo pipefail

LABEL="com.ianzhang.homelibrary-backup"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SUPPORT="$HOME/Library/Application Support/home-library"
INSTALLED="${SUPPORT}/pull-backup.sh"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pull-backup.sh"

if [ "${1:-}" = "--remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST" "$INSTALLED"
  echo "已卸载。本地已有的备份文件没动（在 ${SUPPORT}/backups）。"
  exit 0
fi

mkdir -p "$SUPPORT/logs" "$SUPPORT/backups"
cp "$SRC" "$INSTALLED"
chmod +x "$INSTALLED"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>${INSTALLED}</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>15</integer></dict>
  <key>StandardOutPath</key><string>${SUPPORT}/logs/pull.log</string>
  <key>StandardErrorPath</key><string>${SUPPORT}/logs/pull.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "已安装 ${LABEL}（每天 03:15，笔记本关机则下次唤醒时补跑）"
echo "  脚本： ${INSTALLED}"
echo "  日志： ${SUPPORT}/logs/pull.log"
echo "  卸载： ./deploy/install-backup-agent.sh --remove"
