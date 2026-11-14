#!/usr/bin/env bash
# 黄金矿工联机版 · 共存模式一键部署(Ubuntu 22.04/24.04,服务器上已有 Caddy)。可重复执行(幂等)。
# 用法: sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io [--port 8790] [--dry-run]
#
# 本脚本保证(SPEC-phase4-online §4.1):
#   不安装任何软件(不执行 apt-get,不装 nginx/certbot/Node/Docker/rsync);不碰防火墙(ufw);
#   不修改 Caddyfile 里已有的任何一行,只在末尾追加 3 行(1 行 import + 2 行注释标记);只 reload Caddy,从不 restart/stop;
#   不碰 8787 端口和它的程序;不改系统 Node;所有新文件都带 goldminer 前缀;--dry-run 只打印、不修改。
# 测试用:所有系统路径前加 ${GM_ROOT:-}(默认空);系统命令可用 PATH 里的同名假命令替换。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
R="${GM_ROOT:-}"

APP_USER=goldminer
SERVICE=goldminer-online
WEB_ROOT="$R/var/www/goldminer"
APP_DIR="$R/opt/goldminer-online"
ENV_FILE="$R/etc/goldminer-online.env"
UNIT_FILE="$R/etc/systemd/system/$SERVICE.service"
CADDY_DIR="$R/etc/caddy"
CADDYFILE="$CADDY_DIR/Caddyfile"
SITE_FILE="$CADDY_DIR/goldminer.caddy"
SITE_REAL=/etc/caddy/goldminer.caddy            # the path Caddy itself sees (written into the import line)
NODE_BIN="$R/usr/bin/node"
MARK_BEGIN='# >>> goldminer (由 deploy-online.sh 添加;卸载请运行 uninstall-online.sh)'
MARK_END='# <<< goldminer'
SITE_MARK='# 黄金矿工联机版 —— 由 deploy-online.sh 生成'
FORBIDDEN_PORTS="22 80 443 2019 8787"

DOMAIN=""
PORT=8790
DRY=0

usage() {
  cat >&2 <<'USAGE'
用法:
  sudo bash deploy/deploy-online.sh --domain <游戏域名> [--port 8790] [--dry-run]

参数:
  --domain   游戏的网址(不带 https://),例如 goldminer.43.161.221.249.sslip.io
  --port     联机服务只在本机 127.0.0.1 上监听的端口,默认 8790
             (不能用 22、80、443、2019、8787:分别是 SSH、Caddy、Caddy 管理接口、你的另一个程序)
  --dry-run  只打印将要执行的每一步,不做任何修改

示例:
  sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io --dry-run
  sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain|--port)
      if [ $# -lt 2 ]; then echo "错误: $1 需要一个值。" >&2; usage; exit 2; fi
      if [ "$1" = "--domain" ]; then DOMAIN="$2"; else PORT="$2"; fi
      shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$DOMAIN" ]; then echo "错误: 缺少 --domain 参数。" >&2; usage; exit 2; fi
DOMAIN="${DOMAIN,,}"
if ! [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "错误: 域名格式不正确: $DOMAIN(只写域名,不要带 https:// 或路径)" >&2; usage; exit 2
fi
for p in $FORBIDDEN_PORTS; do
  if [ "$PORT" = "$p" ]; then
    echo "错误: 端口 $PORT 不能使用(22=SSH,80/443=Caddy,2019=Caddy 管理接口,8787=你的另一个程序)。请换一个,例如 --port 8790。" >&2
    exit 2
  fi
done
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  echo "错误: 端口必须是 1024–65535 之间的数字: $PORT" >&2; usage; exit 2
fi

run() { if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }
step() { echo; echo "==> [$1/8] $2"; }
note() { echo "    $*"; }
die() { echo "错误: $*" >&2; exit 1; }

[ "$DRY" = 1 ] && echo "*** 试运行模式(--dry-run):只显示步骤,不会修改系统 ***"

# ---- helpers (read-only) ----
# top-level site addresses of a Caddyfile: lines at brace depth 0 that open a block, minus the global options block,
# snippets "(name) {" and our own marker block
site_addresses() {
  awk '
    /^[ \t]*#/ { next }
    {
      line = $0; sub(/[ \t]+#.*$/, "", line)
      if (depth == 0 && line ~ /\{[ \t]*$/) {
        head = line; sub(/\{[ \t]*$/, "", head); gsub(/^[ \t]+|[ \t]+$/, "", head)
        if (head != "" && head !~ /^\(/) { n = split(head, a, /[ \t,]+/); for (i = 1; i <= n; i++) if (a[i] != "") print a[i] }
      }
      o = gsub(/\{/, "{", line); c = gsub(/\}/, "}", line); depth += o - c
    }' "$1"
}
# files imported by a Caddyfile (absolute or relative paths, globs allowed); snippet imports are not files
imported_files() {
  local f="$1" dir pat p
  dir="$(dirname "$f")"
  while read -r pat; do
    case "$pat" in /*) ;; *) pat="${dir#"$R"}/$pat" ;; esac
    for p in $R$pat; do [ -f "$p" ] && echo "$p"; done
  done < <(awk '$1 == "import" && ($2 ~ /\// || $2 ~ /\./) { print $2 }' "$f")
}
port_busy() { ss -Hltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; }
url_of() { case "$1" in http://*|https://*) echo "${1%/}/" ;; *) echo "https://$1/" ;; esac; }
probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || true; }

# ---------- 1. 预检(只读) ----------
step 1 "预检(只读,任何一项不通过都会退出,不做任何修改)"
[ "$(id -u)" = 0 ] || die "请用 root 运行(在命令前加 sudo)。"
if [ -f "$R/etc/os-release" ]; then
  # shellcheck disable=SC1091
  . "$R/etc/os-release"
fi
if [ "${ID:-}" != "ubuntu" ] || { [ "${VERSION_ID:-}" != "22.04" ] && [ "${VERSION_ID:-}" != "24.04" ]; }; then
  die "只支持 Ubuntu 22.04 / 24.04,当前是 ${PRETTY_NAME:-未知系统}。"
fi
note "系统: ${PRETTY_NAME:-Ubuntu $VERSION_ID}"
command -v caddy >/dev/null 2>&1 || die "没有找到 caddy 命令。本脚本用于已经装好 Caddy 的服务器;没有 Caddy 的新服务器请用 deploy.sh。"
[ -f "$CADDYFILE" ] || die "没有找到 ${CADDYFILE#"$R"}。"
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  die "现有的 ${CADDYFILE#"$R"} 本身没有通过 caddy validate。为了不弄坏现有站点,脚本不会修改它。请先修好它(或联系管理员)再部署。"
fi
note "现有 Caddyfile 通过 caddy validate"
systemctl is-active --quiet caddy || die "Caddy 服务没有在运行(systemctl is-active caddy)。请先让现有站点正常运行再部署。"
[ -x "$NODE_BIN" ] || die "没有找到 /usr/bin/node。本脚本不会安装或替换 Node;请确认系统 Node(>= 22)在 /usr/bin/node。"
NODE_REAL="$(readlink -f "$NODE_BIN")"; NODE_REAL="${NODE_REAL#"$R"}"
case "$NODE_REAL" in /home/*|/root/*) die "/usr/bin/node 指向 $NODE_REAL(在用户目录里),systemd 服务访问不到。本脚本不会改动 Node。" ;; esac
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "${NODE_MAJOR:-0}" -ge 22 ] 2>/dev/null || die "/usr/bin/node 版本太低(需要 >= 22,当前主版本 ${NODE_MAJOR:-?})。本脚本不会升级 Node。"
command -v npm >/dev/null 2>&1 || die "没有找到 npm(随 Node 一起安装)。本脚本不会安装软件。"
note "Node: /usr/bin/node 主版本 $NODE_MAJOR(不改动)"
if port_busy "$PORT"; then
  if systemctl is-active --quiet "$SERVICE" && [ -f "$ENV_FILE" ] && grep -qx "PORT=$PORT" "$ENV_FILE"; then
    note "端口 $PORT 由本项目的 $SERVICE 服务占用(重复部署),继续"
  else
    die "端口 $PORT 已被其他程序占用。请用 --port 换一个没人用的端口(例如 8791)。"
  fi
else
  note "端口 127.0.0.1:$PORT 空闲"
fi
SITE_OURS=0
if [ -f "$SITE_FILE" ]; then
  if grep -qF "$SITE_MARK" "$SITE_FILE"; then SITE_OURS=1; else die "${SITE_FILE#"$R"} 已经存在,但不是本脚本生成的。脚本不会覆盖它。"; fi
fi
for f in "$CADDYFILE" $(imported_files "$CADDYFILE"); do
  [ "$f" = "$SITE_FILE" ] && continue
  if awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0 == b { skip = 1; next } $0 == e { skip = 0; next } !skip' "$f" | grep -qiF "$DOMAIN"; then
    die "域名 $DOMAIN 已经出现在 ${f#"$R"} 里。为避免和现有站点冲突,请换一个域名。"
  fi
done
note "域名 $DOMAIN 在现有 Caddy 配置里没有出现"
if [[ "$DOMAIN" =~ \.sslip\.io$ ]]; then
  EMB="$(grep -oE '([0-9]{1,3}[.-]){3}[0-9]{1,3}' <<<"$DOMAIN" | tail -1 | tr '-' '.')"
  [ -n "$EMB" ] && note "提示: sslip.io 会把这个域名解析成 $EMB。请确认这是本服务器的公网 IP(不一致也不会阻止部署)。"
fi

# ---------- 2. 记录现有站点状态(只读) ----------
step 2 "记录现有站点状态(只读,用于第 7 步对比)"
declare -A BEFORE=()
SITES=()
while read -r a; do
  case "$a" in ""|:*|*\**|"$DOMAIN"|"https://$DOMAIN"|import) continue ;; esac
  SITES+=("$a")
done < <(site_addresses "$CADDYFILE")
for a in "${SITES[@]}"; do
  if [ "$DRY" = 1 ]; then BEFORE[$a]="(dry-run)"; else BEFORE[$a]="$(probe "$(url_of "$a")")"; fi
  note "$(url_of "$a") -> HTTP ${BEFORE[$a]}"
done
[ "${#SITES[@]}" -gt 0 ] || note "Caddyfile 里没有找到可以检查的站点地址"

# ---------- 3. 用户与文件 ----------
step 3 "用户与文件: 游戏 -> /var/www/goldminer,联机服务 -> /opt/goldminer-online"
if id "$APP_USER" >/dev/null 2>&1; then note "系统用户 $APP_USER 已存在"
else run useradd --system --shell /usr/sbin/nologin --no-create-home --home-dir /nonexistent "$APP_USER"; fi
run install -d -m 755 "$WEB_ROOT"
run install -m 644 "$REPO_DIR/index.html" "$WEB_ROOT/index.html"
run install -d -m 755 "$APP_DIR"
run rm -rf "$APP_DIR/src"
run cp -R "$REPO_DIR/online/src" "$REPO_DIR/online/package.json" "$REPO_DIR/online/package-lock.json" "$APP_DIR/"
if [ "$DRY" = 1 ]; then echo "  [dry-run] cd ${APP_DIR#"$R"} && npm ci --omit=dev"
else (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund); fi
run chown -R root:root "$APP_DIR" "$WEB_ROOT"
if [ -f "$ENV_FILE" ]; then
  note "${ENV_FILE#"$R"} 已存在,保持不变"
  ENV_PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)"
  if [ -n "$ENV_PORT" ] && [ "$ENV_PORT" != "$PORT" ]; then note "注意: 已有配置里的端口是 $ENV_PORT,沿用它"; PORT="$ENV_PORT"; fi
elif [ "$DRY" = 1 ]; then
  echo "  [dry-run] 生成 ${ENV_FILE#"$R"}(权限 600): PORT=$PORT HOST=127.0.0.1 ALLOWED_ORIGINS=https://$DOMAIN GAME_HTML=/var/www/goldminer/index.html TRUST_PROXY=1"
else
  ( umask 077
    cat > "$ENV_FILE" <<ENVF
PORT=$PORT
HOST=127.0.0.1
ALLOWED_ORIGINS=https://$DOMAIN
GAME_HTML=/var/www/goldminer/index.html
TRUST_PROXY=1
ENVF
  )
  chmod 600 "$ENV_FILE"; chown root:root "$ENV_FILE"
  note "已生成 ${ENV_FILE#"$R"}"
fi

# ---------- 4. systemd ----------
step 4 "systemd 服务 $SERVICE(只监听 127.0.0.1:$PORT)"
run install -m 644 "$SCRIPT_DIR/goldminer-online.service" "$UNIT_FILE"
run systemctl daemon-reload
run systemctl enable "$SERVICE"
run systemctl restart "$SERVICE"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] 等待 curl http://127.0.0.1:$PORT/online/health 成功(最多 20 秒)"
else
  ok=0
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/online/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != 1 ]; then
    systemctl stop "$SERVICE" || true
    die "联机服务没有启动成功(20 秒内 /online/health 不通)。Caddy 还没有被修改。请查看: journalctl -u $SERVICE -n 50 --no-pager"
  fi
  note "联机服务已启动: http://127.0.0.1:$PORT/online/health"
fi

# ---------- 5. Caddy 站点文件 ----------
step 5 "写 Caddy 站点文件 /etc/caddy/goldminer.caddy"
SITE_PREV=""
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] 用 goldminer.caddy.tpl 渲染(__DOMAIN__=$DOMAIN __PORT__=$PORT)-> /etc/caddy/goldminer.caddy"
else
  if [ "$SITE_OURS" = 1 ]; then SITE_PREV="$(mktemp)"; cp -p "$SITE_FILE" "$SITE_PREV"; fi
  NL_ADDED=0
  [ -s "$CADDYFILE" ] && [ -n "$(tail -c1 "$CADDYFILE")" ] && ! grep -qxF "$MARK_BEGIN" "$CADDYFILE" && NL_ADDED=1
  if [ "$SITE_OURS" = 1 ] && grep -q '^# deploy-online: newline-added=1' "$SITE_FILE"; then NL_ADDED=1; fi
  { sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" "$SCRIPT_DIR/goldminer.caddy.tpl"
    echo "# deploy-online: newline-added=$NL_ADDED (uninstall-online.sh 据此把主 Caddyfile 还原到逐字节相同)"; } > "$SITE_FILE"
  chmod 644 "$SITE_FILE"
fi

# ---------- 6. 接入主 Caddyfile ----------
step 6 "备份并在主 Caddyfile 末尾追加 import(只追加,不改已有内容),caddy validate"
restore() {                                    # Caddyfile back from the backup (checked byte by byte), site file back / removed
  cp -p "$BACKUP" "$CADDYFILE"
  if cmp -s "$BACKUP" "$CADDYFILE"; then note "已用备份还原 ${CADDYFILE#"$R"}(cmp: 逐字节相同)"; else echo "严重: 还原后的 Caddyfile 与备份不一致,请手动 cp ${BACKUP#"$R"} /etc/caddy/Caddyfile" >&2; fi
  if [ -n "$SITE_PREV" ]; then cp -p "$SITE_PREV" "$SITE_FILE"; else rm -f "$SITE_FILE"; fi
}
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-goldminer-<时间>"
  if grep -qxF "$MARK_BEGIN" "$CADDYFILE"; then echo "  [dry-run] 已有 goldminer 标记,不再追加"
  else echo "  [dry-run] 在 /etc/caddy/Caddyfile 末尾追加 3 行: 标记 / import $SITE_REAL / 标记"; fi
  echo "  [dry-run] caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile(失败则还原并退出)"
else
  BACKUP="$CADDY_DIR/Caddyfile.bak-goldminer-$(date +%Y%m%d-%H%M%S)"
  n=1; while [ -e "$BACKUP" ]; do BACKUP="${BACKUP%-[0-9]}-$n"; n=$((n + 1)); done
  cp -p "$CADDYFILE" "$BACKUP"
  note "备份: ${BACKUP#"$R"}"
  if grep -qxF "$MARK_BEGIN" "$CADDYFILE"; then
    note "主 Caddyfile 里已有 goldminer 标记,不再追加"
  else
    [ -s "$CADDYFILE" ] && [ -n "$(tail -c1 "$CADDYFILE")" ] && printf '\n' >> "$CADDYFILE"
    printf '%s\nimport %s\n%s\n' "$MARK_BEGIN" "$SITE_REAL" "$MARK_END" >> "$CADDYFILE"
    note "已追加 3 行"
  fi
  if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    restore
    die "追加后 caddy validate 没有通过,已自动还原,现有站点不受影响。"
  fi
  note "caddy validate 通过"
fi

# ---------- 7. 生效与自检 ----------
step 7 "systemctl reload caddy(不重启),自检新站点,并确认现有站点照常"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] systemctl reload caddy(失败则还原备份并再次 reload)"
  echo "  [dry-run] 轮询 https://$DOMAIN/online/health(首次签证书最多等 120 秒)"
  echo "  [dry-run] 再次检查现有站点: ${SITES[*]:-无}(之前能访问、现在连不上或 5xx -> 自动还原并 reload)"
else
  if ! systemctl reload caddy; then
    restore
    systemctl reload caddy || true
    die "systemctl reload caddy 失败,已还原 Caddyfile 并重新 reload。"
  fi
  note "Caddy 已 reload"
  ok=0
  for _ in $(seq 1 24); do
    if curl -fsS --max-time 10 "https://$DOMAIN/online/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 5
  done
  broken=()
  for a in "${SITES[@]}"; do
    after="$(probe "$(url_of "$a")")"; before="${BEFORE[$a]}"
    note "现有站点 $(url_of "$a"): 之前 HTTP $before,现在 HTTP $after"
    if [[ "$before" =~ ^[1-4][0-9][0-9]$ ]] && { [ "$after" = "000" ] || [ -z "$after" ] || [[ "$after" =~ ^5 ]]; }; then broken+=("$a"); fi
  done
  if [ "${#broken[@]}" -gt 0 ]; then
    restore
    systemctl reload caddy || true
    die "reload 后现有站点 ${broken[*]} 变得不可访问,已自动还原 Caddyfile 并 reload。联机服务保持运行但没有接入 Caddy。"
  fi
  if [ "$ok" != 1 ]; then
    echo
    echo "注意: Caddy 配置已生效、现有站点正常,但 2 分钟内还访问不到 https://$DOMAIN/online/health。" >&2
    echo "      多半是证书还在签发(sslip.io 是共享域名,偶尔要多等一会儿)。几分钟后再试: curl https://$DOMAIN/online/health" >&2
    echo "      仍然不行请看 DEPLOY-online.md 的「常见问题」。" >&2
    exit 3
  fi
  note "https://$DOMAIN/online/health 正常"
fi
[ -n "${SITE_PREV:-}" ] && rm -f "$SITE_PREV"

# ---------- 8. 完成 ----------
step 8 "完成"
if [ "$DRY" = 1 ]; then
  echo "试运行结束,没有做任何修改。确认无误后去掉 --dry-run 再运行一次。"
else
  echo "部署成功!"
  echo "  游戏网址:   https://$DOMAIN/"
  echo "  查看日志:   journalctl -u $SERVICE -f"
  echo "  更新游戏:   sudo bash deploy/update-online.sh"
  echo "  卸载:       sudo bash deploy/uninstall-online.sh   (加 --purge 连程序和页面一起删除)"
fi
