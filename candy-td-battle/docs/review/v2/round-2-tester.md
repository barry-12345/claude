# Tester 实测证据报告 — Round 2（Candy TD Battle V2 定点复测）

## 1. 运行环境与版本核对
- **实际测试版本**：分支 `v2-candy-td-battle` @ `5acbedc0fe60a88744bd2b9c26a6770354abb886`（与简报一致：是）
- **运行环境**：Windows 11 / Microsoft Edge Headless `158.0.4370.33`（Playwright 驱动，双独立 `BrowserContext`） / 视口 `1280×720`；端口：受控测试入口 `4503`（`CANDY_ALLOW_TEST_HOOKS=1`，Node PID `38172`，测毕已精准 `Stop-Process` 终止）
- **实际调用模型与档位**：`Gemini 4 Hydrogen (High)`（Tester 角色执行）

## 2. 用例执行总表
| 用例编号 | 对应返工项 | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| **T2-01** | Round 1 问题 1（必须）+ 邻近横幅回归 | 钩子 `http://127.0.0.1:4503/?test=1`（双 Context PvP `classic_s`） | 1. A/B 开 `classic_s` 房 `NA3K` 进 `PLAYING`，`grantResources` 给双方 `$3000`；<br>2. B 保持 `self` 视角，A 发 `R` 测非锁定回归并等清场；<br>3. B 按 `Space` 锁定 `opponent`（`data-peeking="1"`），A 发 `R` 测 `#peek-banner` 与 `#incoming-express-banner`；等清场；<br>4. B 保持锁定，A 发 `T` 测横幅；<br>5. `T` 显示期间 B 调 `jumpWave(16)` 并连按两次 `Q` 触发 Toast，测 4 元素两两重叠面积 | 通过 | 非锁定视角 `#incoming-express-banner`：`top=64px`（`y=63.62..100.38`），文案 `💚 暗黑奶妈车 即将抵达！(2.9s)`；<br>锁定视角+`R`：`#peek-banner`（`y=64..94`）与 `#incoming-express-banner`（`top=102px`，`y=101.66..138.34`）重叠面积 `0 px²`；<br>锁定视角+`T`：`#incoming-express-banner`（`top=102px`，`y=101.73..138.27`）文案 `🛡️ 终极铁王八 即将抵达！(2.9s)`，与 `#peek-banner` 重叠面积 `0 px²`；<br>并发栈 4 元素（`#peek-banner` `x=434.58..845.42, y=64..94`、`#incoming-express-banner` `x=521.86..758.12, y=101.28..138.72`、`#overtime-banner` `x=881.20..1168.00, y=64..93`、`.toast-item` `x=591.50..688.50, y=146..178`）6 对两两重叠面积均严格 `0 px²`；`0` console/page error | `docs/review/v2/evidence/round-2/tester-r2-locked-healer.png`, `docs/review/v2/evidence/round-2/tester-r2-locked-titan.png`, `docs/review/v2/evidence/round-2/tester-r2-banners-stack.png` |
| **T2-02** | Round 1 问题 2（建议） | 钩子 `http://127.0.0.1:4503/?test=1`（双 Context PvP `classic_s`） | 1. A/B 开 `classic_s` 房 `PS8N` 进 `PLAYING`，`grantResources` 给双方 `$3000`；<br>2. A 点击 `(11,4)` 像素中心 `(790,324)` 拆迁 `🍮 薄荷布丁簇`（`🔥 烈焰糖格`），按 `4` 在 `(11,4)` 建柠檬破甲狙 Lv.1；<br>3. B 按 `Space` 锁定 `opponent`，鼠标移至 `(790,324)` 悬停读取 `#opponent-tower-card` | 通过 | A 端拆迁预览 `解锁：🔥 烈焰糖格（伤害 ×1.15（+15% 最终伤害））`，建塔快照 `type="lemon", level=1, buffTile="damage"`；<br>B 端 `hoverOpponentTowerId=1`，`#opponent-tower-card` 可见（`x=808..1026, y=290..368.63`），实测完整文本：`柠檬破甲狙 Lv.1 / 只读 / 射程 300 · 攻速 0.55/s · 伤 78 / 索敌：血厚 · 🔥 烈焰糖格`；`0` console/page error | `docs/review/v2/evidence/round-2/tester-r2-opp-damage-buff.png` |

### 附：T2-01 实测 `boundingBox` 与重叠明细
- **非锁定视角回归（`data-peeking="0"`，`R` 奶妈车）**：
  - `#incoming-express-banner`：`x=524.03, y=63.62, width=231.93, height=36.75, right=755.96, bottom=100.38`（computed `top: 64px`, `zIndex: 21`），文案 `💚 暗黑奶妈车 即将抵达！(2.9s)`。
- **锁定对手视角 + `R` 奶妈车（`data-peeking="1"`）**：
  - `#peek-banner`：`x=434.58, y=64, width=410.84, height=30, right=845.42, bottom=94`（`top: 64px, zIndex: 20`）
  - `#incoming-express-banner`：`x=524.28, y=101.66, width=231.43, height=36.67, right=755.71, bottom=138.34`（`top: 102px, zIndex: 21`），文案 `💚 暗黑奶妈车 即将抵达！(2.9s)`
  - 交集：`overlapW=231.43, overlapH=0, area=0 px²`（垂直间距 `7.66px`）。
- **锁定对手视角 + `T` 铁王八（`data-peeking="1"`）**：
  - `#peek-banner`：`x=434.58, y=64, width=410.84, height=30, right=845.42, bottom=94`
  - `#incoming-express-banner`：`x=524.69, y=101.73, width=230.60, height=36.54, right=755.29, bottom=138.27`（`top: 102px, zIndex: 21`），文案 `🛡️ 终极铁王八 即将抵达！(2.9s)`
  - 交集：`overlapW=230.60, overlapH=0, area=0 px²`（垂直间距 `7.73px`）。
- **多横幅并发栈（`data-peeking="1"` + `T` + `W16` + Toast）**：
  - `#peek-banner`：`x=434.58, y=64, width=410.84, height=30, right=845.42, bottom=94`（`zIndex: 20`）
  - `#incoming-express-banner`：`x=521.86, y=101.28, width=236.26, height=37.44, right=758.12, bottom=138.72`（`top: 102px, zIndex: 21`），文案 `🛡️ 终极铁王八 即将抵达！(2.5s)`
  - `#overtime-banner`：`x=881.20, y=64, width=286.80, height=29, right=1168, bottom=93`（`top: 64px, right: 112px, zIndex: 14`），文案 `🌈 糖果狂热加时赛！第 16 波彩虹大军来袭！`
  - `.toast-item`：`x=591.50, y=146, width=97, height=32, right=688.50, bottom=178`（容器 `top: 146px`），文案 `技能冷却中`
  - 两两交集面积（共 6 对）：`peekBanner__expressBanner = 0 px²`、`peekBanner__overtimeBanner = 0 px²`（水平间距 `35.78px`）、`peekBanner__toastItem = 0 px²`、`expressBanner__overtimeBanner = 0 px²`、`expressBanner__toastItem = 0 px²`（垂直间距 `7.28px`）、`overtimeBanner__toastItem = 0 px²`。

## 3. 失败 / 异常详述（仅列失败与阻塞项）
无。

## 4. 客观体验观察（纯事实，非裁决）
- 在 `1280×720` 视口、`data-peeking="1"` 并发栈状态下，四项提示控件垂直/水平分层为：`#peek-banner`（`y=64..94`）与 `#overtime-banner`（`y=64..93`，水平相距 `35.78px`）居顶层，`#incoming-express-banner`（`y=101.28..138.72`）居中第二层，`.toast-item`（`y=146..178`）居中第三层，视觉上均无互相遮挡。

## 5. 未测项与止损记录
- 本轮为 Round 2 定点复测（仅覆盖简报指定的 `T2-01` 与 `T2-02`）；未涉及止损中止。
- 测试收尾已精确终止本次启动的 `4503` Node 进程（PID `38172`），并清理 `$env:TEMP` 下临时测试脚本与日志；未修改任何产品代码或既有测试代码。
