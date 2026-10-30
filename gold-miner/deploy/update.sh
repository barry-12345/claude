#!/usr/bin/env bash
# 更新游戏或服务端。用法: sudo bash update.sh [--game-only|--server-only] [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_ROOT=/var/www/goldminer
APP_DIR=/opt/goldminer/server
ENV_FILE=/etc/goldminer.env

DO_GAME=1
DO_SERVER=1
DRY=0
for a in "$@"; do
  case "$a" in
    --game-only) DO_SERVER=0 ;;
    --server-only) DO_GAME=0 ;;
    --dry-run) DRY=1 ;;
    -h|--help)
      echo "用法: sudo bash update.sh [--game-only|--server-only] [--dry-run]"; exit 0 ;;
    *) echo "未知参数: $a" >&2; echo "用法: sudo bash update.sh [--game-only|--server-only] [--dry-run]" >&2; exit 2 ;;
  esac
done
if [ "$DO_GAME" = 0 ] && [ "$DO_SERVER" = 0 ]; then
  echo "错误: --game-only 和 --server-only 不能同时使用。" >&2; exit 2
fi

run() {
  if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi
}

if [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "错误: 请用 root 运行(在命令前加 sudo)。" >&2; exit 1
fi

if [ "$DO_GAME" = 1 ]; then
  echo "==> 更新游戏文件 -> $WEB_ROOT"
  run mkdir -p "$WEB_ROOT"
  run install -m 644 "$REPO_DIR/index.html" "$WEB_ROOT/index.html"
fi

if [ "$DO_SERVER" = 1 ]; then
  echo "==> 更新服务端 -> $APP_DIR"
  run rsync -a --delete --exclude node_modules --exclude data --exclude backups --exclude test --exclude client \
    "$REPO_DIR/server/" "$APP_DIR/"
  if [ "$DRY" = 1 ]; then
    echo "  [dry-run] cd $APP_DIR && npm ci --omit=dev"
  else
    (cd "$APP_DIR" && npm ci --omit=dev)
  fi
  run chown -R root:root "$APP_DIR"
  NODE_BIN="$(grep -s -m1 '^ExecStart=' /etc/systemd/system/goldminer.service | awk '{print $1}' | cut -d= -f2- || true)"
  [ -n "$NODE_BIN" ] || NODE_BIN="$(command -v node || echo /usr/bin/node)"
  if [ "$DRY" = 1 ]; then
    echo "  [dry-run] 渲染 goldminer.service(沿用已安装的 Node 路径 $NODE_BIN)"
  else
    sed "s|^ExecStart=/usr/bin/node |ExecStart=$NODE_BIN |" "$SCRIPT_DIR/goldminer.service" > /etc/systemd/system/goldminer.service
    chmod 644 /etc/systemd/system/goldminer.service
  fi
  run systemctl daemon-reload
  run systemctl restart goldminer
fi

echo "==> 自检 health"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] curl -fsS http://127.0.0.1:8787/api/health"
  echo "试运行结束,没有做任何修改。"
  exit 0
fi
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8787/api/health; then ok=1; break; fi
  sleep 1
done
echo
if [ "$ok" != 1 ]; then
  echo "自检失败。请查看: journalctl -u goldminer -n 50 --no-pager" >&2; exit 1
fi
DOMAIN="$(grep -s '^SITE_DOMAIN=' "$ENV_FILE" | cut -d= -f2- || true)"
if [ -n "$DOMAIN" ]; then
  if curl -fsS "https://$DOMAIN/api/health"; then echo; else echo "警告: 通过域名访问 health 失败,请检查 nginx / 证书。" >&2; fi
fi
echo "更新完成。"
