#!/usr/bin/env bash
# 黄金矿工联机版 · 卸载(只删除 deploy-online.sh 添加的东西)。
# 用法: sudo bash deploy/uninstall-online.sh [--purge] [--dry-run]
#   默认: 停止并禁用 goldminer-online,删除单元文件;从主 Caddyfile 里只删掉两行标记之间(含标记)的 3 行,
#         caddy validate 通过后 reload(不通过就还原并报错);删除 /etc/caddy/goldminer.caddy。
#   --purge: 另外删除 /opt/goldminer-online、/etc/goldminer-online.env,以及(没有其他 goldminer 服务时)
#            /var/www/goldminer 和系统用户 goldminer。
# 安装后没有手动改过 Caddyfile 的话,卸载后它与安装前逐字节相同。测试用: 系统路径前加 ${GM_ROOT:-}。
set -euo pipefail

R="${GM_ROOT:-}"
APP_USER=goldminer
SERVICE=goldminer-online
WEB_ROOT="$R/var/www/goldminer"
APP_DIR="$R/opt/goldminer-online"
ENV_FILE="$R/etc/goldminer-online.env"
UNIT_DIR="$R/etc/systemd/system"
UNIT_FILE="$UNIT_DIR/$SERVICE.service"
CADDY_DIR="$R/etc/caddy"
CADDYFILE="$CADDY_DIR/Caddyfile"
SITE_FILE="$CADDY_DIR/goldminer.caddy"
MARK_BEGIN='# >>> goldminer (由 deploy-online.sh 添加;卸载请运行 uninstall-online.sh)'
MARK_END='# <<< goldminer'
PURGE=0
DRY=0

usage() {
  cat >&2 <<'USAGE'
用法:
  sudo bash deploy/uninstall-online.sh [--purge] [--dry-run]

  --purge    连程序目录、游戏页面、配置文件和系统用户一起删除
  --dry-run  只打印将要执行的每一步,不做任何修改
USAGE
}
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
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

echo "==> [1/3] 停止并删除联机服务 $SERVICE"
if [ -f "$UNIT_FILE" ]; then
  run systemctl stop "$SERVICE" || true
  run systemctl disable "$SERVICE" || true
  run rm -f "$UNIT_FILE"
  run systemctl daemon-reload
else
  note "没有安装 $SERVICE 单元文件,跳过"
fi

echo "==> [2/3] 从主 Caddyfile 删除 goldminer 的 3 行并 reload Caddy"
if [ -f "$CADDYFILE" ] && grep -qxF "$MARK_BEGIN" "$CADDYFILE"; then
  NL_ADDED=0
  [ -f "$SITE_FILE" ] && grep -q '^# deploy-online: newline-added=1' "$SITE_FILE" && NL_ADDED=1
  if [ "$DRY" = 1 ]; then
    echo "  [dry-run] cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-goldminer-uninstall-<时间>"
    echo "  [dry-run] 删除两行标记之间(含标记)的 3 行$([ "$NL_ADDED" = 1 ] && echo ',并去掉安装时补上的换行')"
    echo "  [dry-run] caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy"
  else
    BACKUP="$CADDY_DIR/Caddyfile.bak-goldminer-uninstall-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$BACKUP"
    note "备份: ${BACKUP#"$R"}"
    TMP="$(mktemp "$CADDY_DIR/.goldminer-tmp.XXXXXX")"
    awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0 == b { skip = 1; next } skip && $0 == e { skip = 0; next } !skip { print }' "$CADDYFILE" > "$TMP"
    if [ "$NL_ADDED" = 1 ] && [ -s "$TMP" ] && [ -z "$(tail -c1 "$TMP")" ]; then truncate -s -1 "$TMP"; fi
    cat "$TMP" > "$CADDYFILE"; rm -f "$TMP"          # same inode, owner and mode as before
    if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
      cp -p "$BACKUP" "$CADDYFILE"
      die "删除后 caddy validate 没有通过,已还原 Caddyfile(备份 ${BACKUP#"$R"})。请检查安装后是否手动改过 Caddyfile。"
    fi
    if ! systemctl reload caddy; then
      cp -p "$BACKUP" "$CADDYFILE"; systemctl reload caddy || true
      die "systemctl reload caddy 失败,已还原 Caddyfile 并重新 reload。"
    fi
    note "已删除 3 行,Caddy 已 reload"
  fi
else
  note "主 Caddyfile 里没有 goldminer 标记,跳过"
fi
if [ -f "$SITE_FILE" ]; then run rm -f "$SITE_FILE"; else note "没有 /etc/caddy/goldminer.caddy,跳过"; fi

echo "==> [3/3] 清理文件"
if [ "$PURGE" = 1 ]; then
  run rm -rf "$APP_DIR"
  run rm -f "$ENV_FILE"
  OTHERS="$(find "$UNIT_DIR" -maxdepth 1 -name 'goldminer*.service' ! -name "$SERVICE.service" 2>/dev/null | head -1)"
  if [ -n "$OTHERS" ]; then
    note "还有其他 goldminer 服务(${OTHERS#"$R"}):保留 /var/www/goldminer 和用户 $APP_USER"
  else
    run rm -rf "$WEB_ROOT"
    if id "$APP_USER" >/dev/null 2>&1; then run userdel "$APP_USER"; fi
  fi
else
  note "保留 /opt/goldminer-online、/var/www/goldminer、/etc/goldminer-online.env(加 --purge 可一起删除)"
fi
echo
if [ "$DRY" = 1 ]; then echo "试运行结束,没有做任何修改。"; else echo "卸载完成。原来的站点不受影响。"; fi
