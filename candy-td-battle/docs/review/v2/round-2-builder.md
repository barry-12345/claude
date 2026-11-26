# Builder 交付报告 — Round 2（Candy TD Battle V2 局部返工修复）

## 0. 快速索引
- **候选版本**：`v2-candy-td-battle` @ 待提交（将在本报告落盘后执行 `git commit`，最新 commit hash 以回传为准；基于 Round 1 `ef863853cecce03a261cf78228f8afc40302a031`）
- **本轮相对上轮变化**：针对 `docs/review/v2/round-1.md` 全部 2 项返工完成局部修复，改动模块：`public/css/style.css`、`public/js/ui.js`
  1. 修复锁定对手视角（`#stage[data-peeking="1"]`）下 `#peek-banner` 完全遮挡 `#incoming-express-banner` 的问题，并同步下移 `.toast-container`。
  2. 修复 `ui.js:showOpponentTowerCard` 未计算 `🔥 烈焰糖格`（`1.15×`）伤害加成的问题。
- **启动方式与 Tester 前置条件**：
  - 正常生产入口：`cd "G:\我的云端硬盘\游戏\candy-td-battle"` 后运行 `$env:PORT=4500; npm start`
  - 受控测试入口：`$env:PORT=4500; npm run start:test`，访问 `http://127.0.0.1:4500/?test=1`
  - 清理方式：`Ctrl+C` 停止自启 Node 进程，严禁使用 `pkill` / `killall`。
- **自测命令与证据索引**：
  - 一键测试命令：`npm test`（结果：**16/16 通过**）
  - 关键截图/日志路径：[`docs/review/v2/evidence/round-2/`](./evidence/round-2/)（`01-locked-opponent-healer-2a.png`、`02-locked-opponent-titan-2a.png`、`03-opponent-damage-buff-card.png`、`round2-metrics.json`）
- **环境未验证缺口**：无新增（同 Round 1）。

---

## 1. 修复详情

1. **【问题 1（必须）】锁定对手视角顶部横幅零重叠堆叠（`public/css/style.css`）**：
   - 将 `.express-banner` `z-index` 设为 `21`，并新增 `#stage[data-peeking="1"] .express-banner { top: 102px; }` 与 `#stage[data-peeking="1"] .toast-container { top: 146px; }`。
   - 当玩家处于锁定对手视角（`data-peeking="1"`）时，`#peek-banner` 稳居 `y: 64..94`，`#incoming-express-banner` 自动下移至 `y: 101.4..138.6`（含 `pulseSoft` 缩放动画），两者垂直保留 ~7.4px 间隙，实测 `boundingBox` 重叠面积严格为 **`0 px²`**。
2. **【问题 2（建议）】对手只读浮卡烈焰糖格伤害口径同步（`public/js/ui.js`）**：
   - 在 `showOpponentTowerCard(tower, pt)` 中新增 `const effDmg = Math.round(lvDef.damage * (tower.buffTile === 'damage' ? 1.15 : 1));`，使对手建于 `🔥 烈焰糖格` 上的塔（如柠檬 Lv.1 `68`）正确显示 `伤 78`（`68 × 1.15 = 78.2` 四舍五入）。

---

## 2. 验收项逐条自测结果（对应 Round 1 返工项 + 回归）

| 核验项 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **问题 1：锁定视角下 `2A` 来袭横幅 0 重叠** | Edge Headless PvP 双端实操（port `3102`） | `peekBox={y:64,h:30}`、`expressBox={y:101.44,h:37.11}`、`overlapPeekExpress1=0`、`overlapPeekExpress2=0`、`overlapToastPeek=0`，`💚 暗黑奶妈车 即将抵达！(2.7s)` 与排队状态清晰无遮挡 | `evidence/round-2/01-locked-opponent-healer-2a.png`, `02-locked-opponent-titan-2a.png`, `round2-metrics.json` |
| **问题 2：对手塔烈焰糖格伤害展示** | Edge Headless PvP 悬停实测 | 柠檬 Lv.1 建于 `(11,4)` `🔥 烈焰糖格`，对手锁定视角悬停显示 `射程 300 · 攻速 0.55/s · 伤 78` 与 `🔥 烈焰糖格` | `evidence/round-2/03-opponent-damage-buff-card.png`, `round2-metrics.json` |
| **全量自动化回归（含 `AC-15` 静态校验）** | `npm test` | **16/16 全部通过**（`sim-unit.test.js` 7/7 + `ws-protocol.test.js` 9/9，含 `style.css` / `ui.js` `Content-Length`/gzip 精确匹配） | `tests/sim-unit.test.js`, `tests/ws-protocol.test.js` |

---

## 3. 改动影响面与失效旧证据

- **修改的模块 / 文件**：
  - `public/css/style.css`（仅修改 `.express-banner` `z-index` 与新增 `#stage[data-peeking="1"] .express-banner` / `#stage[data-peeking="1"] .toast-container` 规则）
  - `public/js/ui.js`（仅修改 `showOpponentTowerCard` 内 `effDmg` 计算与输出）
- **触及的公共状态 / 存档 / 权限 / 契约 / 邻近流程**：
  - 不涉及后端仿真、WS 协议字段、地图配置、权限校验或存储契约；仅影响前端锁定对手视角（`#stage[data-peeking="1"]`）下的顶部横幅纵向定位与对手塔悬停只读卡片的伤害文本。
  - `style.css` 字节长度变化已通过 `AC-15` 自动化测试（`Content-Length` 与 gzip 校验）实时复核。
- **已失效的旧证据与建议复测范围**：
  - Round 1 中复现遮挡的 `docs/review/v2/evidence/round-1/tester-t03-peek-express-overlap.png` 已过期（已被 Round 2 `01-locked-opponent-healer-2a.png` / `02-locked-opponent-titan-2a.png` 替代）。
  - 建议 Reviewer / Tester 定点复测：锁定对手视角下接收 `R`/`T` 快递预警的 `boundingBox` 0 重叠、`🔥 烈焰糖格` 对手塔悬停伤害显示，以及非锁定视角下的 `2A` 预警与 `npm test` 16/16 回归。
