#!/usr/bin/env bash
# 黄金矿工 · 一键部署脚本(Ubuntu 22.04/24.04)。可重复执行(幂等)。
# 用法: sudo bash deploy.sh --domain game.example.com --email you@example.com [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_USER=goldminer
WEB_ROOT=/var/www/goldminer
APP_DIR=/opt/goldminer/server
DATA_DIR=/var/lib/goldminer
BACKUP_DIR=/var/backups/goldminer
ENV_FILE=/etc/goldminer.env
PORT=8787
INET6_FILE="${GOLDMINER_INET6_FILE:-/proc/net/if_inet6}" # 可用环境变量覆盖(测试用)

DOMAIN=""
EMAIL=""
DRY=0

usage() {
  cat >&2 <<'USAGE'
用法:
  sudo bash deploy.sh --domain <域名> --email <邮箱> [--dry-run]

参数:
  --domain   你的域名,例如 game.example.com(DNS A 记录必须已指向本服务器)
  --email    你的邮箱,用于接收 Let's Encrypt 证书到期提醒
  --dry-run  只打印将要执行的每一步,不做任何修改

示例:
  sudo bash deploy.sh --domain game.example.com --email me@example.com
  sudo bash deploy.sh --domain game.example.com --email me@example.com --dry-run
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain|--email)
      if [ $# -lt 2 ]; then echo "错误: $1 需要一个值。" >&2; usage; exit 2; fi
      if [ "$1" = "--domain" ]; then DOMAIN="$2"; else EMAIL="$2"; fi
      shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "错误: 缺少 --domain 或 --email 参数。" >&2
  usage
  exit 2
fi
if ! [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; then
  echo "错误: 域名格式不正确: $DOMAIN" >&2; usage; exit 2
fi
if ! [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "错误: 邮箱格式不正确: $EMAIL" >&2; usage; exit 2
fi

# run: 真实执行,或在 --dry-run 下只打印
run() {
  if [ "$DRY" = 1 ]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}
step() { echo; echo "==> [$1/11] $2"; }
note() { echo "    $*"; }

[ "$DRY" = 1 ] && echo "*** 试运行模式(--dry-run):只显示步骤,不会修改系统 ***"

# ---------- 1. 检查系统 ----------
step 1 "检查系统(Ubuntu 22.04/24.04)和 root 权限"
if [ "$DRY" = 1 ]; then
  note "[dry-run] 检查 /etc/os-release 是否为 Ubuntu 22.04 或 24.04,并检查是否为 root"
else
  if [ "$(id -u)" -ne 0 ]; then echo "错误: 请用 root 运行(在命令前加 sudo)。" >&2; exit 1; fi
  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" != "ubuntu" ] || { [ "${VERSION_ID:-}" != "22.04" ] && [ "${VERSION_ID:-}" != "24.04" ]; }; then
    echo "错误: 只支持 Ubuntu 22.04 / 24.04,当前是 ${PRETTY_NAME:-未知系统}。" >&2; exit 1
  fi
  note "系统: ${PRETTY_NAME}"
fi

# ---------- 2. apt 与 Node ----------
step 2 "apt 安装软件包: nginx certbot python3-certbot-nginx sqlite3 ufw build-essential"
export DEBIAN_FRONTEND=noninteractive
# 新开的服务器上 unattended-upgrades 常占着 dpkg 锁:最多等 10 分钟而不是立刻报错
APT_OPTS=(-o DPkg::Lock::Timeout=600)
run apt-get "${APT_OPTS[@]}" update -y
run apt-get "${APT_OPTS[@]}" install -y nginx certbot python3-certbot-nginx sqlite3 ufw build-essential curl ca-certificates gnupg rsync

note "安装 Node.js 22 LTS (NodeSource)"
# 已有 Node >= 22 且不在用户家目录里(systemd 的 ProtectHome 访问不到)就直接用,并记录它的真实路径
node_ok() {
  local p v
  p="$(command -v node 2>/dev/null)" || return 1
  case "$p" in /root/*|/home/*) return 1 ;; esac
  v="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [ "${v:-0}" -ge 22 ]
}
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] (如果没有 Node 22) curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get ${APT_OPTS[*]} install -y nodejs"
  if node_ok; then NODE_BIN="$(command -v node)"; else NODE_BIN=/usr/bin/node; fi
elif node_ok; then
  NODE_BIN="$(command -v node)"
  note "已安装 Node $(node -v),路径 $NODE_BIN,跳过安装"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get "${APT_OPTS[@]}" install -y nodejs
  NODE_BIN="$(command -v node)"
fi
note "服务将使用 Node: $NODE_BIN"

# ---------- 3. 用户 ----------
step 3 "创建系统用户 $APP_USER"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] (如果用户不存在) useradd --system --home-dir $DATA_DIR --shell /usr/sbin/nologin $APP_USER"
elif id "$APP_USER" >/dev/null 2>&1; then
  note "用户已存在,跳过"
else
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# ---------- 4. 复制文件 ----------
step 4 "复制文件: 游戏 -> $WEB_ROOT,服务端 -> $APP_DIR,并 npm ci"
run mkdir -p "$WEB_ROOT" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
run install -m 644 "$REPO_DIR/index.html" "$WEB_ROOT/index.html"
run rsync -a --delete --exclude node_modules --exclude data --exclude backups --exclude test --exclude client \
  "$REPO_DIR/server/" "$APP_DIR/"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] cd $APP_DIR && npm ci --omit=dev"
else
  (cd "$APP_DIR" && npm ci --omit=dev)
fi
run chown -R root:root "$APP_DIR"
run chown -R "$APP_USER:$APP_USER" "$DATA_DIR" "$BACKUP_DIR"
run chmod 750 "$DATA_DIR" "$BACKUP_DIR"
run touch /var/log/goldminer-backup.log
run chown "$APP_USER:$APP_USER" /var/log/goldminer-backup.log

# 管理命令包装器: sudo goldminer-admin list
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] 写入 /usr/local/bin/goldminer-admin(自动读取 $ENV_FILE 并以 $APP_USER 身份运行 admin.js)"
else
  cat > /usr/local/bin/goldminer-admin <<WRAP
#!/bin/sh
# 用法: sudo goldminer-admin list | delete <id> | rename <id> <新名字> | archive --version 2 | clear --mode solo --yes
set -a
. $ENV_FILE
set +a
cd $APP_DIR
exec runuser -u $APP_USER -- $NODE_BIN $APP_DIR/admin.js "\$@"
WRAP
  chmod 755 /usr/local/bin/goldminer-admin
fi

# ---------- 5. env 文件 ----------
step 5 "生成 env 文件 $ENV_FILE(只在不存在时生成)"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] (如果 $ENV_FILE 不存在) 生成含随机 24 位 ADMIN_PASSWORD 的文件,权限 600,密码只显示这一次"
elif [ -f "$ENV_FILE" ]; then
  note "$ENV_FILE 已存在,保持不变(不会重新生成管理员密码)"
else
  ADMIN_PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24 || true)"
  umask 077
  cat > "$ENV_FILE" <<ENVF
PORT=$PORT
DB_PATH=$DATA_DIR/scores.db
BACKUP_DIR=$BACKUP_DIR
TRUST_PROXY=1
ADMIN_PASSWORD=$ADMIN_PW
SITE_DOMAIN=$DOMAIN
ENVF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  echo
  echo "################################################################"
  echo "  管理员密码(只显示这一次,请立刻保存到密码管理器):"
  echo "  $ADMIN_PW"
  echo "  忘记了可以查看 $ENV_FILE(需要 root)"
  echo "################################################################"
fi

# ---------- 6. systemd ----------
step 6 "安装 systemd 服务 goldminer 并启动"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] 渲染 goldminer.service(ExecStart 使用 $NODE_BIN)-> /etc/systemd/system/goldminer.service"
else
  sed "s|^ExecStart=/usr/bin/node |ExecStart=$NODE_BIN |" "$SCRIPT_DIR/goldminer.service" > /etc/systemd/system/goldminer.service
  chmod 644 /etc/systemd/system/goldminer.service
fi
run systemctl daemon-reload
run systemctl enable goldminer
run systemctl restart goldminer

# ---------- 7. nginx ----------
step 7 "配置 nginx 站点 $DOMAIN(静态游戏 + /api 反向代理)"
SITE=/etc/nginx/sites-available/goldminer
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] 用 nginx.conf.tpl 渲染到 $SITE(替换 __DOMAIN__=$DOMAIN __ROOT__=$WEB_ROOT __PORT__=$PORT)"
  if [ -e "$INET6_FILE" ]; then
    echo "  [dry-run] 本机有 IPv6($INET6_FILE 存在):保留 listen [::]:80"
  else
    echo "  [dry-run] 本机没有 IPv6($INET6_FILE 不存在):去掉 listen [::]:80"
  fi
  echo "  [dry-run] ln -sf $SITE /etc/nginx/sites-enabled/goldminer; rm -f /etc/nginx/sites-enabled/default"
  echo "  [dry-run] nginx -t && systemctl reload nginx"
else
  if [ -f "$SITE" ] && grep -q "managed by Certbot" "$SITE"; then
    note "站点配置已由 certbot 接管,保持不变"
  else
    sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__ROOT__|$WEB_ROOT|g" -e "s|__PORT__|$PORT|g" \
      "$SCRIPT_DIR/nginx.conf.tpl" > "$SITE"
    if [ ! -e "$INET6_FILE" ]; then
      sed -i '/listen \[::\]/d' "$SITE"
      note "本机没有 IPv6,已去掉 listen [::]:80"
    fi
  fi
  ln -sf "$SITE" /etc/nginx/sites-enabled/goldminer
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx || systemctl restart nginx
fi

# ---------- 8. certbot ----------
step 8 "申请 HTTPS 证书 (certbot)"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect --non-interactive --keep-until-expiring"
else
  if ! certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect --non-interactive --keep-until-expiring; then
    echo "警告: 证书申请失败。常见原因: DNS 还没生效 / 80 端口没开放 / 域名没指向本机。" >&2
    echo "      修好后重新运行本脚本即可(可重复执行)。详见 DEPLOY.md 第 11 节。" >&2
    exit 1
  fi
  note "证书自动续期由 certbot 自带的 systemd timer 负责: systemctl list-timers | grep certbot"
fi

# ---------- 9. ufw ----------
step 9 "配置防火墙 (ufw): 放行 OpenSSH 和 Nginx Full"
detect_ssh_ports() {
  local ports
  ports="$(sshd -T 2>/dev/null | awk '/^port /{print $2}')"
  if [ -z "$ports" ]; then
    ports="$(ss -H -tlnp 2>/dev/null | awk '/sshd/{n=split($4,a,":"); print a[n]}')"
  fi
  [ -n "$ports" ] || ports=22
  echo "$ports" | sort -un
}
run ufw allow OpenSSH
# sshd 实际监听的端口也要放行,否则启用防火墙后会把自己锁在外面
for p in $(detect_ssh_ports); do
  run ufw allow "$p/tcp"
done
run ufw allow "Nginx Full"
run ufw --force enable

# ---------- 10. cron ----------
step 10 "安装每日备份 cron(每天 03:17,保留 30 天)"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] 渲染 goldminer-backup.cron(使用 $NODE_BIN)-> /etc/cron.d/goldminer-backup"
  echo "  [dry-run] install -m 644 $SCRIPT_DIR/goldminer-backup.cron /etc/cron.d/goldminer-backup"
elif [ -f /etc/cron.d/goldminer-backup ]; then
  note "/etc/cron.d/goldminer-backup 已存在(可能含你的异地上传设置),保持不变"
else
  sed "s|goldminer /usr/bin/node |goldminer $NODE_BIN |" "$SCRIPT_DIR/goldminer-backup.cron" > /etc/cron.d/goldminer-backup
  chmod 644 /etc/cron.d/goldminer-backup
fi

# ---------- 11. 自检 ----------
step 11 "自检 health: curl https://$DOMAIN/api/health"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] curl -fsS https://$DOMAIN/api/health"
else
  ok=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "https://$DOMAIN/api/health"; then ok=1; break; fi
    sleep 2
  done
  echo
  if [ "$ok" != 1 ]; then
    echo "自检失败。请查看: journalctl -u goldminer -n 50 --no-pager" >&2
    exit 1
  fi
fi

echo
if [ "$DRY" = 1 ]; then
  echo "试运行结束,没有做任何修改。确认无误后去掉 --dry-run 再运行一次。"
else
  echo "部署成功!"
  echo "  游戏地址:   https://$DOMAIN/"
  echo "  管理命令:   sudo goldminer-admin list"
  echo "  下一步:     1) 浏览器打开游戏;2) 用 itdog.cn 测试国内访问;3) 阅读 DEPLOY.md 的更新与备份章节"
fi
