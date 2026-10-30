结论：PASS

范围：第三阶段服务端、部署、客户端模块的第 2 轮。先逐项复测第 1 轮的必须项 1 和建议 2–7，再做全量回归（`npm test`、第 1 轮的全部探针、部署实跑），最后清理现场。F-01–F-11 仍然推迟。`ACCEPT_VERSIONS` 在等用户决定，不算返工项。我没有改动 index.html、tests/、screenshots/、server/、deploy/，测试前后 md5 完全一致。

达标项：
- **复跑测试**：`npm test` **60/60 通过**（第 1 轮是 52 个），0 跳过，22 秒；`shellcheck -S warning` 和 `bash -n` 对两个脚本都零问题。
- **改动范围**：对比第 1 轮的副本：
  - validate / db / admin-ops / config / backup / admin.js **一行没动**；
  - server.js 只改了两处：管理接口先 peek 限流、创建 server 时加 `connectionsCheckingInterval: 2000`；
  - ratelimit.js 重写；deploy.sh、update.sh 按建议改动；客户端加了版本守卫。

**第 1 轮返工项逐项复测：**

| 项 | 第 1 轮 | 本轮实测 | 结论 |
|---|---|---|---|
| **1（必须）管理密码暴力破解** | 错 10 次后，正确密码仍然返回 200 | 同一个探针：14 次错误 → `401×10, 429×4`；**限流期间正确密码 → 429**；空的或格式错误的 Bearer 也是 429；没设密码 → 404。代码改为先 `peek`（被锁的 IP 根本不比较密码），只有失败才 `record`。Builder 的新用例覆盖了 +30 秒仍是 429、+61 秒恢复 200、其它 IP 不受影响 | ✅ 已修复 |
| 2 apt 锁 | 立刻失败 | 所有 apt-get 调用都带 `-o DPkg::Lock::Timeout=600`；实跑时真实 apt 接受这个选项。DEPLOY.md 新增 Q1b，中文说明"等 5–10 分钟再运行，不要手动删锁文件" | ✅ |
| 3 ufw 与 SSH 端口 | 只放行 OpenSSH | 实跑时用桩 sshd 输出 `port 2222` 和 `port 22` → `ufw allow OpenSSH`、`allow 22/tcp`、`allow 2222/tcp` 都在 `--force enable` **之前**执行；sshd 不可用时回退到 `ss`，再不行就用 22 | ✅ |
| 4a Node 不在 /usr/bin | 服务报 203/EXEC | 本沙箱 node 在 /opt/node22（这次**没有**建 /usr/bin/node 的软链接）：脚本打印"服务将使用 Node: /opt/node22/bin/node"，systemd 单元、cron、goldminer-admin 都写入这个路径，服务真实启动，health 正常；update.sh 沿用已安装单元里的路径。装在 /root、/home 下的 node 会被拒绝，转而装 NodeSource（因为 ProtectHome 下访问不到，这样做是对的） | ✅ |
| 4b 没有 IPv6 | `nginx -t` 失败 | 本沙箱没有 /proc/net/if_inet6，这次**不改模板**直接跑：打印"本机没有 IPv6,已去掉 listen [::]:80"，`nginx -t` 通过，nginx 真实启动 | ✅ |
| 5 限流器扩展性 | 20 万个 IP 时每个请求 3.15 ms，键数无上限 | 同一个探针：键数封顶 **50,000**，每个请求 **0.05 ms**，20 万次插入共 3.7 秒（第 1 轮是 338 秒）；清扫最多每 30 秒一次 | ✅ |
| 6 慢请求 | 约 30 秒才断开 | header 停住 → 408 @ **10.0 秒**；body 停住 → 408 @ 12.0 秒 | ✅ |
| 7a 客户端版本守卫 | 只靠文档说明 | `LB_ACCEPT_VERSION = 2`。我在 Node 里实测：`lbSubmit({version:1})` → `{ok:false,error:'bad_version'}`，**没有发请求**；version 2 正常提交；`lbShouldOffer` 在 v1、或者从未取到榜单时为 false，v2 且能上榜时为 true | ✅ |
| 7b 手机键盘说明 | 缺 | INTEGRATION.md 新增"手机 / mobile"小节：iOS 非手势 `focus()` 不弹键盘及两种对策、`visualViewport` 加 `scrollIntoView`、`enterkeyhint/autocomplete/autocapitalize/autocorrect/spellcheck`、触摸层让路、用 `lbShouldOffer` 统一判断 | ✅ |

**全量回归**（第 1 轮的探针原样再跑一遍）：
- **S-05 多进程并发**：6 个进程加 HTTP 共 440 次尝试 → 成功 86 = 行数 86，id 不重复，前 20 = 全部尝试中最高的 20 个，无报错。
- **S-03 同分边界**：19 条 1000 加 1 条 500 时，提交 1000 → 第 20 名；再提交 1000 → `not_qualified`，`cutoff=1000`；空榜提交 0 分 → 第 1 名。
- **名字和畸形请求**：结果和第 1 轮一致（12 个码点、emoji、ZWJ/RLO 拒绝、敏感词变体、413/415/400）。
- **500 不泄露**：持有写锁超过 busy_timeout → 500 `{"error":"internal"}`，响应里没有堆栈。
- **备份与恢复**：边写边备份，`integrity_check=ok`；按 DEPLOY.md 恢复：45 行恢复为 30 行，之后能正常写入。
- **部署实跑**（Ubuntu 24.04 沙箱；只把 systemctl、certbot、ufw、curl 换成桩，apt-get、useradd、rsync、`npm ci`、nginx、`nginx -t`、runuser 都是真实执行）：
  - 证书失败（模拟 DNS 未生效）→ 在第 8 步以中文提示退出，服务和 nginx 已就绪；
  - 修好后重跑 → "部署成功!"，health 正常；
  - 第三次重跑 → env 文件、站点、cron、systemd 单元四个文件的 md5 不变，已有成绩保留；
  - `update.sh`：删掉多余文件，保留 node_modules、数据库和 Node 路径，health 正常；`update.sh --dry-run` 退出码 0（Builder 修了 pipefail 的 bug）；
  - `goldminer-admin list` 正常；`clear` 不带 `--yes` → 拒绝；数据文件仍归 goldminer 所有；`/etc/goldminer.env` 是 600 root；
  - 经过真实 nginx：伪造的 X-Real-IP 被覆盖，第 6 次 POST 返回 429；
  - 以 goldminer 身份手动备份：7 行，`integrity_check=ok`。
  - 测完后已清理沙箱：用户、/etc、/opt、/var、/usr/local/bin 下的产物全部删除，nginx default 站点已恢复。

返工项：无。

小提示（不算返工，供以后参考）：
- deploy.sh 重跑时，只要 `/etc/cron.d/goldminer-backup` 已经存在就整体保留（为了不覆盖用户加的 OFFSITE_CMD）。如果以后 Node 路径变了（例如从自带的 node 换成 NodeSource），cron 里的旧路径不会更新，备份会悄悄失败。可以以后只替换 node 路径那一个字段，或者在部署结束时检查一下 cron 里的 node 路径是否存在。
- LRU 淘汰会让被淘汰 IP 的计数清零（Builder 已说明）。键数上限是 5 万，正常流量下不会触发。

规格层面的问题：
- **`ACCEPT_VERSIONS`（服务端只收版本 2 的成绩）**：仍在等用户决定。目前客户端已经有守卫（`LB_ACCEPT_VERSION`），服务端仍然接受 1–1000。
- **手机名字输入框的 `maxlength` 有冲突**：SPEC-touch §11 要求 `<input maxlength=12>`，而 INTEGRATION.md §3.2 写"不要设 maxlength（会和输入法冲突）"，改为在 input 事件里按码点截断。后者更稳：maxlength 按 UTF-16 单元计算，会截断输入法拼写中的字，也会把 12 个 emoji 截成 6 个。建议在做前端集成前，把 SPEC-touch §11 改成"不设 maxlength，用 `lbClampName` 截断"。

给用户的摘要：
排行榜服务端第 2 轮验收**通过**。上一轮的安全问题（管理员密码可以被反复猜测）已经修好：连续输错 10 次后，即使输入正确的密码也要等 1 分钟。上一轮提的 6 条部署和体验建议也全部做了，我逐条实测确认有效：
- 新服务器开机时 apt 被占用会自动等待；
- SSH 不在 22 端口时防火墙也会放行，不会把你锁在外面；
- 服务器上已有 Node 时会用对路径；
- 没有 IPv6 的服务器 nginx 也能正常启动；
- 限流器在大量访问下不再变慢；
- 前端不会提交旧规则的成绩，手机输入名字的注意事项也写进了说明。

我在 Ubuntu 24.04 上把部署脚本完整真实跑了三遍，再跑一遍更新，数据、密码、配置都没有被覆盖。
