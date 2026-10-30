结论：FAIL（只有 1 个"必须"项，改动约 3 行；其余都是"建议"）

范围：只验服务端、部署脚本和独立的客户端模块（S-01–S-11、D-01–D-05、客户端 API 约定）。F-01–F-11 按要求推迟，没有测，也没有改动 index.html、tests/、screenshots/。

达标项：
- **复跑测试**：`cd server && npm test`，**52/52 通过**，0 跳过，耗时 10.8 秒（Node 22.22）。
- **代码审查**：通读了 server/src 全部 6 个文件、admin.js、scripts/backup.js、迁移、客户端模块、两个脚本和三个模板。
  - SQL 全部参数化，没有拼接用户输入；
  - 入榜事务用 `BEGIN IMMEDIATE`（`.immediate()`），"数名次 → 写入 → 裁剪到 100"在同一把写锁内完成；
  - 500 响应只返回 `{"error":"internal"}`，堆栈只写 stderr；
  - 静态目录（只在开发时用）先 decode 再 resolve，并检查前缀；
  - 管理密码用 sha256 后 `timingSafeEqual` 比较，长度不会泄露；密码为空时接口返回 404。
- **我自己的探针**（用产品代码起独立实例，临时数据库）：

  | 检查项 | 结果 |
  |---|---|
  | **S-05 多进程并发** | 6 个独立进程各直接调用 `submit` 60 次，同时 80 个 HTTP 请求（不同 X-Real-IP），共 440 次尝试：成功数 84 = 表中行数 84，id 不重复；最终前 20 = 全部尝试中最高的 20 个；无报错 |
  | **S-03 同分边界** | 19 条 1000 加 1 条 500 时，提交 1000 → 第 20 名，挤掉 500；再提交 1000 → `not_qualified`，`cutoff=1000`；榜不满时提交 0 分 → 第 1 名 |
  | **S-06** | 递增插入 150 条 → 恰好 100 行（510…1500），另一模式 7 行不变；同分按 `created_at` 排序 |
  | **名字："12 个字符" = 12 个 Unicode 码点（≠ UTF-16 单元）** | 12 个汉字 ✓；13 个汉字 → `bad_name`；12 个 😀（24 个 UTF-16 单元）✓；13 个 → `bad_name`；6 面国旗（12 码点）✓；肤色 👍🏽 ✓；含 ZWJ 的家庭 emoji、RLO（U+202E）、Tab → `bad_name`；NFD 的 é×12 规范化后存储；全角空格、NBSP 合并为一个空格；"f u c k" 和全角 "ＦＵＣＫ" → `bad_word`；`<script>…`、`'; DROP TABL` 原样存储，表依然存在 |
  | **畸形 / 超大 / 慢请求** | 非 JSON、null、数组 → 400 `bad_json`；text/plain → 415；`Application/JSON; charset=UTF-8` 正常接受；Content-Length 3000 → 413；chunked 3000 字节 → 413；body 写一半停住 → 408（约 30 秒后，见建议 6）；header 写一半停住 → 408；404/405 都是 JSON |
  | **500 不泄露** | 用另一个连接持有写锁超过 busy_timeout → 500 `{"ok":false,"error":"internal"}`，Content-Type 正确，响应里没有堆栈（堆栈只在 stderr） |
  | **S-09 备份与恢复** | 一边持续写入一边跑 `backup.js`：退出码 0，`integrity_check=ok`，行数 ≥ 开始时；`OFFSITE_CMD` 失败只打印警告。然后按 DEPLOY.md 第 9 节恢复（停服务 → 留副本 → 删 -wal/-shm → 复制备份 → 启动）：45 行恢复为备份时的 30 行，之后能正常写入 |
  | **D-01** | `bash -n` 和 `shellcheck -S warning` 对两个脚本都零问题 |
  | **D-02** | `--dry-run` 退出码 0，11 步按顺序列出；缺参数 → 中文用法，退出码 2；`--domain 'x;rm -rf /'` 被正则拒绝；email 只以带引号的参数传给 certbot，sed 只替换已校验的域名，引号处理是安全的 |
  | **D-03 / D-04** | 渲染后的 nginx 配置 `nginx -t` 通过（本沙箱没有 IPv6，需要去掉 `listen [::]:80`，见建议 4）；`systemd-analyze verify` 通过 |

- **部署实跑**：本沙箱就是 Ubuntu 24.04。我从项目副本真实运行 deploy.sh，只把 apt-get、systemctl、certbot、ufw、curl 换成记录调用的桩，其余全部真实执行：useradd、rsync、`npm ci`、env 文件、包装器、nginx 配置和 `nginx -t`、cron。服务用真实的 node 以 goldminer 用户启动，nginx 也真实启动。
  - **证书失败（模拟 DNS 未生效）**：在第 8 步退出 1，打印中文原因和"修好后重跑"；服务和 nginx 已就绪，ufw 还没启用（不会把人锁在外面）。
  - **幂等**：重跑时 env 文件和管理员密码不变，certbot 接管的站点配置保留，cron 不覆盖；三份配置文件的 md5 不变，已有成绩保留。
  - **`update.sh`**：rsync 删掉了多余文件，但保留 node_modules 和 `/var/lib/goldminer` 里的数据库；健康检查通过。
  - **权限**：`/etc/goldminer.env` 是 600 root:root；数据和备份目录是 750 goldminer；`goldminer-admin` 用 `runuser` 以 goldminer 身份运行，-wal/-shm 文件不会变成 root 所有（不会把服务锁死）。
  - **经过真实 nginx**：客户端伪造的 `X-Real-IP` 被 nginx 覆盖，同一客户端第 6 次 POST 返回 429；5 KB 请求体被 nginx 以 413 挡住；`/` 返回 `Cache-Control: no-cache`。
  - 测完后已清理沙箱里的所有部署产物（用户、/etc、/opt、/var 下的文件，以及 nginx default 站点的恢复）。
- **`deploy/` 的位置**：脚本用 `REPO_DIR = deploy/..` 定位 index.html 和 server/，DEPLOY.md 里的命令也一致（`cd /root/gold-miner/deploy`）。放在仓库根目录比规格写的 `server/deploy/` 更合理（脚本需要同级的 index.html）。**不影响使用**，只需要同步规格里的路径。
- **DEPLOY.md**：11 个章节齐全，命令可以直接复制。按非专业中文用户的角度读：
  - 购买 VPS、安全组、DNS 验证（ping/nslookup 及"没生效就不要往下做"）、SSH 登录、scp 传文件、一键部署、保存密码、itdog.cn 的看法和不通时怎么办、更新、备份恢复（包括删 -wal/-shm 这一关键步骤）、管理命令和接口示例、FAQ 都写得具体清楚。
  - 缺的几处列在建议 2、3、7。

返工项：

【问题 1（必须）：管理接口"认证失败限流"可以被绕过，挡不住暴力破解】
- 现象和证据：`ADMIN_PASSWORD=correct-horse`，同一 IP 连续发 14 次错误密码，返回 `401×10, 429×4`。紧接着发正确密码 → **200**，数据可读。原因在 `server.js` 第 154–158 行：先比较密码，只有比较失败时才去查限流器。所以处于"429 状态"的 IP 仍然在被逐个验证密码：猜错得到 429，猜对得到 200，攻击者可以无限制地继续猜。
- 为什么是问题：§2.5 限流的目的就是防暴力破解，现在只是把 401 换成了 429。部署默认生成的 24 位随机密码本身很难猜，但 DEPLOY.md 第 10 节教用户"修改管理员密码"为自己想要的值。一旦用户改成弱密码，排行榜数据就可能被任意删除或清空。
- 修改方向：在比较密码**之前**，先看这个 IP 是否已经处于失败限流状态。如果是，直接返回 429，不再比较密码（正确密码也一样）。只有比较失败才给计数加一。限流器需要一个"只查看、不计数"的方法（例如 `peek(key)`），或者等价的实现。管理接口成功访问时不计数。
- 验收标准：同一 IP 连续 10 次错误后，**正确密码**在 60 秒内也返回 429；注入时钟前进 61 秒后，正确密码返回 200。S-08 原有用例全部仍然通过。新增一个 node:test 用例覆盖"限流期间正确密码也是 429"。

以下是"建议"项，不影响本轮结论，但部署前最好处理（都很小）：

【建议 2：apt 锁导致首次部署失败】
- 新开的 Ubuntu VPS 开机后几分钟内，unattended-upgrades 常常占着 dpkg 锁。`apt-get update/install` 会立刻报 "Could not get lock" 并退出，非专业用户会以为脚本坏了。
- 方向：所有 apt-get 调用加 `-o DPkg::Lock::Timeout=600`（Ubuntu 22.04/24.04 的 apt 都支持）；DEPLOY.md 第 11 节加一条 FAQ"提示 Could not get lock：等几分钟再运行"。
- 验收：dry-run 输出里的 apt 命令带上这个选项。

【建议 3：ufw 只放行 OpenSSH（22 端口），SSH 不在 22 时会把用户锁在外面】
- 腾讯云和阿里云默认是 22，但有些香港 VPS 商家默认使用别的 SSH 端口。`ufw --force enable` 之后用户就连不上了，网页版 SSH 终端也会被挡（只剩 VNC 能进）。
- 方向：启用 ufw 前，检测 sshd 实际监听的端口（如 `sshd -T | awk '/^port /{print $2}'` 或 `ss -tlnp`），逐个 `ufw allow <端口>/tcp`。
- 验收：在 sshd_config 设为 `Port 2222` 的环境里 dry-run，输出包含 `ufw allow 2222/tcp`。

【建议 4：两个"环境差异"会让部署中途失败】
- (a) **Node 路径**：`node_ok` 用 `command -v node` 判断。如果机器上已经有 Node 22，但不在 /usr/bin（nvm、tarball、云厂商的 Node 镜像），就会跳过 NodeSource。而 systemd 单元、cron 和 goldminer-admin 都写死了 `/usr/bin/node`，服务启动会报 203/EXEC。本沙箱的 node 在 /opt/node22，实跑时正好复现了这个问题。
  - 方向：`node_ok` 改为检查 `/usr/bin/node` 的版本；或者把 `$(command -v node)` 写进单元、cron 和包装器。
- (b) **IPv6**：模板里的 `listen [::]:80` 在关闭了 IPv6 的机器上会让 `nginx -t` 失败（本沙箱实测："Address family not supported"）。
  - 方向：只有 `/proc/net/if_inet6` 存在时才保留这一行。
- 验收：在"node 不在 /usr/bin"和"没有 IPv6"两种环境下，deploy.sh 都能完成到 health 自检。

【建议 5：限流器在 IP 很多时每个请求都要扫一遍全表，键数也没有上限】
- 实测：20 万个不同 IP 时，内存增加 53 MB，每次请求的耗时升到 **3.15 ms**。原因是键数 ≥ 10,000 后，`_sweep` 每次请求都遍历整个 Map，整体是平方级的。
- 只发 A 记录（只有 IPv4）、个人游戏的流量下基本不会触发，风险低。
- 方向：清扫最多每 N 秒一次（不因为键数多就每次都扫）；再加一个总键数上限（满了就淘汰最旧的键，或直接拒绝新键）。
- 验收：20 万个键时，单次请求 < 0.1 ms，内存不超过设定的上限。

【建议 6：慢请求实际要 30 秒才断开】
- `requestTimeout=10s`，但 Node 默认每 30 秒才检查一次超时，实测 header 或 body 停住后约 30 秒才收到 408。生产环境前面有 nginx 缓冲请求体，影响很小。
- 方向（一行修改）：`createServer` 时传 `{ connectionsCheckingInterval: 2000 }`。

【建议 7：客户端集成说明还缺两点，下一个 Builder 容易做错】
- (a) **规则 1 的成绩不应提交**：目前只在 INTEGRATION.md 第 3.1 节有一句文字说明；`lbSubmit`、`lbQualifies` 本身不检查版本，服务端也接受 1–1000（见"规格层面"）。
  - 方向：在模块里加 `LB_ACCEPT_VERSION = 2`。`lbSubmit` 遇到其它版本时直接 resolve `{ok:false, error:'bad_version'}`；新增一个 `lbShouldOffer(mode, version, score)`，让集成方只调用一个函数。
- (b) **手机键盘**：没有说明。iOS Safari 在非用户手势里调用 `focus()` 不会弹出键盘，而终局页是在 fetch 之后才弹窗口的，所以要提示"点输入框输入"，或者让"提交"按钮先获得点击。另外：键盘弹出后要用 `visualViewport` 或 `scrollIntoView` 让窗口保持可见；input 建议加 `enterkeyhint="done"`、`autocomplete="off"`、`autocapitalize="off"`；窗口打开期间触摸控制层要让路（这一点已经写了）。
  - 方向：在 INTEGRATION.md 第 3.2 节加一个"手机"小节。
- 验收：INTEGRATION.md 写明上述要点；模块的 node:test 增加"version 1 不发请求"的用例。
- 离线行为已经覆盖：网络错误、超时、5xx、HTML 返回、file:// 都解析为 `unavailable`；文档要求提供"重试"按钮。

规格层面的问题（需要用户或规划方决定）：
- **版本口径矛盾**：SPEC-phase2 §8 说"第三阶段只接受 `version === 2` 的成绩，这一点由第三阶段实现"，而 SPEC-phase3 §2.4 规定服务端接受 version 1–1000，S-02 只测了 0。目前只能靠前端自觉不提交。
  - 建议由服务端兜底：增加环境变量 `ACCEPT_VERSIONS`（默认 `2`），其它版本返回 400 `bad_version`。以后规则升到 3 时只改环境变量，配合 `admin archive --version 2` 使用。
  - 这需要改规格 §2.4，并新增一条 S-02 用例。
- **路径**：规格 §1 写的是 `server/deploy/` 和 `server/DEPLOY.md`，实际是仓库根目录的 `deploy/` 和 `deploy/DEPLOY.md`。脚本和文档内部是自洽的，建议把规格改成实际路径。
- **名字长度的含义**：规格按码点算 12 个。结果是：12 个 emoji 可以；肤色 emoji 每个占 2；含 ZWJ 的组合 emoji（如家庭、彩虹旗）被当作零宽字符拒绝。这符合规格，只是让用户知道有这个口径。

给用户的摘要：
排行榜服务端和部署脚本整体质量很好。52 个自动测试全部通过；我自己又做了多进程并发写入、前 20 名同分边界、中文和 emoji 名字、超大和半截请求、边写边备份再恢复，全部正确。我还在一台 Ubuntu 24.04 环境里真实跑了部署脚本（只把装软件、申请证书、防火墙这几步换成模拟）：重复运行不会弄丢数据和密码，更新不会覆盖数据库，证书申请失败时提示清楚、改好后重跑即可。部署指南按非专业用户的角度读，步骤具体可照做。

这一轮判为不通过，只因为一个安全小漏洞：管理员密码输错 10 次后，系统只是换了个返回码，仍然在继续验证密码，挡不住暴力猜测（改大约 3 行就能修好）。

另外建议顺手修几处部署小坑：新服务器开机时 apt 被占用、SSH 不在 22 端口时防火墙可能把你锁在外面、服务器上已有 Node 时路径不对、服务器没有 IPv6 时 nginx 报错。最后有一个需要你确认的问题：服务器要不要只接受新规则（版本 2）的成绩。
