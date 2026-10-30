# 黄金矿工（HTML5）

浏览器里玩的黄金矿工，整个游戏就是一个文件 `index.html`，不需要安装，也不需要服务器。

- **电脑**：单人、双人对战、双人合作三种模式，用键盘操作。P1 用 `S` 出钩、`W` 用炸药；P2 用 `↓` 出钩、`↑` 用炸药；`P` 暂停，`V` 减少特效，`M` 静音。
- **手机 / 平板**：只有单人模式，横屏游玩，点屏幕出钩，屏幕上有炸药和暂停按钮。

## 怎么玩

- **本地**：下载 `index.html`，用浏览器打开。
- **在线（GitHub Pages）**：仓库 Settings → Pages，Source 选 "Deploy from a branch"，分支选本分支，目录选 `/ (root)`。生效后网址是 `https://<用户名>.github.io/<仓库名>/gold-miner/`。

## 目录

| 路径 | 内容 |
|---|---|
| `index.html` | 游戏本体 |
| `server/` | 排行榜服务器（Node.js + SQLite）。**暂未接入游戏，也未上线** |
| `deploy/` | 部署到云服务器的脚本，以及中文部署说明 `DEPLOY.md`（排行榜上线时用） |
| `tests/` | 自动测试（Playwright）：`node tests/run-all.js smoke` 是约 40 秒的快速检查，`node tests/run-all.js` 是完整测试 |
| `SPEC*.md`、`PLAN*.md` | 各阶段的设计和规格 |
| `review/` | 各阶段的开发和验收报告 |
