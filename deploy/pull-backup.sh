#!/usr/bin/env bash
# 把服务器上的备份拉回 Mac —— 异地副本
#
# 为什么要有这个：backup.sh 做出来的 dump 和数据库在**同一块盘**上。
# 盘坏了、误删了 /root、或者这台机器没了，备份跟着一起没。
# 那不叫备份，那叫副本。
#
# 用法：
#   ./deploy/pull-backup.sh          拉最新的一份（数据库 + 封面）
#   ./deploy/pull-backup.sh --all    把服务器上留着的都拉回来
set -euo pipefail

SERVER="${HL_SERVER:-root@YOUR_SERVER_IP}"
REMOTE_DIR="/root/backups/home-library"
# 存在 ~/Library/Application Support 而**不是** ~/Documents 下，是有原因的：
# macOS 的 TCC 不让 launchd 里的任务碰 Documents/Desktop/Downloads，
# 除非你手动给 /bin/bash 开"完全磁盘访问"。
# 半夜跑的定时任务碰上这条，只会往日志里写一行 "Operation not permitted"
# 然后什么都不做 —— 而那个日志没人看，异地副本就这么一天天变旧。
# （这台机器上另一个项目的每晚同步正是这么坏了很久的。）
# ~/Documents/home-library-backups 留了个软链接，手动找还是老地方。
LOCAL_DIR="${HL_BACKUP_DIR:-$HOME/Library/Application Support/home-library/backups}"
MODE="${1:-}"

mkdir -p "$LOCAL_DIR"

if [ "$MODE" = "--all" ]; then
  echo "==> 拉取全部备份到 ${LOCAL_DIR}"
  rsync -avz --progress "${SERVER}:${REMOTE_DIR}/" "${LOCAL_DIR}/"
else
  echo "==> 拉取最新一份备份到 ${LOCAL_DIR}"
  LATEST_DB="$(ssh "$SERVER" "ls -t ${REMOTE_DIR}/db-*.dump 2>/dev/null | head -1")"
  LATEST_UP="$(ssh "$SERVER" "ls -t ${REMOTE_DIR}/uploads-*.tar.gz 2>/dev/null | head -1")"
  LATEST_JS="$(ssh "$SERVER" "ls -t ${REMOTE_DIR}/data-*.json 2>/dev/null | head -1")"
  [ -n "$LATEST_DB" ] || { echo "服务器上没有数据库备份"; exit 1; }
  rsync -avz "${SERVER}:${LATEST_DB}" "${LOCAL_DIR}/"
  [ -n "$LATEST_UP" ] && rsync -avz "${SERVER}:${LATEST_UP}" "${LOCAL_DIR}/"
  # JSON 那份最要紧：Mac 上没有 Postgres，dump 打不开，JSON 打得开
  [ -n "$LATEST_JS" ] && rsync -avz "${SERVER}:${LATEST_JS}" "${LOCAL_DIR}/"
fi

# ---------------------------------------------------------------- 报平安
#
# 拉回来了还不算完：这个脚本是 launchd 半夜跑的，**没人看它的输出**。
# 哪天 SSH 密钥换了、盘满了、服务器连不上，它就默默不干活了，
# 而异地副本一天天变旧 —— 等你需要它的那天才发现，那是最糟糕的时机。
# （这个项目已经在同一个坑里栽过两次：检查存在，但结果没送到人眼前。）
#
# 所以拉成功后往库里写一笔，首页的 <OpsAlert> 在副本变旧时会喊。
# 写不进去不算失败：副本已经在本地了，那才是重点。
LOCAL_LATEST="$(ls -t "${LOCAL_DIR}"/db-*.dump 2>/dev/null | head -1)"
if [ -n "$LOCAL_LATEST" ]; then
  ssh "$SERVER" "sudo -u postgres psql -q homelibrary" <<SQL || echo "  （报平安失败，不影响本地副本）"
INSERT INTO "Setting" (key, value, "updatedAt")
VALUES ('ops.lastPull', jsonb_build_object('at', to_jsonb(now()), 'file', '$(basename "$LOCAL_LATEST")'), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now();
SQL
fi

echo
echo "==> 本地现有副本："
ls -lh "$LOCAL_DIR" | tail -8
echo
echo "总计 $(du -sh "$LOCAL_DIR" | cut -f1)"
echo
echo "恢复到服务器（谨慎）："
echo "  scp <dump> ${SERVER}:/tmp/ && ssh ${SERVER} 'set -a; . /opt/home-library/.env; set +a;"
echo "    pg_restore -d \"\${DATABASE_URL%%\\?*}\" --clean --if-exists /tmp/<dump>'"
