#!/usr/bin/env bash
# 黄金矿工联机版 · 更新游戏页面和联机服务(先 git pull 或上传新文件,再运行本脚本)。
# 用法: sudo bash deploy/update-online.sh [--force] [--dry-run]
#   有正在进行的对局时(/online/health 的 games > 0)默认拒绝,加 --force 才执行(重启服务会结束进行中的对局)。
# 不碰 Caddy 配置(域名或端口要改,请重新运行 deploy-online.sh)。测试用: 系统路径前加 ${GM_ROOT:-}。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
R="${GM_ROOT:-}"
SERVICE=goldminer-online
WEB_ROOT="$R/var/www/goldminer"
APP_DIR="$R/opt/goldminer-online"
ENV_FILE="$R/etc/goldminer-online.env"
UNIT_FILE="$R/etc/systemd/system/$SERVICE.service"
FORCE=0
DRY=0

usage() {
  cat >&2 <<'USAGE'
用法:
  sudo bash deploy/update-online.sh [--force] [--dry-run]

  --force    即使有人正在对局也更新(会结束进行中的对局)
  --dry-run  只打印将要执行的每一步,不做任何修改
USAGE
}
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 2 ;;
  esac
done
run() { if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }
note() { echo "    $*"; }
die() { echo "错误: $*" >&2; exit 1; }
[ "$DRY" = 1 ] && echo "*** 试运行模式(--dry-run):只显示步骤,不会修改系统 ***"

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || die "请用 root 运行(在命令前加 sudo)。"
if [ ! -f "$UNIT_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  if [ "$DRY" = 1 ]; then note "(dry-run) 还没有安装联机服务;正式运行会在这里退出"; else die "还没有安装联机服务,请先运行 deploy-online.sh。"; fi
fi
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -1 || true)"; PORT="${PORT:-8790}"

echo "==> [1/4] 检查有没有正在进行的对局"
HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/online/health" 2>/dev/null || true)"
GAMES="$(sed -n 's/.*"games":\([0-9]*\).*/\1/p' <<<"$HEALTH")"
note "/online/health: ${HEALTH:-(服务没有响应)}"
if [ "${GAMES:-0}" -gt 0 ] && [ "$FORCE" != 1 ]; then
  die "现在有 $GAMES 局正在进行,更新会把它们结束。请等对局结束后再更新,或加 --force 强制更新。"
fi

echo "==> [2/4] 更新游戏页面 /var/www/goldminer/index.html"
run install -m 644 "$REPO_DIR/index.html" "$WEB_ROOT/index.html"

echo "==> [3/4] 更新联机服务 /opt/goldminer-online"
run rm -rf "$APP_DIR/src"
run cp -R "$REPO_DIR/online/src" "$REPO_DIR/online/package.json" "$REPO_DIR/online/package-lock.json" "$APP_DIR/"
if [ "$DRY" = 1 ]; then echo "  [dry-run] cd /opt/goldminer-online && npm ci --omit=dev"
else (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund); fi
run chown -R root:root "$APP_DIR" "$WEB_ROOT"
run install -m 644 "$SCRIPT_DIR/goldminer-online.service" "$UNIT_FILE"
run systemctl daemon-reload

echo "==> [4/4] 重启联机服务(游戏页面和服务端一起换成新版本,版本号自动一致)"
run systemctl restart "$SERVICE"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] 等待 curl http://127.0.0.1:$PORT/online/health 成功(最多 20 秒)"
  echo "试运行结束,没有做任何修改。"
  exit 0
fi
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/online/health" >/dev/null 2>&1; then
    echo "更新完成。已经打开游戏的人刷新页面就会用上新版本(旧页面会提示「游戏已更新,请刷新页面」)。"
    exit 0
  fi
  sleep 1
done
die "服务重启后 20 秒内没有响应。请查看: journalctl -u $SERVICE -n 50 --no-pager"
