#!/usr/bin/env bash
# 从 Mac 一键部署到 Hetzner。
#
# 设计原则：绝不碰服务器上已有的服务。
#   * 只用没人占的 8800 端口
#   * 只往 Caddyfile 追加一个新 site block，改完先 validate 再 reload（reload 是热的，不断连）
#   * 自己的 systemd unit 叫 home-library.service，和现有单元没有重名
#
# 用法：
#   ./deploy/deploy.sh                全量部署（同步代码 + 安装依赖 + 迁移 + 构建 + 重启）
#   ./deploy/deploy.sh --quick        只同步代码 + 构建 + 重启（依赖没变时快得多）
#   ./deploy/deploy.sh --skip-verify  跳过上线前检查（只在救火时用）
set -euo pipefail

SERVER="${HL_SERVER:-root@YOUR_SERVER_IP}"
REMOTE_DIR="/opt/home-library"
PORT=8800
DOMAIN="library.example.com"
QUICK=""
SKIP_VERIFY=""
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK="--quick" ;;
    --skip-verify) SKIP_VERIFY=1 ;;
  esac
done

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------- 上线前检查
#
# 这个项目攒了八套不变量检查（分类号合法性、限流、SSRF、导出完整性、
# 临界确认、数据库错误翻译、书脊系数、上架算法 218 条性质测试）。
# 但一直以来它们只是"记得去跑"的命令 —— 那是习惯，不是机制：
# 忘一次，坏掉的不变量就直接上线了。整套跑完只要 8 秒，没有理由不挡在前面。
#
# 挡在 rsync **之前**：不合格的代码连服务器都不该碰到。
if [ -z "$SKIP_VERIFY" ]; then
  echo "==> 上线前检查（typecheck + i18n + 8 套不变量测试）"
  if ! npm run verify:full --silent; then
    echo
    echo "✗ 检查没过，已中止部署 —— 服务器上的代码没有被动过。"
    echo "  确实要带着问题上线（救火之类）就加 --skip-verify。"
    exit 1
  fi
  echo "✓ 检查全过"
else
  echo "⚠ 已跳过上线前检查（--skip-verify）"
fi

echo "==> 同步代码到 ${SERVER}:${REMOTE_DIR}"
ssh "$SERVER" "mkdir -p ${REMOTE_DIR}"
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude data \
  --exclude .env \
  ./ "${SERVER}:${REMOTE_DIR}/"

if [ "$QUICK" != "--quick" ]; then
  echo "==> 安装依赖"
  ssh "$SERVER" "cd ${REMOTE_DIR} && npm install --no-audit --no-fund 2>&1 | tail -3"
  # npm 11 默认拦截 install script，Prisma 和 sharp 都要靠它装原生产物
  ssh "$SERVER" "cd ${REMOTE_DIR} && npm approve-scripts prisma @prisma/engines sharp @swc/core unrs-resolver @parcel/watcher esbuild --no-allow-scripts-pin >/dev/null 2>&1; npm rebuild >/dev/null 2>&1 || true"

  echo "==> 应用数据库迁移"
  ssh "$SERVER" "cd ${REMOTE_DIR} && npx prisma migrate deploy 2>&1 | tail -5"
fi

echo "==> 构建"
ssh "$SERVER" "cd ${REMOTE_DIR} && npm run build 2>&1 | tail -6"

echo "==> 安装/更新 systemd unit"
ssh "$SERVER" "install -m 644 ${REMOTE_DIR}/deploy/home-library.service /etc/systemd/system/home-library.service && systemctl daemon-reload"

echo "==> 重启服务"
ssh "$SERVER" "systemctl enable --now home-library >/dev/null 2>&1; systemctl restart home-library && sleep 4 && systemctl is-active home-library"

echo "==> 健康检查"
ssh "$SERVER" "curl -fsS -o /dev/null -w 'local http %{http_code}\n' http://127.0.0.1:${PORT}/ || (journalctl -u home-library -n 40 --no-pager; exit 1)"
curl -fsS -o /dev/null -w "https://${DOMAIN} → %{http_code}\n" "https://${DOMAIN}/" || echo "外网访问失败（检查 Caddy 与 DNS）"

# 健康检查只证明"首页返回 200" —— 一个页面把接口调坏了、组件抛错了、
# 文案 key 缺了，首页照样 200。冒烟测试才真的把九个页面挨个打开看一遍。
#
# 它**不能**塞进 rsync 前的 `npm run verify:full`：那道闸是纯本地的、8 秒跑完，
# 而冒烟测试要有一个跑起来的站点才能测。所以它只能在这儿，部署之后。
# 失败不回滚（回滚需要另一套机制），但一定要在终端上喊出来，
# 别让一次"完成"盖住九个页面里其中一个是坏的。
if [[ "${SKIP_SMOKE:-}" == "1" ]]; then
  echo "==> 跳过冒烟测试（SKIP_SMOKE=1）"
elif ! npm run --silent smoke; then
  echo ""
  echo "!!! 冒烟测试没过 —— 服务是活的，但上面某个页面是坏的。看上面那几行 ✗。"
  exit 1
fi

# 无障碍回归。和冒烟测试一样要有跑着的站点，所以也排在部署之后。
# 它跑的是 axe 的 WCAG A/AA 规则 —— **只覆盖机器判得了的那部分**，
# 大约是全部无障碍问题的三分之一。查不出来的那类见 CLAUDE.md
# （比如"这个能点的东西压根不是控件"，axe 只检查已有控件有没有名字）。
if [[ "${SKIP_SMOKE:-}" == "1" ]]; then
  echo "==> 跳过无障碍检查（SKIP_SMOKE=1）"
elif ! npm run --silent verify:a11y; then
  echo ""
  echo "!!! 无障碍回归 —— 看上面列的违规。"
  exit 1
fi

echo "==> 完成"
