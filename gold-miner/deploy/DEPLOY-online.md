# 黄金矿工联机版 · 部署说明(和服务器上现有的软件共存)

这份说明写给没有运维经验的你。照着复制粘贴命令即可,每一步都可以先"试运行"看看会发生什么。

你的服务器现状(你之前实测的):Ubuntu 24.04,腾讯云轻量,公网 IP `43.161.221.249`;**Caddy** 已经在用 80/443 端口,
现有站点 `43.161.221.249.sslip.io` 转发到 `127.0.0.1:8787`;**8787 是你的另一个程序**;系统 Node 是 v22。

联机版部署好以后的网址:**`https://goldminer.43.161.221.249.sslip.io/`**

---

## 1. 这次会做什么、不会做什么

部署脚本 `deploy/deploy-online.sh` **会做**:

- 新建一个系统用户 `goldminer`(不能登录,只用来运行联机服务);
- 把游戏页面放到 `/var/www/goldminer/index.html`,把联机服务放到 `/opt/goldminer-online/`;
- 生成配置文件 `/etc/goldminer-online.env`(权限 600,里面没有密码);
- 安装并启动 systemd 服务 `goldminer-online`,它**只在本机 `127.0.0.1:8790` 上监听**,外网访问不到;
- 新增一个 Caddy 站点文件 `/etc/caddy/goldminer.caddy`,并在主配置 `/etc/caddy/Caddyfile` 的**末尾追加 3 行**
  (1 行 `import`,前后各 1 行注释标记)。改之前会先备份成 `/etc/caddy/Caddyfile.bak-goldminer-<时间>`;
- 用 `caddy validate` 检查通过后,执行 `systemctl reload caddy`(平滑重新加载,现有站点不会断)。

部署脚本 **不会做什么**(脚本每次都按这些原则运行,自动测试逐条检查过):

- **不安装任何软件**:不执行 `apt-get install`,不装 nginx、certbot、Docker,也不装、不升级、不替换 Node(只检查 `/usr/bin/node` 版本 ≥ 22);
- **不碰防火墙**:不启用、不修改 ufw 和任何防火墙规则;
- **不修改 Caddyfile 里已有的任何一行**,不执行 `systemctl restart caddy` 或 `systemctl stop caddy`,只 `reload`;
- **不碰 8787**:8787 是你的另一个程序,本项目不会结束它、不会访问它,只是在选端口时把 8787 列为不能用的端口;
- 所有新文件名都带 `goldminer`,卸载时只删除自己加的东西。

想自己确认 8787 是你的另一个程序(和本项目无关):

```bash
sudo ss -ltnp | grep 8787
ps -o user,cmd -p <上一条命令里 pid= 后面的数字>
```

部署前后各运行一次,结果应该完全一样。

## 2. 网址:goldminer.43.161.221.249.sslip.io

**sslip.io 会把名字里的 IP 直接解析出来**,所以不用买域名、也不用配置 DNS,Caddy 会自动为它申请 HTTPS 证书。

验证一下这个名字确实指向你的服务器(在你自己的电脑或服务器上都可以运行):

```bash
nslookup goldminer.43.161.221.249.sslip.io
```

看到 `Address: 43.161.221.249` 就对了。

**备选:用你自己的域名。** 以后如果买了域名(例如 `game.example.com`),在域名服务商那里添加一条 **A 记录**:
主机记录填 `game`,记录值填 `43.161.221.249`。等几分钟生效后,把下面所有命令里的
`goldminer.43.161.221.249.sslip.io` 换成 `game.example.com` 再运行部署脚本即可(先卸载旧的或直接再部署一次都可以)。

## 3. 腾讯云防火墙

80 和 443 端口已经为你现有的站点放行了,**不需要新开任何端口**。

**不要**在腾讯云控制台放行 8790:联机服务只给本机的 Caddy 用,外网不需要、也不应该直接访问它。

## 4. 把项目传到服务器并部署

先用 SSH 登录服务器(和以前一样;腾讯云轻量的 Ubuntu 默认登录用户是 `ubuntu`,例如 `ssh ubuntu@43.161.221.249`,需要权限的命令前面都加了 `sudo`)。把项目放到服务器上,二选一:

**方法 A:git clone**(服务器能访问 GitHub 时)

```bash
cd ~
git clone <你的仓库地址> goldminer-src
cd goldminer-src/gold-miner
```

**方法 B:scp 上传**(在你自己的电脑上运行,把整个 `gold-miner` 文件夹传上去)

```bash
scp -r gold-miner ubuntu@43.161.221.249:~/goldminer-src
```

然后在服务器上进入项目目录(下文的命令都在这个目录里运行):

```bash
cd ~/goldminer-src          # 用方法 A(git clone)时是 cd ~/goldminer-src/gold-miner
```

**第一步:试运行**(只检查、只打印,不做任何修改):

```bash
sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io --dry-run
```

看一遍输出,特别是第 1 步"预检"有没有报错。没问题就**正式运行**:

```bash
sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io
```

脚本分 8 步,大约 1–3 分钟。最后看到"部署成功!"和游戏网址就完成了。

如果中途失败,脚本会说明原因;凡是动过 Caddy 配置的步骤失败,它都会**自动用备份还原**并重新 reload,现有站点不受影响。
修好问题后可以直接重新运行(可以重复执行,不会重复追加 `import`,也不会覆盖已有的配置文件)。

## 5. 验证

1. 浏览器打开 `https://goldminer.43.161.221.249.sslip.io/`,能看到游戏主菜单,右下角有"联机(O)"按钮。
2. 在服务器上检查联机服务:

   ```bash
   curl https://goldminer.43.161.221.249.sslip.io/online/health
   ```

   应该返回类似 `{"ok":true,"build":"…","rooms":0,"games":0,"conns":0}`。
3. **确认原来的站点照常可用**:浏览器打开 `https://43.161.221.249.sslip.io/`,和部署前一样能用。
   (脚本自己也在 reload 前后各检查了一次:原来能访问、现在访问不了的话,它会自动还原。)
4. 两台电脑实际联一局(见第 7 节)。

## 6. 用 itdog.cn 测试国内访问

和 `DEPLOY.md` 第 7 节一样:打开 [https://www.itdog.cn/http/](https://www.itdog.cn/http/) "网站测速",输入
`https://goldminer.43.161.221.249.sslip.io/`,看各地的响应时间和状态码(应为 200)。
再用 "Ping" 测试 `43.161.221.249`,香港服务器到大陆一般在 20–80 ms。

## 7. 怎么和女朋友开局

1. **两人都需要用电脑**(键盘操作)。手机和平板打不了联机对战。
2. 你在电脑浏览器打开游戏网址,点"联机(O)"(或按 `O`),填个昵称,点"创建房间"。
3. 页面上会显示 6 位房间码,点"复制邀请链接",用微信发给她。
4. 她在**电脑浏览器**里打开链接:如果是在电脑版微信里点开的,请点右上角菜单选"在默认浏览器打开"。
   填个昵称,点"加入房间"。
5. 两边各自选角色,都确认后自动开局。规则和本地双人对战一模一样;P 暂停,任何一方都能继续。
6. 一局打完,两人都按"再来一局"就会回到选角色;关掉页面或网络断了,10 分钟内重新打开链接会自动回到原来的座位。

如果她用手机打开了链接,只会看到提示"联机对战需在电脑上进行"和这条链接,让她换电脑打开即可。

## 8. 常用命令:更新、卸载、日志、重启

更新(先 `git pull` 或重新上传新文件,再运行):

```bash
cd ~/goldminer-src          # 用方法 A(git clone)时是 cd ~/goldminer-src/gold-miner
sudo bash deploy/update-online.sh --dry-run
sudo bash deploy/update-online.sh
```

有人正在对局时脚本会拒绝更新(更新要重启服务,会结束进行中的对局);确实要更新就加 `--force`。
已经打开游戏的人会看到"游戏已更新,请刷新页面",刷新即可。

卸载(只删除本项目加的东西;主 Caddyfile 会恢复成安装前的样子):

```bash
sudo bash deploy/uninstall-online.sh --dry-run
sudo bash deploy/uninstall-online.sh
```

加 `--purge` 会连 `/opt/goldminer-online`、`/var/www/goldminer`、`/etc/goldminer-online.env` 和用户 `goldminer` 一起删除
(服务器上还有其他 goldminer 服务时,会保留页面目录和用户)。

查看日志、重启服务:

```bash
journalctl -u goldminer-online -f
journalctl -u goldminer-online -n 100 --no-pager
sudo systemctl restart goldminer-online
systemctl status goldminer-online
```

重启服务会结束进行中的对局(房间只保存在内存里)。

## 9. 常见问题

**Q1:证书一直没签下来,`curl https://goldminer.43.161.221.249.sslip.io/online/health` 报证书错误或连不上。**
sslip.io 是很多人共用的域名,Let's Encrypt 按注册域名限制签发次数,偶尔会失败。Caddy 会自动重试,
失败多次还会自动改用 ZeroSSL,通常几分钟到几十分钟内会好。可以用 `journalctl -u caddy -n 100 --no-pager | grep -i goldminer` 看进度。
一直不行的话,改用你自己的域名(第 2 节的备选做法)。脚本在这种情况下会提示
"注意: Caddy 配置已生效、现有站点正常,但 2 分钟内还访问不到 https://…/online/health。"并以代码 3 退出,
但已经部署好的东西不会被撤销,证书签下来后就能用。

**Q2:页面提示"游戏已更新,请刷新页面"。**
服务器上的游戏刚更新过,你打开的还是旧页面。点"刷新"按钮即可(两个人都要刷新)。

**Q3:连不上,或者总是掉线。**
先确认网址能打开、`/online/health` 有返回。掉线多半是网络问题:关掉电脑上的代理 / VPN / 加速器再试,
或者换个网络。游戏会自动重连,10 分钟内回来都能回到原来的座位。

**Q4:脚本说 `caddy validate` 没有通过,它做了什么?**
- 如果是**部署前**的检查失败:说明你现有的 Caddyfile 本身就有问题,脚本**什么都没改**就退出了。先让原来的站点恢复正常再部署。
- 如果是**追加 import 之后**失败:脚本已经用备份把 Caddyfile 还原(并逐字节核对过),删掉了 `goldminer.caddy`,现有站点不受影响。

**Q5:怎么手动还原 Caddyfile 的备份?**
备份文件都在 `/etc/caddy/` 下,名字是 `Caddyfile.bak-goldminer-<日期-时间>`(卸载时的备份叫 `Caddyfile.bak-goldminer-uninstall-<时间>`):

```bash
ls -l /etc/caddy/Caddyfile.bak-goldminer-*
sudo cp /etc/caddy/Caddyfile.bak-goldminer-<选最早的那个> /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

**Q6:端口 8790 被占用了怎么办?**
换一个没人用的端口重新部署,例如 `--port 8791`。注意不能用 22、80、443、2019、8787。
