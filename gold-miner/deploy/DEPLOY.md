# 黄金矿工 · 在线排行榜部署指南(简体中文)

这份指南写给**没有运维经验**的人。照着一步步做,大约 1 小时能把游戏和排行榜放到公网上,中国大陆的玩家也能直接打开。

> 方案概述:买一台**香港**的云服务器(香港节点不需要 ICP 备案),买一个域名指向它,运行一条部署命令。
> 服务器上 Nginx 同时提供游戏页面和 `/api` 排行榜接口(同一个域名),HTTPS 证书由 Let's Encrypt 免费自动签发和续期。
> 本方案**不使用 Cloudflare**。

目录:

1. [你需要准备什么(费用估算)](#1-你需要准备什么费用估算)
2. [购买香港 VPS](#2-购买香港-vps)
3. [购买域名并添加 DNS 记录](#3-购买域名并添加-dns-记录)
4. [用 SSH 登录服务器](#4-用-ssh-登录服务器)
5. [一键部署](#5-一键部署)
6. [验证网站和排行榜](#6-验证网站和排行榜)
7. [用 itdog.cn 测试国内访问](#7-用-itdogcn-测试国内访问)
8. [以后更新游戏](#8-以后更新游戏)
9. [备份与恢复](#9-备份与恢复)
10. [管理员操作](#10-管理员操作)
11. [常见问题](#11-常见问题)

---

## 1. 你需要准备什么(费用估算)

| 项目 | 说明 | 大致费用(以购买时官网价格为准) |
|---|---|---|
| 香港云服务器 | 1 核 1 GB 内存 / 20 GB 以上硬盘 / Ubuntu 22.04 或 24.04 即可,选**香港**地域 | 约 30–60 元/月(新用户常有首年优惠) |
| 域名 | `.com` / `.xyz` / `.top` 等均可 | 约 10–80 元/年(`.xyz` 首年很便宜,`.com` 约 70 元/年) |
| 证书 | Let's Encrypt,自动续期 | 免费 |
| 异地备份(可选) | 对象存储 COS / OSS | 几乎为 0(数据只有几 MB) |

合计:**约 40–70 元/月**,第一年加上域名约 500–800 元。

另外你需要:

- 一张能付款的银行卡或支付宝 / 微信(买服务器和域名用)。
- 一个常用邮箱(Let's Encrypt 用它发证书到期提醒)。
- 本项目整个文件夹(含 `index.html`、`server/`、`deploy/`)。
- 一台能联网的电脑(Windows 10/11 或 macOS)。

> **为什么选香港?** 中国大陆境内的服务器必须先做 ICP 备案(要等十几到几十天),香港服务器不需要。香港到大陆的线路通常比较快、比较稳定。

---

## 2. 购买香港 VPS

以**腾讯云轻量应用服务器**为例(阿里云国际站、华为云、其他厂商的香港节点步骤类似):

1. 打开腾讯云官网,注册并完成实名认证(境外厂商如 Vultr / DigitalOcean 不需要实名,但要信用卡)。
2. 进入"轻量应用服务器" → "新建"。
3. 选择:
   - **地域**:中国香港
   - **镜像**:系统镜像 → **Ubuntu 22.04 LTS 或 24.04 LTS**(不要选带宝塔、LAMP 等应用的镜像)
   - **套餐**:1 核 1 GB 或 2 GB 内存的最小档即可(流量包不用太大)
   - **时长**:先买 1 个月试用也行
4. 付款后进入"服务器"列表,记下**公网 IP**(形如 `43.xxx.xxx.xxx`),并设置/记住 root 密码(没有设置的话在"重置密码"里设)。
5. **开放端口(很重要)**:在服务器详情 → "防火墙"(阿里云叫"安全组")里,确认放行以下三个端口,没有就添加:
   - `22`(SSH 登录)
   - `80`(HTTP,申请证书也要用)
   - `443`(HTTPS)

> 阿里云国际站:产品选"轻量应用服务器"或 ECS,地域选"中国香港",在"安全组"里添加入方向规则 22 / 80 / 443,授权对象 `0.0.0.0/0`。

---

## 3. 购买域名并添加 DNS 记录

1. 在任意域名注册商(腾讯云 DNSPod、阿里云万网、Namecheap、GoDaddy 等)买一个域名,例如 `example.com`。
2. 决定游戏的网址,比如 `game.example.com`(也可以直接用 `example.com`)。
3. 进入域名的"DNS 解析"页面,**添加一条 A 记录**:

   | 主机记录 | 记录类型 | 记录值 |
   |---|---|---|
   | `game` | A | 你的服务器公网 IP |

   (如果想用根域名 `example.com`,主机记录填 `@`。)
4. **不要开启任何"代理 / CDN / 小黄云"**,只做普通的 DNS 解析。
5. 等待生效:通常 **5–30 分钟**,最慢可能 24 小时(国内注册商一般几分钟)。

验证 DNS 是否生效(在你自己的电脑上执行,把 `game.example.com` 换成你的域名):

```bash
ping game.example.com
```

看到的 IP 地址等于你的服务器 IP 就说明生效了(`ping` 不通没关系,有些服务器禁 ping,只看它解析出来的 IP)。也可以用:

```bash
nslookup game.example.com
```

输出里的 `Address:` 应该是你的服务器 IP。**如果还不是,就再等一会儿,不要继续往下做**(DNS 没生效时申请证书一定会失败)。

---

## 4. 用 SSH 登录服务器

### Windows 10/11

1. 按 `Win + X`,选"终端"或"Windows PowerShell"。
2. 输入(把 IP 换成你的):

   ```powershell
   ssh root@43.xxx.xxx.xxx
   ```
3. 第一次连接会问 `Are you sure you want to continue connecting?`,输入 `yes` 回车。
4. 输入 root 密码(**输入时屏幕上不会显示任何字符**,这是正常的),回车。
5. 看到 `root@...:~#` 就登录成功了。

### macOS

1. 打开"启动台"→"其他"→"终端"。
2. 输入 `ssh root@43.xxx.xxx.xxx`,后面步骤同上。

> 腾讯云/阿里云网页上也有"一键登录 / 远程连接"按钮,打开就是一个网页终端,不会用 SSH 时可以先用它。

### 把项目文件传到服务器

**方法 A(推荐):在你自己的电脑上**打开一个新的终端窗口(不是已经登录服务器的那个),进入项目所在的上级目录,执行:

```bash
scp -r gold-miner root@43.xxx.xxx.xxx:/root/
```

(Windows PowerShell 同样可用。`gold-miner` 是项目文件夹名。传完后服务器上就有 `/root/gold-miner`。)

**方法 B:** 如果项目放在 Git 仓库里,在服务器上执行 `apt-get update && apt-get install -y git && git clone <仓库地址> /root/gold-miner`。

---

## 5. 一键部署

在**服务器的终端里**(已 SSH 登录)执行,把域名和邮箱换成你自己的:

```bash
cd /root/gold-miner/deploy
sudo bash deploy.sh --domain game.example.com --email you@example.com
```

参数说明:

| 参数 | 含义 |
|---|---|
| `--domain` | 你的域名(第 3 步里解析到服务器的那个) |
| `--email` | 你的邮箱,用于接收证书到期提醒 |
| `--dry-run` | 可选。只打印每一步要做什么,**不做任何修改**。建议第一次先加上它看一眼 |

先试运行:

```bash
sudo bash deploy.sh --domain game.example.com --email you@example.com --dry-run
```

确认没问题,去掉 `--dry-run` 再运行一次。脚本大约需要 3–10 分钟,会自动完成:

1. 检查系统;2. 安装 nginx、certbot、Node.js 22 等;3. 创建运行用户 `goldminer`;4. 复制游戏和服务端文件;5. 生成配置文件和管理员密码;6. 设置并启动服务(崩溃自动重启、开机自启);7. 配置 Nginx;8. 申请 HTTPS 证书;9. 开启防火墙;10. 安装每日备份;11. 自检。

> 脚本**可以重复运行**:中途失败了,把问题修好后再运行同一条命令即可。

### 保存管理员密码(只显示一次!)

脚本中间会打印一个框,里面是 24 位的**管理员密码**:

```
################################################################
  管理员密码(只显示这一次,请立刻保存到密码管理器):
  AbCd1234...
################################################################
```

请立刻复制保存到密码管理器或安全的笔记里。万一忘记了,以 root 登录服务器后可以用 `cat /etc/goldminer.env` 查看(这个文件只有 root 能读)。

最后看到"**部署成功!**"就完成了。

---

## 6. 验证网站和排行榜

1. 在浏览器打开 `https://game.example.com/`,应该能看到游戏,地址栏有小锁。
2. 打开 `https://game.example.com/api/health`,应该显示:

   ```json
   {"ok":true}
   ```
3. 打开 `https://game.example.com/api/leaderboard?mode=solo`,应该显示 `{"mode":"solo","entries":[]}`(还没人上榜时 `entries` 为空)。
4. 在游戏里打一局单人模式,进入前 20 时会弹出输入名字的窗口,提交后按 **L** 键打开排行榜就能看到自己。

在服务器上也可以检查服务状态:

```bash
systemctl status goldminer --no-pager
curl -fsS https://game.example.com/api/health
```

> 说明:游戏里的排行榜界面属于前端(`index.html`)部分,如果你的 `index.html` 还没有接入排行榜,第 1–3 项仍然可以验证服务端已经正常运行。

---

## 7. 用 itdog.cn 测试国内访问

部署在香港,大陆是否能顺畅访问,要从国内多个运营商实际测一下。

1. 浏览器打开 <https://www.itdog.cn/>。
2. **网站测速(http)**:点"网站测速",输入 `https://game.example.com/`,点"开始测试"。页面会从全国几十个节点(电信 / 联通 / 移动,不同省份)访问你的网站。
   - 看**状态码**:`200` 表示正常。
   - 看**总耗时**:一般 0.3–1.5 秒都算正常;持续超过 3 秒或超时表示线路差。
   - 看**地图颜色**:绿色=快,红色=失败或超时。少数几个节点红色问题不大,**大面积红色**要处理。
3. **Ping 测试**:点"Ping 检测",输入域名(或 IP)。
   - "丢包率"最好为 0%,低于 5% 可以接受。
   - 延迟 30–80 ms(华南)到 100–200 ms(东北、西北)是香港线路的常见范围。
4. 再测一次接口:网站测速里输入 `https://game.example.com/api/health`,应该返回 200。

**如果国内大面积不通怎么办:**

1. 先确认不是服务器本身的问题:用 itdog.cn 的"Ping 检测"测**海外节点**(页面上有海外选项),海外正常、国内不通才是线路问题。
2. 检查第 2 步的**防火墙/安全组**是否放行 80 和 443。
3. 检查域名是否被 DNS 污染/拦截:换一个不同的子域名、或换一家 DNS 服务商再试。
4. 少数 IP 段可能被个别运营商限速:可以在云厂商控制台**更换公网 IP**(或重新开一台服务器),重新做第 3、5 步。
5. 选择"优化线路"的香港套餐(例如 CN2 GIA / CMI 线路),价格稍贵但对大陆更稳定。

---

## 8. 以后更新游戏

当你改了游戏(`index.html`)或服务端代码后:

1. 在自己的电脑上,把改过的项目重新传到服务器(同第 4 步):

   ```bash
   scp -r gold-miner root@43.xxx.xxx.xxx:/root/
   ```
2. 在服务器上运行:

   ```bash
   cd /root/gold-miner/deploy
   sudo bash update.sh                # 游戏和服务端都更新
   sudo bash update.sh --game-only    # 只更新游戏页面(最常用,几秒钟)
   sudo bash update.sh --server-only  # 只更新服务端并重启
   ```

   加上 `--dry-run` 可以只看不做。脚本最后会自检 `/api/health`。

排行榜数据存在 `/var/lib/goldminer/`,更新**不会**动它。玩家的浏览器因为 `index.html` 设置了 `no-cache`,刷新页面就能拿到新版本。

---

## 9. 备份与恢复

### 自动备份

部署脚本已经设置好了:**每天凌晨 03:17** 自动做一次在线备份(不影响玩家使用),文件放在 `/var/backups/goldminer/`,名字形如 `scores-20260615-031700.db`(时间为 UTC),**保留 30 天**,每次备份后会自动校验完整性。日志在 `/var/log/goldminer-backup.log`。

手动备份一次:

```bash
sudo -u goldminer env DB_PATH=/var/lib/goldminer/scores.db BACKUP_DIR=/var/backups/goldminer \
  node /opt/goldminer/server/scripts/backup.js
ls -lh /var/backups/goldminer/
```

### 恢复

1. 找到要恢复的备份:`ls /var/backups/goldminer/`
2. 依次执行(把文件名换成你的):

   ```bash
   sudo systemctl stop goldminer
   sudo cp /var/lib/goldminer/scores.db /root/scores.db.before-restore   # 先留一份现状,以防万一
   sudo rm -f /var/lib/goldminer/scores.db-wal /var/lib/goldminer/scores.db-shm
   sudo cp /var/backups/goldminer/scores-20260615-031700.db /var/lib/goldminer/scores.db
   sudo chown goldminer:goldminer /var/lib/goldminer/scores.db
   sudo systemctl start goldminer
   curl -fsS http://127.0.0.1:8787/api/health
   ```
3. 打开排行榜确认数据回来了。

### 可选:异地备份(强烈建议,服务器坏了本地备份也会丢)

做法:每次备份完成后,让脚本自动执行一条"上传"命令。**本项目不包含任何密钥**,你需要自己在云厂商控制台创建存储桶和访问密钥。

编辑 cron 文件:

```bash
sudo nano /etc/cron.d/goldminer-backup
```

找到注释掉的 `# OFFSITE_CMD=...` 一行,取消注释并按你的情况修改,`{file}` 会被替换成刚生成的备份文件路径。

**腾讯云 COS**(先安装并配置 [coscli](https://cloud.tencent.com/document/product/436/63669),`coscli config init` 里填入你的 SecretId/SecretKey):

```
OFFSITE_CMD=coscli cp {file} cos://你的桶名-1250000000/goldminer/
```

**阿里云 OSS**(先安装并配置 [ossutil](https://help.aliyun.com/zh/oss/developer-reference/ossutil),`ossutil config` 里填入 AccessKey):

```
OFFSITE_CMD=ossutil cp {file} oss://你的桶名/goldminer/
```

注意:cron 以 `goldminer` 用户运行,所以 `coscli` / `ossutil` 的配置要给这个用户配置,例如 `sudo -u goldminer coscli config init`(该用户的家目录是 `/var/lib/goldminer`)。上传失败只会写日志,不影响本地备份。可以在 COS/OSS 控制台给桶设置"生命周期"自动删除 90 天前的文件。

---

## 10. 管理员操作

部署脚本安装了一个管理命令 `goldminer-admin`(自动读取密码和数据库位置),在服务器上用 `sudo` 运行。

```bash
# 查看(id、模式、分数、名字、关数、角色、规则版本、时间)
sudo goldminer-admin list
sudo goldminer-admin list --mode solo --limit 20

# 删除一条(先 list 找到 id)
sudo goldminer-admin delete 12

# 改名(会按和玩家提交时一样的规则校验)
sudo goldminer-admin rename 12 新名字

# 归档:把某个规则版本的成绩导出成 JSON 文件,然后从榜单中删除
# (例如游戏规则改了,想让大家重新上榜)
sudo goldminer-admin archive --version 2
sudo goldminer-admin archive --version 2 --mode solo
# 归档文件在 /var/backups/goldminer/archive-<模式或all>-v<版本>-<时间>.json

# 清空某个模式的榜单(危险!必须加 --yes;建议先 archive 或备份)
sudo goldminer-admin clear --mode versus --yes
sudo goldminer-admin clear --mode solo --version 1 --yes
```

通过 HTTP 接口操作也可以(密码用你保存的管理员密码):

```bash
PW='你的管理员密码'
curl -s -H "Authorization: Bearer $PW" "https://game.example.com/api/admin/scores?mode=solo&limit=20"
curl -s -X DELETE -H "Authorization: Bearer $PW" https://game.example.com/api/admin/scores/12
curl -s -X PATCH  -H "Authorization: Bearer $PW" -H 'Content-Type: application/json' \
     -d '{"name":"新名字"}' https://game.example.com/api/admin/scores/12
curl -s -X POST   -H "Authorization: Bearer $PW" -H 'Content-Type: application/json' \
     -d '{"version":2,"mode":"solo"}' https://game.example.com/api/admin/archive
curl -s -X POST   -H "Authorization: Bearer $PW" -H 'Content-Type: application/json' \
     -d '{"mode":"versus","confirm":true}' https://game.example.com/api/admin/clear
```

**修改管理员密码:** `sudo nano /etc/goldminer.env` 改 `ADMIN_PASSWORD=` 那一行,然后 `sudo systemctl restart goldminer`。把 `ADMIN_PASSWORD=` 留空则关闭全部管理接口(命令行工具不受影响)。

---

## 11. 常见问题

**Q1. 证书申请失败(certbot 报错)**
最常见的三个原因:
1. **DNS 还没生效**:用 `nslookup 你的域名` 确认解析到的是服务器 IP,没生效就再等。
2. **80 端口访问不了**:检查第 2 步的防火墙/安全组是否放行 80 和 443;服务器上 `sudo ufw status` 应该能看到 Nginx Full。如果你的 SSH 不是 22 端口,脚本会自动检测 sshd 实际端口并在防火墙放行它。
3. **短时间内申请太多次**:Let's Encrypt 有频率限制,等一小时再试。

修好之后重新运行同一条 `deploy.sh` 命令即可。

**Q1b. 提示 `Could not get lock /var/lib/dpkg/lock-frontend`**
新开的服务器刚开机几分钟内,系统会在后台自动更新,占着安装软件用的"锁"。脚本已经设置了最多等待 10 分钟;如果仍然报这个错,等 5–10 分钟,再运行同一条部署命令即可(不要手动删除锁文件)。

**Q2. 提示 80 端口被占用(nginx 启动失败)**
查看谁占用了:`sudo ss -ltnp | grep ':80 '`。如果是 Apache(`apache2`):`sudo systemctl disable --now apache2` 后重试。镜像选了带宝塔/LAMP 的话,建议重装成干净的 Ubuntu。

**Q3. 浏览器打不开 / 一直转圈**
1. 云厂商的**安全组/防火墙**没放行 80/443(最常见)。
2. 域名 DNS 还没生效。
3. 用手机流量(换网络)再试,排除本地网络问题;再按第 7 节用 itdog.cn 测试。

**Q4. 游戏能打开,但排行榜显示"暂时无法连接排行榜"**
1. 看服务是否在运行:`systemctl status goldminer --no-pager`
2. 在服务器上测:`curl -fsS http://127.0.0.1:8787/api/health`(正常返回 `{"ok":true}`)
3. 再测公网:`curl -fsS https://你的域名/api/health`;如果这条不通而上一条通,问题在 Nginx:`sudo nginx -t` 和 `sudo tail -n 50 /var/log/nginx/error.log`。
4. 如果你是用 `file://` 直接双击打开 `index.html`,这时排行榜无法连接是正常的(需要通过网站访问)。

**Q5. 服务起不来**
查看日志:

```bash
journalctl -u goldminer -n 100 --no-pager
```

常见原因:`npm ci` 没成功(缺 `build-essential`,重新运行 `deploy.sh`);`/etc/goldminer.env` 里的 `PORT` 被占用(`sudo ss -ltnp | grep 8787`);数据库目录权限不对(`sudo chown -R goldminer:goldminer /var/lib/goldminer`)。修好后 `sudo systemctl restart goldminer`。

**Q6. 玩家提示"提交太频繁"**
服务端限制每个 IP 每分钟最多提交 5 次、每小时 30 次,同一个学校/公司出口 IP 下的多名玩家共享这个额度。正常游玩一般不会触发。

**Q7. 证书会过期吗?**
不会。certbot 安装时带有自动续期的定时任务,查看:`systemctl list-timers | grep certbot`;手动演练:`sudo certbot renew --dry-run`。

**Q8. 怎样看有多少人上榜了?**
`sudo goldminer-admin list --mode solo --limit 100`,或 `sqlite3 /var/lib/goldminer/scores.db 'select mode,count(*) from scores group by mode;'`。

**Q9. 想换域名**
重新运行 `deploy.sh --domain 新域名 --email ...`;旧的 Nginx 站点配置在 `/etc/nginx/sites-available/goldminer`,换域名前先删除它再运行脚本,这样会重新生成配置。

**Q10. 想完全卸载**
`sudo systemctl disable --now goldminer; sudo rm -rf /opt/goldminer /var/www/goldminer /etc/systemd/system/goldminer.service /etc/cron.d/goldminer-backup /etc/nginx/sites-enabled/goldminer /etc/nginx/sites-available/goldminer; sudo systemctl reload nginx`。数据在 `/var/lib/goldminer` 和 `/var/backups/goldminer`,确认不需要再删除。
