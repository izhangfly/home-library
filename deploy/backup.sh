#!/usr/bin/env bash
# 备份数据库 + 已上传的封面 —— F8 验收条件 3
# 在服务器上跑：/opt/home-library/deploy/backup.sh
# cron：20 4 * * * /opt/home-library/deploy/backup.sh >> /var/log/home-library-backup.log 2>&1
#
# 这个脚本**每次都会验证自己刚做出来的备份**：把 dump 恢复进一个临时库，
# 对关键表点行数，对不上就非零退出。理由很直接 ——
# 没验证过的备份不是备份，是一个"大概能用"的猜测。
# 用户手工量的书架尺寸、手工命名的房间、一本本扫进来的书，丢了没有任何接口能重建。
set -euo pipefail

APP_DIR="/opt/home-library"
BACKUP_DIR="/root/backups/home-library"
KEEP_DAYS=30
STAMP="$(date +%Y%m%d-%H%M%S)"
CHECK_DB="homelibrary_restorecheck"

mkdir -p "$BACKUP_DIR"

# 从 .env 里取库名/密码，避免在这里再写一份
set -a; . "${APP_DIR}/.env"; set +a
# Prisma 的连接串带 ?schema=public，pg_dump 不认这个参数，去掉查询串
DB_URL="${DATABASE_URL%%\?*}"


# psql 的 -c **不做**变量替换（`:'json'` 会原样发给服务器然后报语法错），
# 只有从 stdin 读的时候才会替换。所以这里统一走 heredoc。
record_status() {
  psql "$DB_URL" -q -v json="$1" <<'SQL' || true
INSERT INTO "Setting"(key, value, "updatedAt")
VALUES ('ops.lastBackup', :'json'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, "updatedAt" = now();
SQL
}

DUMP="${BACKUP_DIR}/db-${STAMP}.dump"

echo "[$(date -Is)] 备份数据库…"
# -Fc 是自定义格式，体积小且支持选择性恢复
pg_dump "$DB_URL" -Fc -f "$DUMP"

# ---------------------------------------------------------------- 验证
# 注意：备份放在 /root 下（700），postgres 用户进不去，
# 所以恢复必须**以 root 身份走 TCP 连接串**，不能用 `sudo -u postgres pg_restore`。
# 这一条踩过，写在这儿免得下次再踩。
cleanup() { sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS ${CHECK_DB};" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[$(date -Is)] 验证备份能不能恢复…"
cleanup
sudo -u postgres psql -q -c "CREATE DATABASE ${CHECK_DB} OWNER library;"
CHECK_URL="${DB_URL%/*}/${CHECK_DB}"
pg_restore -d "$CHECK_URL" --no-owner --no-privileges "$DUMP" >/dev/null

read -r -d '' COUNT_SQL <<'SQL' || true
select (select count(*) from "Book")      as books,
       (select count(*) from "Bookcase")  as bookcases,
       (select count(*) from "Level")     as levels,
       (select count(*) from "Room")      as rooms,
       (select count(*) from "Placement") as placements,
       (select count(*) from "FloorPlan") as plans;
SQL

LIVE="$(psql "$DB_URL" -t -A -F/ -c "$COUNT_SQL")"
BACK="$(psql "$CHECK_URL" -t -A -F/ -c "$COUNT_SQL")"

echo "  生产 书/柜/层/房间/上架/户型图 = ${LIVE}"
echo "  恢复 书/柜/层/房间/上架/户型图 = ${BACK}"

if [ "$LIVE" != "$BACK" ]; then
  echo "[$(date -Is)] ✗ 备份验证失败：恢复出来的行数和生产对不上！dump 保留在 ${DUMP}"
  # 失败也要落库。只记成功的话，界面上"没有坏消息"分不清是真没事还是脚本压根没跑。
  record_status "$(printf '{"at":"%s","ok":false,"restoreVerified":false,"note":"恢复出来的行数和生产对不上 (%s vs %s)"}' "$(date -Is)" "$LIVE" "$BACK")"
  exit 1
fi
echo "[$(date -Is)] ✓ 备份可恢复"

# ---------------------------------------------------------------- 封面
echo "[$(date -Is)] 备份封面…"
# 除了二进制 dump，再存一份 JSON。
#
# `.dump` 只有 pg_restore 读得了，还得对上 PostgreSQL 大版本。
# 而异地副本落在那台 Mac 上 —— 实测那台机器**没装 Postgres**，
# 也就是说"保命的那份副本"用户自己打不开。JSON 谁都打得开。
# 两份都留：dump 用来精确恢复，JSON 用来"至少我的数据还在，看得见"。
echo "==> 导出 JSON"
(cd "$APP_DIR" && npx tsx scripts/export-json.mts "${BACKUP_DIR}/data-${STAMP}.json") \
  || echo "  ！JSON 导出失败（不影响 dump）"

if [ -d "${APP_DIR}/data/uploads" ]; then
  tar -czf "${BACKUP_DIR}/uploads-${STAMP}.tar.gz" -C "${APP_DIR}/data" uploads
  tar -tzf "${BACKUP_DIR}/uploads-${STAMP}.tar.gz" >/dev/null && echo "  ✓ 压缩包完好"
else
  echo "  （还没有上传过封面，跳过）"
fi

# ---------------------------------------------------------------- 派生字段体检
# Book 上有四个算出来的字段（callSortKey / callNumber / searchIndex / completeness）。
# 哪条写入路径漏了刷新，它们就会**静默**漂移 —— 界面一切正常，
# 只有藏在后面的排序键是旧的，而上架算法整条货架带的顺序全靠它。
# 每晚跟着备份跑一次，漂移了就记进日志（只报告，不自动改库）。
echo "[$(date -Is)] 体检派生字段…"
DERIVED_DRIFT=false
if (cd "$APP_DIR" && npx tsx scripts/check-derived.mts 2>&1 | sed 's/^/  /'); then
  :
else
  DERIVED_DRIFT=true
  echo "  ⚠ 派生字段或架上顺序有漂移（见上）。修：cd ${APP_DIR} && npx tsx scripts/check-derived.mts --fix"
fi

echo "[$(date -Is)] 清理 ${KEEP_DAYS} 天前的备份…"
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +${KEEP_DAYS} -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +${KEEP_DAYS} -delete
find "$BACKUP_DIR" -name 'data-*.json' -mtime +${KEEP_DAYS} -delete

# ---------------------------------------------------------------- 把结果写回库里
#
# 备份日志躺在 /var/log 里，没有人会去看。
# 万一哪天 pg_dump 挂了（盘满、密码换了、Postgres 升级），
# 日志忠实地记下来，然后**你要恢复的那天才发现**——那是最糟糕的时机。
# 所以把结果写进 Setting，让首页在出问题时主动告诉你。
record_status "$(printf '{"at":"%s","ok":true,"restoreVerified":true,"derivedDrift":%s,"counts":"%s"}' "$(date -Is)" "${DERIVED_DRIFT:-false}" "$LIVE")"

echo "[$(date -Is)] 完成。当前备份："
ls -lh "$BACKUP_DIR" | tail -6

# 恢复方法（写在这里免得以后翻文档）：
#   数据库： pg_restore -d "$DATABASE_URL" --clean --if-exists db-YYYYmmdd-HHMMSS.dump
#            —— 必须以 root 跑，postgres 用户读不到 /root/backups
#   封面：   tar -xzf uploads-YYYYmmdd-HHMMSS.tar.gz -C /opt/home-library/data
#   看一眼： data-YYYYmmdd-HHMMSS.json —— 不需要任何工具，编辑器打开就能读
#
# 异地副本：备份和数据库在同一块盘上，盘坏了两个一起没。
#   在 Mac 上跑 deploy/pull-backup.sh 把它们拉回本地。
