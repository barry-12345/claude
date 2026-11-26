# 待同步至 Notion 版本页（Personal / Quick Notes）

- **目标数据库**：`Personal / Quick Notes` (`collection://a614af7c-e2a8-4254-b53c-19d867818da`)
- **标题**：`糖果塔防对战 · V1 规格与状态`（图标 `🍬`，类型 `项目`，日期 `2026-11-25`）
- **未同步原因**：2026-11-25 调用 `notion-create-pages` 时遇到当前客户端 `call_mcp_tool` 嵌套对象参数序列化错误（`pages.0` / `parent` 被序列化异常），暂存于此待修复或人工/另一客户端同步。

---

## 基本信息与 SSOT
- **版本与状态**：`V1` ｜ 已获用户批准（`2026-11-25`）｜ 开发模式：单 Builder 顺序实现
- **SSOT 约定**：本 Notion 页为主本（待同步落库）；仓库执行副本为 `g:\我的云端硬盘\游戏\candy-td-battle\docs\SPEC.md`
- **已确认决策（1A · 2A · 3A · 4A）**：
  - **假动作心理战**：`$65` / `+5 Eco` / `18s` 冷却，3s 预警外观声效与真快递一致（且 WS 对防守方零泄密），开箱彩带 `0` 伤害
  - **对局节奏**：`15` 波主线（约 5.5–6.5 分钟）+ 第 `16` 波起狂暴彩虹糖加时赛
  - **视听与偷看**：默认开启 Web Audio 合成音（右上角一键静音）；右侧专属热区悬停（`60px` 安全隔离带）+ 按住 `Space` 双通道偷看对手（260ms 平滑推拉，偷看态禁建己方塔）
  - **归档与托管**：Notion 归档至 `Personal / Quick Notes`；本地初始化 Git 仓库并做规范提交（V1 不做腾讯云部署与远端 GitHub 推送）
- **模型分工（用户指定）**：
  - Planner：`pbr-planner` (`pro`)
  - Builder：`swarm` worker `builder` (`gemini-4-hydrogen-high`)
  - Reviewer：`swarm` worker `reviewer` (`gemini-4-neon-high`)
  - Tester：`swarm` worker `tester` (`gemini-4-hydrogen-high`)

## 版本追踪表
| 版本 | 任务类型 | 实际调用模型与档位 | 测试范围 | 可见用量 | 测试次数 | 返工轮数 | 已发现漏检 | 验收结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | 大任务（新游戏开发） | Planner `pro` / Builder `gemini-4-hydrogen-high` / Reviewer `gemini-4-neon-high` / Tester `gemini-4-hydrogen-high` | AC-01 ~ AC-14 | 账号级余量 94%（无法分摊） | 2（Round 1 Fast-Fail；Round 2 全量代码审 + 12/12 单测 + 双端 Edge CDP 7/7 场景实测） | 1 | Round 1 检出 5 项必修缺陷，Round 2 全部根因修复，漏检 0 | **PASS**（候选版本 `v1-candy-td-battle @ 7c8a7aa`，交付本地试玩） |
| V1.1 | 中任务（启动传输稳定性与大厅建连反馈修复） | Builder `gemini-4-hydrogen-medium` / Reviewer `gemini-4-carbon-high` / Tester `gemini-4-hydrogen-medium` | AC-15 ~ AC-18 + 关联回归（AC-01/10/11/14） | 账号级余量 96%（无法分摊） | 2（Round 1 代码审+15/15 单测+Edge 4 场景；Round 2 定点复测 3/3 通过+15/15 单测） | 1 | Round 1 检出 2 项必修界面缺陷与 1 项建议，Round 2 全部根因修复，漏检 0 | **PASS**（候选版本 `v1-candy-td-battle @ cb5e2f1`，本地验收通过，待请示推送与部署） |

## V1.1 规格摘要（2026-11-26 已获用户批准）
- **变更原因**：线上 `http://43.143.38.16:8080/candytd/` 在代理下复现 `net::ERR_INCOMPLETE_CHUNKED_ENCODING` 截断脚本导致大厅所有按钮无响应，且前端存在 WS 建连失败静默无反馈、`CONNECTING` 态并发调用丢消息及 `CandyAudio` 读取 `sessionStorage` 无容错问题。
- **核心改动**：`server/index.js`（静态文件显式 `Content-Length` + gzip 预压缩定长）、`public/js/net-client.js`（复用 `_connectPromise` 等 `OPEN` + `6000ms` 超时 + 可重试）、`public/js/main.js` & `public/js/ui.js`（连接中禁用态 + 失败中文 Toast + `file://` 提示）、`public/js/audio.js`（`sessionStorage` 容错）、`tests/ws-protocol.test.js`（AC-15 ~ AC-18 回归）。
- **外部高风险动作**：V1.1 不自动执行 GitHub `git push` 或腾讯云 `43.143.38.16` 部署，验收 `PASS` 后另行请示用户确认。
- **再次尝试写入 Notion 结果（2026-11-26）**：再次实测调用 `notion-create-pages`，仍触发客户端 `call_mcp_tool` 嵌套对象序列化缺陷（`pages.0` / `parent` 被序列化为 `null`），待后续客户端修复或人工/支持嵌套 MCP 的客户端同步。

## 评审结论摘要
- **Round 1（2026-11-25）**：`FAIL`（Fast-Fail）— 检出双端特效串屏/P2 激光失效、假动作气泡错位、偷看浮卡重弹、热区边缘卡死、退房/倒计时重连缺陷及胜负音效未触发。
- **Round 2（2026-11-25）**：`PASS` — 全量回归与双端 Edge CDP（DPR=2）7 大场景实测全通过（12/12 单测、0 报错、56–60 FPS，渲染 0.4–0.8ms），交付用户本地试玩，待用户确认后再另行安排 GitHub 推送或云端部署。
