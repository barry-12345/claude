# 《Court 2K：大满贯时代》V2 正式规格说明书（SPEC）

- **单一事实源（SSOT）归属**：Obsidian 为主本（`G:\我的云端硬盘\Barry's obsidian\99_System\Data\Quick_Notes\Notes\Court 2K：大满贯时代 · V2 规划与版本页.md`），本文件 `tennis-2k/docs/SPEC.md` 为仓库执行副本。
- **审批状态**：已获用户批准开工 · `2026-11-27`（「可以开始」，决策项 1A / 2A、增量假设 C-01~C-03 及预授权全部确认生效；Round 2 契约闭环修订版）
- **版本号**：`V2`
- **仓库与分支**：`g:\我的云端硬盘\游戏\claude` · 分支 `feat/tennis-2k-v2`（基点 `ee66efd5f59e8cd6e248c78ad9507be6e52bf576`，同步自 `origin/feat/tennis-2k` V1 整合 PASS）· 项目目录 `tennis-2k/`
- **配套契约**：跨工作包接口、协议与 Blender `.glb` 资产规范以同目录 [`docs/CONTRACT.md`](./CONTRACT.md) 为准。
- **批准范围**：
  1. 彻底移除击球进度条（2K 绿条）与火热槽（Takeover），全栈零残留；
  2. 自动最佳触球时机 + 铁律“不按击球键允许落空”（短按 `<0.20 s` 给 `0.35 s` 缓冲、长按 `≥0.20 s` 松手立即取消），基于跑位到位度的 `CLEAN / SOLID / STRETCH` 质量模型；
  3. 极简前后左右操控（`J` 打后强力深球、`K` 默认打前放小球/短切削、`W+K` 贴网小球、`S+K` 中场防守削球、`L` 挑高球、`A`/`D` 左右瞄准）与无进度条一键分级发球（`J` 强力一发 + `K` 100% 进区旋转发球）；
  4. 四流派 400 分均衡（`TIM` → `CTL` 控球）与 3 档 V2 AI 校准；
  5. 本机 **Blender 5.2.3 LTS** 脚本化生成 *Mario Tennis / Nintendo Switch Sports* 风格化一体化平滑蒙皮 `.glb` 角色（含 21 骨骨架、8 段 NLA 动画、3 款流派头饰、双护腕与球拍）并通过 `PlayerAvatarController` 接入；
  6. 3 块大满贯球场明亮日场转播光照与天空穹顶视觉升级 + V1 两处遗留微瑕修复（超级抢十横幅文案、`waiting` 房刷新保持大厅）；
  7. 全量保留并兼容 V1 三场地物理差异、Fast4/超级抢十双赛制、轻量 3D 鹰眼特写、Web Audio 合成音效、1v1 60Hz 权威联机 + 双方近端镜像 + 手动暂停 + 4s 断线重连防按键失灵 + 15s 弃权 + Rematch + DPR/高刷限帧 + `?netdebug=1` + `?test=1` + `VITE_BASE_PATH` 子路径兼容。
- **红线约束**：本阶段仅做本地开发与独立验收；**绝不修改 `main` / `gold-miner`，绝不执行 `git push`，绝不触碰上海服务器**。

---

## 一、定位、交付形式与已批准技术选型

### 1.1 产品定位
打造去掉繁琐进度条与火热槽负担、聚焦**「跑位 + 打前/打后 + 打左/打右」**纯粹网球战术博弈，同时具备 *Mario Tennis / Nintendo Switch Sports* 风格化 3D 运动角色颜值与明亮大满贯日场转播观感的电脑浏览器 1v1 3D 网球游戏。

### 1.2 目录结构与交付形态
延续单仓库 npm workspaces（`tennis-2k/`），新增 `assets/source/` 存放 Blender 5.2 生成脚本与清单，静态导出 `.glb` 至 `client/public/assets/models/tennis_player.glb`：

```text
tennis-2k/
├─ package.json                # npm workspaces 根配置（零新增第三方 npm 依赖）
├─ tsconfig.base.json          # 严格 TypeScript 基础配置
├─ docs/
│  ├─ PLAN.md                  # V2 规划副本
│  ├─ SPEC.md                  # 本文件（V2 已批准定稿规格）
│  ├─ CONTRACT.md              # V2 跨工作包接口、WS 协议与 Blender 资产契约
│  └─ review/                  # 各工作包（wp1/wp-asset/wp2/wp3/integration）评审报告与证据
├─ assets/
│  └─ source/
│     ├─ generate_player_avatar.py # Blender 5.2.3 LTS 无头可复现角色建模/绑骨/8段动画/导出脚本
│     └─ README.md                 # 一键复现命令与骨骼/材质/节点/动画清单
├─ shared/                     # @court2k/shared：零依赖纯 TS 物理、V2 自动触球状态机、AI、镜像与协议
├─ client/                     # @court2k/client：Vite + TS + Three.js（GLTFLoader/SkeletonUtils）、明亮球场与 V2 HUD
│  └─ public/assets/models/tennis_player.glb
└─ server/                     # @court2k/server：Node + TS + ws 60Hz 权威联机服务
```

### 1.3 已批准技术选型
1. **共享内核（`@court2k/shared`）**：纯 TypeScript 零运行时外部依赖，单机与联机 100% 复用同一套 60Hz 确定性物理、自动触球状态机、发球、规则与 AI。
2. **Blender 5.2 资产管线（`WP-Asset`）**：本机 `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`（已实测 `Blender 5.2.3 LTS`、`GLTF_READY: True`）无头脚本生成单一共享基础 `.glb`（原始 `≤ 350 KB`，单角色可见 `3,500–7,500` 三角面，21 骨 `Armature` + `SkinnedMesh` + 8 条 NLA 动画 + 3 个头饰节点 + 双护腕 + 细化球拍）。脚本与 `.glb` 入库，不提交二进制 `.blend`。
3. **3D 前端（`@court2k/client`）**：`Vite + TypeScript + Three.js ^0.174.0`（直接内置 `GLTFLoader`、`SkeletonUtils`，零新增 npm 依赖）。生产构建 JS+CSS gzip **`≤ 600 KB`**，含 `.glb` 产物总 gzip **`≤ 800 KB`**，单角色 Draw Calls **`≤ 18`**，全场景 Draw Calls **`≤ 150`**，硬件渲染视口平均 FPS **`≥ 55`**。
4. **联机服务端（`@court2k/server`）**：`Node + TypeScript + ws`，60Hz 权威步进、30Hz 快照广播，16 并发房间平均 tick **`< 8 ms`** 且 Node RSS **`≤ 256 MB`**。
5. **程序化音效**：纯 Web Audio API 合成（零外部 mp3/wav），适配 `CLEAN/SOLID/STRETCH` 与三场地音色，彻底移除 Takeover 音效。
6. **子路径反代兼容**：支持 `VITE_BASE_PATH`（默认 `/`），静态资源、`.glb` 模型（`${import.meta.env.BASE_URL}assets/models/tennis_player.glb`）与 WS（`${wsProto}//${host}${base}ws`）全部相对路径，零改造兼容 `/tennis/`。

---

## 二、需求清单（五件套）与范围边界

### 2.1 核心需求五件套（严格区分「交付门槛」与「交付后成功指标」）

| 编号 | 模块 | 用户是谁 | 时机与操作 | 看到/听到什么 | 验收标准（本轮交付门槛，可量化） | 成功指标（交付后效果验证，**非门禁**） |
| --- | --- | --- | --- | --- | --- | --- |
| **R-01** | 彻底移除绿条与火热槽 | 桌面浏览器玩家 | 大厅、发球、对拉、赛后全流程 | 脚下无弧形进度条/指针、无 Takeover 底部槽/金色光环/点燃音效，界面清爽纯粹 | 代码、协议、3D 场景、HUD、音频与测试钩子 0 处绿条与 Takeover 残留（`AC-04`） | 真人玩家反馈界面清爽度 ≥ 4.5/5 |
| **R-02** | 自动最佳触球 + 铁律“不按允许落空” | 桌面浏览器玩家 | 回合中 `WASD`（单机兼方向键）跑位；① 提前按住或短按 `J`/`K`/`L`；② 靠近球但不按任何击球键 | ① 按住/缓冲时脚下亮起对应球种柔和光环，球入圈后自动在最佳点挥拍；② 不按击球键时无光环、不挥拍，球自然落地或出界 | 不按键靠近球（`d < 0.5 m`）0 次自动挥拍；提前按住或 `0.25 s` 前短按入圈 100% 自动挥中无卡时机挥空；长按 `≥ 0.20 s` 松手立即取消（`AC-05`） | 新手 15 秒内即可打出连续 5 拍以上回合 |
| **R-03** | 前后左右战术球路与跑位质量模型 | 桌面浏览器玩家 | 触球时结合 `J`（强力深球）/ `K`（默认前场放小球）/ `W+K`（贴网小球）/ `S+K`（中场削球）/ `L`（挑高）与 `A`/`D` 左右瞄准；站稳 vs 极限滑步 | `J` 重上旋压底线、`K` 短球拉前、`L` 高弧挑顶、`A`/`D` 拉大左右斜线；站稳打出 `CLEAN` 清脆甜点音与柔和绿光波，滑步打出 `STRETCH` 偏高过渡球 | `J` `8.0–11.5 m`、`K` `1.8–3.9 m`、`S+K` `4.8–7.2 m`、`L` 顶点 `≥ 5.0 m`；`A`/`D` 左右落点差 `≥ 4.4 m`；`CLEAN` 速度 > `SOLID` > `STRETCH`，`CLEAN` 地面球过网率 `100%` 误差 `≤ 0.12 m`（`AC-06`） | 真人对「打前/打后、打左/打右」掌控感 ≥ 4/5 |
| **R-04** | 无进度条一键分级发球（决策 1A） | 桌面浏览器玩家 | 发球态 `A`/`D` 调站位并瞄准左右，单按 `J`（强力一发）或 `K`（稳健旋转发球） | 角色流畅完成 `0.32 s` 抛球挥拍直接出球，零读条；`A`/`D` 明显发向 T 点或外角 | 一键发球零读条；`J` 初速高于 `K` `≥ 22%`；`K` 进区率 `100%`；`J` 极边角受 `CTL` 控制存在 `3%–16%` 自然失误风险；`A`/`D` 左右分明；`L` 静默忽略（`AC-07`） | 发球节奏明快无挫败感 |
| **R-05** | 四流派 400 分均衡（`TIM` → `CTL`） | 桌面浏览器玩家 | 赛前大厅选择底线重炮 / 全能节奏 / 发球上网 / 防守磨王 | 3D 预览即时切换流派服饰、头饰与体型；卡片显示 `POW/SPD/SPN/CTL/NET` | 4 流派总分严格均为 `400`；`allcourt` 舒适圈 > `serve_volley` `≥ 8%`；`defender` 跑速 > `power` `≥ 15%`；高 `CTL` 极限压线失误率显著更低（`AC-03`、`AC-06`） | 长期对战四流派胜率 45%–55% |
| **R-06** | Blender 5.2 风格化 `.glb` 角色与动画 | 桌面浏览器玩家 | 大厅 3D 预览、单机与联机实战全过程 | *Mario Tennis / Switch Sports* 风格一体平滑蒙皮运动角色，合身短袖球衣/短裤/球袜/网球鞋、清晰发型与 4 流派头饰、简约五官、细化球拍、8 段流畅骨骼动画 | Blender 5.2 脚本可无头复现导出 `.glb`（`≤ 350 KB`、单角色可见 `3,500–7,500` 三角面、`≤ 18 Draw Calls/角色`）；运行时 `avatarSource === 'glb'` 非回退；无关节黑缝/穿模；JS+CSS gzip `≤ 600 KB`、总 gzip `≤ 800 KB`、全场景 Draw Calls `≤ 150`、硬件 FPS `≥ 55`（`AC-11`） | 真人玩家对角色颜值满意度显著优于 V1 |
| **R-07** | 明亮大满贯球场光照与转播氛围 | 桌面浏览器玩家 | 选硬地/红土/草地开赛、关键分与赛后 | 晴空/暖阳渐变天空穹顶、浅色建筑看台、鲜明场地色彩与红土扬尘；大厅右侧 3D 预览通透；超级抢十横幅准确；赛后 6 项统计含 `CLEAN 甜点率` | 三场地物理差异达标（`AC-02`）；无 `#09111f` 暗箱，上空均亮度 `≥ 120/255`、全帧 `≥ 95/255`；横幅与统计 100% 吻合（`AC-02`、`AC-09`、`AC-15`） | 观感接近商业大满贯日场转播 |
| **R-08** | 3 档 AI 校准与双赛制 | 桌面浏览器玩家 | 选新手/进阶/大师 AI + Fast4（默认）/超级抢十开赛 | AI 遵循同一 V2 自动触球状态机，三档难度梯度鲜明 | 30 局基准：`pro` 胜 `rookie` `≥ 75%`、`legend` 胜 `pro` `≥ 70%`；失误率严格递减且 `CLEAN` 率严格递增（`AC-01`、`AC-09`、`AC-10`） | 默认 Fast4 实玩耗时 4–7 分钟 |
| **R-09** | V1 联机与工程能力全兼容 | 双人桌面浏览器玩家 | 4 位码联机、双方近端镜像、手动暂停、4s 断线重连、15s 弃权、Rematch、鹰眼、`/tennis/` 子路径 | 双方永远下方近端向上打，左右瞄准与 `J`/`K`/`L` 100% 对称；重连与暂停恢复后按键零失灵；`waiting` 房刷新保持大厅；鹰眼双端同步镜像；子路径含 `.glb` 零 404 | `AC-08`、`AC-12`、`AC-13`、`AC-14`、`AC-16`、`AC-17` 全量达标 | 好友双人实玩连续 Rematch 意愿 |

### 2.2 范围边界
- **In Scope（V2 必上）**：R-01 ~ R-09 全部功能（含 V1 两处遗留微瑕修复）。
- **Out of Scope（V2 不做）**：账号登录/数据库、排位匹配、移动端触控、2v2 双打、聊天、真人写实扫描头模、多套重型独立 `.glb`、上海服务器部署。

---

## 三、关键机制精确参数与规则

### 3.1 规范 3D 坐标系、镜像公式与 3D 球体物理（沿用 V1 成熟基础）
- **坐标系**：原点 `(0,0,0)` 网心地面；单打边线 `±4.115 m`、双打视觉边线 `±5.485 m`、底线 `±11.885 m`、发球线 `±6.40 m`；网高 `netHeight(x) = 0.914 + (1.07 - 0.914) * min(1, |x| / 4.57)`；球半径 `R_ball = 0.0335 m`；P0（`side = +1`）位于 `Z ∈ [+0.65, +16.0]`，P1（`side = -1`）位于 `Z ∈ [-16.0, -0.65]`。
- **双端近端镜像**：P1（`side = -1`）渲染时绕 Y 轴旋转 `180°`：`(x_v, y_v, z_v) = (-x_w, y_w, -z_w)`、`yaw_v = yaw_w + π`；输入经 `toWorldInput` 将 `moveX/moveZ/aimX/aimZ` 乘以 `side`（保留 `action` 与 `actionPressed`）。
- **固定步长物理**：`dt = 1/60 s`（`2` 子步进 `1/120 s`），`g = 9.81`、`k_d = 0.022 m⁻¹`、`k_m = 0.00055`，ITF 压线容差 `R_mark = 0.0335 m`，3 次迭代确定性球道解算器 `solveBallisticShot`。
- **三场地物理表**（不变）：
  - `hard`：`e_y = 0.78`，`e_xz = 0.76`，`μ_spin = 0.18`，`μ_player = 1.00`，`slideDuration = 0.22 s`；
  - `clay`：`e_y = 0.86`，`e_xz = 0.66`，`μ_spin = 0.28`，`μ_player = 0.72`，`slideDuration = 0.38 s`（自动滑步扬尘）；
  - `grass`：`e_y = 0.68`，`e_xz = 0.86`，`μ_spin = 0.12`，`μ_player = 0.90`，`slideDuration = 0.18 s`。

### 3.2 四流派属性表（`TIM` → `CTL`，总评分均严格 = `400`）

| 流派 ID | 名称 | `POW` | `SPD` | `SPN` | `CTL` | `NET` | 球衣主/辅色 | 短裤色 | 头饰节点 | 体型 `shoulderScale` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `power` | 底线重炮 | `94` | `72` | `82` | `76` | `76` | `#C62828` / `#FFFFFF` | `#1E293B` | `Headgear_Headband` + 双护腕 | `1.10` |
| `allcourt` | 全能节奏 | `80` | `80` | `82` | `86` | `72` | `#1D4ED8` / `#FFFFFF` | `#1E293B` | 无头饰（立体发型）+ 双护腕 | `1.00` |
| `serve_volley` | 发球上网 | `84` | `84` | `74` | `74` | `84` | `#F8FAFC` / `#15803D` | `#E2E8F0` | `Headgear_Visor` | `1.03` |
| `defender` | 防守磨王 | `70` | `94` | `86` | `82` | `68` | `#65A30D` / `#18181B` | `#18181B` | `Headgear_CapBackwards` | `0.94` |

- **属性换算公式**：
  - 最大跑速：`v_max = 5.4 + (SPD - 60) * 0.048` m/s（`5.98–7.03 m/s`，按住方向 `0.28 s` 平滑提速，无冲刺键）；
  - 极限救球自动滑步：预计到球 `eta < 0.55 s` 且 `distToLanding ∈ [1.35, 2.55] m` 且朝落点移动时触发，触球半径由 `1.48 m` 延展至 `1.90 m`；
  - 舒适击球圈半径：`R_sweet = 1.05 + (CTL - 75) * 0.008` m（`1.042–1.138 m`）；
  - 球速倍率：`1.0 + (POW - 80) * 0.008`；旋转倍率：`1.0 + (SPN - 80) * 0.010`；网前/小球精度倍率：`1.0 + (NET - 75) * 0.012`。

### 3.3 V2 自动最佳触球状态机 + 铁律“不按允许落空”
- **键位**：`WASD`（单机兼方向键）移动与瞄准；`J` 强力深球 / 一键强力一发；`K` 前场放小球与短切削（`W+K` 贴网小球、`S+K` 中场防守切削）/ 一键稳健旋转发球；`L` 挑高球（发球态静默忽略）；`Esc` 手动暂停/恢复。对战态一律 `e.preventDefault()` 防页面滚动。
- **客户端输入采样边沿铁律**：① 忽略键盘自动连发 `e.repeat === true` 对 `actionPressed` 的触发（避免长按重置 `holdDurationSec` 破坏长按取消）；② 单帧内 `keydown+keyup` 极快短按必须锁存 1 帧 `{ action: key, actionPressed: true }`；③ 按住期间按下另一球种键立即切换并发出 `actionPressed: true`，松开旧键不清空当前新键；④ `resetAndRebind()` 清空所有按键、激活键与待发边沿。
- **预选准备与取消规则（`ShotStanceState`）**：
  1. 己方刚击出球（`ball.lastHitter === idx`）时自动清空 `armedAction = 'none'`、`holdDurationSec = 0`、`bufferRemainingSec = 0`；
  2. 来球飞向己方且 `ball.hitTick !== stance.lastConsumedHitTick`：
     - 玩家按住 `J`/`K`/`L`：置 `armedAction = input.action`，若为新按下（`actionPressed` 或切换球种）则 `holdDurationSec = dt`，否则 `holdDurationSec += dt`，清空 `bufferRemainingSec = 0`；
     - 玩家松开球种键（`input.action === 'none'` 且上一 tick 在按住）：
       - **短按（`holdDurationSec < 0.20 s`）** → 进入 `0.35 s` 预输入缓冲（`bufferRemainingSec = 0.35`，`holdDurationSec = 0`）；
       - **长按（`holdDurationSec >= 0.20 s`）** → 立即取消武装（`armedAction = 'none'`、`holdDurationSec = 0`、`bufferRemainingSec = 0`），方便发现来球出界时松手放空；
     - 缓冲期内每 tick 递减 `bufferRemainingSec`，归零时置 `armedAction = 'none'`；
  3. **铁律**：**若 `stance.armedAction === 'none'`，直接跳过击球检测，绝不自动挥拍，允许落空**。
- **最佳触球点自动挥拍判定（含防同帧连击与防隔网触球闭环）**：
  - 前置条件：`stance.armedAction !== 'none'`、`ball.active`、`ball.lastHitter !== idx`、`ball.hitTick < next.tick`（单 tick 至多发生 1 次有效击球，杜绝网前同帧互打）、`ball.hitTick !== stance.lastConsumedHitTick`、`ball.bounces <= 1`、**`ball.pos.z * p.side >= -0.05`** 且 **`ball.vel.z * p.side > 0`**（球位于己方半场/网带上方且正飞向己方，杜绝隔网打对方出球）；
  - 有效触球半径：`R_reach = p.isSliding ? 1.90 : 1.48` m；
  - 高度容差：网前（`|p.pos.z| < 6.0`）`y <= 2.65 m`；底线（`|p.pos.z| >= 6.0`）`y <= 2.35 m`（且若球未弹地且 `y > 1.95 m` 且非下一帧离圈，则等待球下落或弹起）；
  - 设 `d_now` 为当前人球水平距、`d_next` 为下一 tick 预测人球水平距。当 `d_now <= R_reach` 且满足高度条件，以下任一成立即刻触发挥拍：
    1. **最近接近点**：`d_next >= d_now - 0.01`；
    2. **核心甜区**：`d_now <= 0.72` 且 `ball.pos.y <= 1.75` 且（`ball.bounces === 1` 或 `|p.pos.z| < 6.0`）；
    3. **防漏兜底**：`d_next > R_reach` 或（`ball.bounces === 1 && ball.pos.y <= 0.35 && ball.vel.y < 0`）。
  - 触发瞬间锁定 `stance.lastConsumedHitTick = ball.hitTick`、`ball.hitTick = next.tick` 并清空武装态。

### 3.4 跑位到位度质量模型、前后左右球路与无进度条一键发球
- **跑位质量三档（`ShotQuality = 'CLEAN' | 'SOLID' | 'STRETCH'`）**：
  - **`CLEAN`**（`!isSliding && d_contact <= R_sweet`）：球速 `× 1.12`，散布 `±0.03 m`，100% 过网，`A`/`D` 满压可精准贴边线 `14 cm`；
  - **`SOLID`**（`!isSliding && R_sweet < d_contact <= 1.48`）：球速 `× 1.00`，散布 `±max(0.14, 0.28 - (CTL - 75) * 0.006) m`，100% 过网；
  - **`STRETCH`**（`isSliding || d_contact > 1.48`）：球速 `× 0.80`，散布 `±max(0.38, 0.68 - (CTL - 75) * 0.012) m`；
    - 对中深球（`topspin`/`slice`/`lob`）：落点浅缩 `1.1 m`（最小钳位 `|Z| >= 2.2 m`），易于对手进攻；
    - 对 **`dropshot`**：**不执行 `-1.1 m` 浅缩**（改为略微变深 `+0.35 m` 且最终目标 `|Z|` 严格钳位在 **`[2.0, 3.8] m`**，保证物理可过 `0.914 m` 球网且不越出 `AC-06` 区间）；
    - 若在 `STRETCH` 下同时满压边线（`|aimX| > 0.75`），出界概率 `p_err = clamp(0.14 - (CTL - 75) * 0.004, 0.04, 0.22)`（拉出边线 `0.08–0.32 m`）。
- **前后左右球路落点（`forwardAimZ = -aimZ * p.side`，双端镜像统一）**：
  - **`J` → `topspin`（强力深球）**：目标 `|Z| = clamp(9.8 + forwardAimZ * 1.55, 8.2, 11.45) m`、`X = aimX * (4.115 - 0.14)`、基础速 `28.0 m/s`、上旋 `+58 rad/s`；
  - **`K`（非 `S+K`）→ `dropshot`（前场放小球/短切削，已批决策 2A）**：
    - `forwardAimZ <= -0.5`（即按住 **`S + K`**）判 **`slice`（中场防守切削）**：目标 `|Z| = 6.0 m`、`X = aimX * (4.115 - 0.20)`、基础速 `18.8 m/s`、下旋 `-50 rad/s`；
    - 否则（单按 **`K`** 或 **`W + K`**）判 **`dropshot`（前场短球）**：默认 `|Z| = 2.85 m`，按住 `W+K`（`forwardAimZ >= 0.5`）压缩至 `2.15–2.65 m`（受 `NET` 增强）、`X = aimX * (4.115 - 0.32)`、基础速 `14.8 m/s`、下旋 `-42 rad/s`；
  - **`L` → `lob`（挑高球）**：目标 `|Z| = 10.1 m`、`X = aimX * (4.115 - 0.50)`、基础速 `19.6 m/s`、上旋 `+24 rad/s`、强制顶点 `peakHeightMinM = 5.60 m`。
- **一键分级发球（已批决策 1A）与统计口径**：
  - `serve_ready → serve_toss` 严格要求边沿触发 **`input.actionPressed && (input.action === 'J' || input.action === 'K')`**（防上一分按住未松误触；AI 发球帧同步置 `actionPressed: true`；`L` 键静默忽略）；
  - 进入 `serve_toss` 后锁存 `armedAction` 与 `lockedAimX = input.aimX`；抛球期间（`0.32 s`）**松开 `J`/`K` 绝不取消发球**，且仅当 `Math.abs(input.aimX) > 0.05` 时更新 `lockedAimX`（防中途松开 `A`/`D` 归零）；到达 `0.32 s` 自动出球，零进度条；
  - **`J` 强力一发**：基础速 `38.5 m/s`（转播显示 `182–216 km/h`），上旋 `+18 rad/s`，目标深度 `5.75 m`；仅满压极边角（`|lockedAimX| > 0.85`）存在自然失误风险 `p_fault = clamp(0.10 - (CTL - 75) * 0.003, 0.03, 0.16)`（偏出发球框 `0.10–0.42 m`）；
  - **`K` 稳健旋转发球**：基础速 `28.0 m/s`（转播显示 `140–166 km/h`），强上旋 `+65 rad/s`，目标深度 `5.15 m`，**100% 进目标发球框（0% 失误）**；
  - **发球 `ShotQuality` 与统计口径锁定**：正常进区瞄准的 `serve_flat` 与全部 `serve_kick` 判 **`quality = 'CLEAN'`**；触发极边角自然失误的 `serve_flat` 判 **`quality = 'SOLID'`**。每次发球与回合击球均 `totalShots += 1`，仅 `quality === 'CLEAN'` 时 `cleanShots += 1`；发球擦网进区判 `NET_LET` 重发时，精确回滚 `totalShots -= 1`、若 `ball.lastShotQuality === 'CLEAN'` 则 `cleanShots -= 1`、若 `serveNumber === 1` 则 `firstServesTotal -= 1`。

### 3.5 Blender 5.2 风格化 3D 角色与明亮大满贯球场光照规范
- **Blender 5.2 角色资产（`WP-Asset`）**：
  - *Mario Tennis / Switch Sports* 风格化一体运动角色，身高 `1.78 m`（glTF 脚底 `minY ≈ 0`，正面朝 **`-Z`**，右手持拍位于 **`+X`**），一体化平滑蒙皮网格绑定 **21 骨 `Armature`**，无胶囊球关节黑缝；
  - 具备短袖运动球衣（主/辅色材质槽）、运动短裤、中筒运动袜、多层运动鞋、立体发型、简约清爽五官（独立静态五官材质，不随换色变色）、3 款独立命名的可切换头饰节点（`Headgear_Headband`/`Headgear_Visor`/`Headgear_CapBackwards`）、独立双护腕节点（`Wristband_L`/`Wristband_R`）与细化 Y 喉网球拍（`Racquet`）；
  - 嵌入 8 条 NLA 动画：`idle`、`run`、`slide`、`serve_toss`、`forehand`、`backhand`、`lob`、`celebrate`（仅含骨骼旋转与 `Hips` 位移，**严禁导出骨骼 `scale` 轨道**以免覆写 `shoulderScale`）；
  - 体量门槛：`.glb` 原始 **`≤ 350 KB`**、单角色可见面数 **`3,500–7,500`** 三角面（全文件总计 `≤ 9,000`）、单角色 Draw Calls **`≤ 18`**（双人 `≤ 36`，全场景 `≤ 150`）；
  - `GlbPlayerAvatar` 通过 `PlayerAvatarController` 接入，克隆独立材质换色，运行时向 `TestStateSnapshot` 暴露 `avatarLoaded`、`avatarSource: 'glb' | 'fallback'`、`avatarTriangles`。
- **明亮大满贯日场光照与视觉（`WP2`）**：
  - 彻底移除 `#09111f` 暗黑背景与夜场黑雾，构建 1-Draw-Call 渐变晴空穹顶（Sky Dome）+ 三场地专属日场光照、浅色混凝土/石灰岩看台与夏装观众席：
    - `hard`：晴空 `#60a5fa → #dbeafe`，内场 `#2474B5` / 外场 `#2F9E78`，暖白日光 `intensity=2.35`，浅灰看台 `#d5dde8`，深蓝围挡 `#1e3a5f`；
    - `clay`：巴黎午后 `#5b9ee8 → #fde8d0`，红土 `#D16638` / `#B8532C`，金阳 `intensity=2.45`，米白看台 `#e6ddd2`，法网墨绿围挡 `#1b4d3e` + 红土滑步扬尘；
    - `grass`：伦敦夏日 `#67a9f0 → #e5f3ff`，草皮条纹 `#3B8A49` / `#2F753C`，清朗日光 `intensity=2.30`，奶油白看台 `#e8ece9`，温网深绿紫条围挡 `#14452f`；
  - 提亮大厅右侧 3D 角色展示通透度；移除脚下 3D 弧形绿条，改为按住/缓冲球种键时显示的轻量地面预选环（`J` `#f59e0b`、`K` `#06b6d4`、`L` `#a855f7`），未按时不显示；`CLEAN` 击球触发 `0.32 s` 柔和翡翠绿光波。
  - **量化亮度门槛**：3 块场地实机截图中，上方天空/看台区域平均亮度 **`≥ 120 / 255`**，全画面平均亮度 **`≥ 95 / 255`**。

### 3.6 赛制、AI、鹰眼、联机暂停/重连/Rematch 与工程防护（沿用并优化）
- **双赛制与关键分横幅**：Fast4（默认，金球 + 3-3 7 分抢七）与超级抢十（先 10 赢 2）；引擎 `KeyPointLabel` 新增 `'SUPER_TIEBREAK'`，超级抢十开局准确展示 `SUPER TIEBREAK · 超级抢十`。赛后 6 项统计：Ace、双误、一发成功率、制胜分、非受迫失误（UE）、**`CLEAN` 站稳甜点率**。
- **单人 3 档 AI（走统一 V2 自动触球状态机）**：
  - `rookie`：反应 `280 ms`、跑速 `0.74×`、站位偏移 `±0.58 m`、`aggression 0.28`；
  - `pro`：反应 `140 ms`、跑速 `0.90×`、站位偏移 `±0.22 m`、`aggression 0.68`、`K` 短球 `16%`、`L` 挑高 `10%`；
  - `legend`：反应 `50 ms`、跑速 `1.00×`、站位偏移 `±0.05 m`、`aggression 0.92`、`K` 短球 `22%`、`L` 挑高 `24%`、发球上网 `30%`。
- **轻量 3D 鹰眼**：终结球或关键分首跳距最近有效线 `≤ 15 cm` 触发 `1.8 s` 3D 贴地特写，结束后复位机位并执行 `InputController.resetAndRebind('HAWKEYE_END')`。
- **1v1 联机暂停 / 重连 / Rematch / `waiting` 房刷新修复**：
  - 双方均可 `Esc` 手动暂停（每人每场上限 `3` 次、单次 `60 s`、双方可恢复、恢复前统一 `3 s` 倒计时）；
  - 断线立即进入 `15 s` 宽限暂停（独立双计时器）；15s 内重连重置 `lastAckSeq[idx] = 0`、下发 `FULL_SYNC` + `3 s` 倒计时；超时 15s 发出唯一 `MATCH_OVER(reason:'forfeit')`；
  - **V2 修复**：收到 `FULL_SYNC` 且 `snapshot.phase === 'waiting'` 时，保持在大厅等待界面，不强切至空比赛画布；
  - 赛后双方确认 `REMATCH_REQUEST` 在同房重置比分、统计与 `manualPausesLeft = [3, 3]` 开新局。
- **DPR / 高刷限帧与输入自愈**：DPR 封顶 `2.0`、`HIGH(2.0)→MEDIUM(1.5)→LOW(1.0)` 自动降档与最多回升 1 次、`estHz > 105Hz` 才启 60fps 节流（不误伤 90/100Hz）；`?netdebug=1` 指标完整；`InputController.resetAndRebind()` 在全部 6 类时机清空按键、激活键与边沿缓冲并重绑监听。

---

## 四、可测试验收表（`AC-01` ~ `AC-17`，全为本轮 V2 交付门槛）

| 编号 | 风险 | 初始条件 | 操作步骤 | 量化预期结果 | 所需证据类型 | 推荐验证方式 | 缺条件处理 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **AC-01** | 高 | 正常 URL（**不带 `?test=1`**），视口 `1280×720` | 从大厅选「单人 → 硬地 → 全能节奏 → 新手 AI → Fast4 → 开始」，纯键盘 `WASD` + `J`/`K`/`L` 发球对拉完打至少 1 局，测试 `Esc` 暂停与恢复 | 流畅进入明亮 3D 球场，无绿条自动触球闭环打完 ≥ 1 局（局分 `1-0` 或 `0-1`），暂停恢复正常，0 console error，0 个 404 | 关键帧截图 ≥ 3 张 + 控制台日志 + 输入序列 | `Tester 交互实操` | 缺桌面浏览器判 `BLOCKED` |
| **AC-02** | 高 | `seed=42`，依次测 `hard`/`clay`/`grass` | ① 脚本同初速对比三场地弹跳；② Tester 依次切换 3 块场地进入实战并急停滑步，计算截图亮度均值 | ① 红土弹高 > 硬地 `≥ 8%`、草地弹高 < 硬地 `≥ 10%`、草地弹后水平速 > 红土 `≥ 20%`；② 3 场地明亮日场天空与看台清晰、无 `#09111f` 暗箱，上空均亮度 `≥ 120/255`、全帧均亮度 `≥ 95/255`，红土扬尘可见 | 单测数据日志 + 3 场地截图 + 亮度脚本输出 | `脚本自动测` + `Tester 交互实操` | 无外部依赖 |
| **AC-03** | 高 | 大厅与比赛态，`seed=42` | ① 脚本校验 4 流派总分与 `CTL` 命名；② 实机切换 4 流派检查 3D 外观与物理数值差异 | 4 流派五维（含 `CTL`，无 `TIM`）总分严格 `= 400`；`defender` 跑速 > `power` `≥ 15%`、`allcourt` `R_sweet` > `serve_volley` `≥ 8%`、`power` 一发初速最高；3D 服饰/头饰/体型肉眼可分 | 单测输出 + 4 流派大厅 3D 预览对比截图 | `脚本自动测` + `Tester 交互实操` | 无外部依赖 |
| **AC-04** | 高 | 源码 + 正常入口全流程 | ① 静态扫描 `shared/client/server`；② 实机在大厅、发球、回合、赛后检查 3D 场景与 HUD | 代码/协议/UI 0 处绿条进度条与 Takeover 残留；画面无脚下弧形读条、无火热槽卡片、无 `PERFECT/EARLY/LATE` 绿条提示 | 静态扫描输出 + 实战/赛后截图 + 代码审 | `Reviewer 代码审` + `Tester 交互实操` | 无外部依赖 |
| **AC-05** | 高 | `seed=100`，`?test=1` `spawnIncomingBall` + 正常对拉 | ① 来球进入玩家 `d < 0.5 m` 处，玩家仅移动**不按 `J/K/L`**；② 提前按住 `J` 入圈；③ 触球前 `0.25 s` 短按 `J`（`<0.20 s`）；④ 长按 `J` `0.30 s` 后在入圈前松手；⑤ 双方网前站位验证无同帧隔网互打 | ① **0 次自动挥拍**，球自然落地/出界；②③ 均自动在最佳点挥中，**0 次卡时机打空**；④ 长按松手后立即取消武装并允许落空；⑤ 单 tick 至多 1 次击球无隔网连击；按住时显示预选球种环，未按时不显示 | 状态序列断言日志 + 预选环/放球截图 | `脚本自动测` + `Tester 交互实操` | 无外部依赖 |
| **AC-06** | 高 | `seed=100`，`?test=1` + 正常实战 | 分别用 `J`、`K`、`W+K`、`S+K`、`L` 结合 `A`/`D` 瞄准，在 `CLEAN`/`SOLID`/`STRETCH` 三区各击球 ≥ 20 次 | `J` 落点 `8.0–11.5 m`、`K` `1.8–3.9 m`（含 `STRETCH` 钳位 `2.0–3.8 m`）、`S+K` `4.8–7.2 m`、`L` 顶点 `≥ 5.0 m`；`A`/`D` 左右落点差 `≥ 4.4 m`；`CLEAN` 速度 > `SOLID` > `STRETCH`；`CLEAN` 地面球（`J`/`K`/`S+K`）过网率 `100%` 且落点误差 `≤ 0.12 m`；极限压线时高 `CTL` 失误率低于低 `CTL` | 统计单测日志 + 关键帧截图 | `脚本自动测` + `Tester 交互实操` | 无外部依赖 |
| **AC-07** | 高 | `seed=100`，`serve_ready` 态 | 分别用 `J`/`K` 结合 `A`/`D` 瞄准发球各 ≥ 20 次；另测按 `L` 键及按住上一分 `J` 进入下一分不误发 | 边沿单按即于 `0.32 s` 后直接出球无读条（抛球中松手不取消）；`J` 初速高于 `K` `≥ 22%`；`K` 进区率 `100%`；`A`/`D` 左右落点分明；`L` 键静默忽略 | 发球统计日志 + 发球瞬间截图 | `脚本自动测` + `Tester 交互实操` | 无外部依赖 |
| **AC-08** | 高 | `?test=1` `triggerHawkeyeShot` + 正常对战 | 发射 `8 cm`（界内）、`10 cm`（界外）、`25 cm` 测试球，特写结束后立即按键 | `8 cm`/`10 cm` 触发 `1.8 s ± 0.2 s` 3D 特写并准确判 `IN`/`OUT`；`25 cm` 不触发；结束后机位复位且按键即刻响应 | 鹰眼 IN/OUT 截图 2 张 + 时序日志 | `脚本自动测` + `Tester 交互实操` | 无外部依赖 |
| **AC-09** | 中 | `?test=1` `setScore` + 单元测试 | 验证 Fast4 金球/抢七/完赛与超级抢十 `9-9 → 11-9`；核对横幅与赛后 6 项统计 | 状态机 0 死锁；超级抢十横幅准确显示 `SUPER TIEBREAK · 超级抢十`；赛后 Ace/双误/一发率/制胜分/UE/`CLEAN 甜点率` 100% 吻合引擎日志（含 `NET_LET` 精确回滚） | 全量单测 + 关键分与赛后统计截图 | `脚本自动测` + `Tester 交互实操` | 无外部依赖 |
| **AC-10** | 中 | 无头模拟脚本，固定种子序列 | 跑「`pro` vs `rookie`」30 局、「`legend` vs `pro`」30 局 | `pro` 胜 `rookie` `≥ 75%`、`legend` 胜 `pro` `≥ 70%`；非受迫失误率递减（`rookie > pro > legend`）且 `CLEAN` 率递增（`legend > pro > rookie`） | 无头基准统计脚本输出 | `脚本自动测` | 无外部依赖 |
| **AC-11** | 高 | 本机 Blender 5.2 CLI + `vite build` 产物 | ① 无头重跑 `generate_player_avatar.py` 验证 `.glb` 导出体积/面数/21 骨/朝向/8 动画；② 实机核查 `avatarSource === 'glb'`、近景与实战外观、包体 gzip、Draw Calls 与 FPS | `.glb` 原始 `≤ 350 KB`、单角色可见面数 `3,500–7,500`、21 骨 + 8 动画（0 `scale` 轨道）+ 6 独立节点齐全、朝向 `-Z` 右手持拍 `+X`；运行时 100% 走 `glb` 非回退、无黑缝穿模；前端 JS+CSS gzip `≤ 600 KB`（含 `.glb` 总 gzip `≤ 800 KB`）；单角色 Draw Calls `≤ 18`、全场景 `≤ 150`；硬件 WebGL 平均 FPS `≥ 55` | Blender 导出日志 + 资产核检脚本 + 大厅/实战近景截图 + `vite build` 体积输出 | `脚本自动测` + `Tester 交互实操` + `Reviewer 代码审` | 软件渲染环境下如实记录帧率硬件限制 |
| **AC-12** | 高 | 双独立浏览器会话，正常入口（无 `?test=1`） | P0 建房、P1 选不同流派入房，用 V2 自动触球打完 ≥ 1 局 Fast4；测联机 `Esc` 手动暂停（含 3 次上限与 60s 到期）、双方恢复 3s 倒计时与赛后 Rematch | 双端均下方近端向上击球，`A`/`D`/`J`/`K`/`L` 100% 对称同步；暂停/恢复与 3s 倒计时后按键即刻响应；第 4 次暂停返回 `PAUSE_LIMIT_REACHED`；Rematch 重置比分与暂停次数 `[3,3]` | 双端并排截图 + WS 同步与暂停日志 | `脚本自动测` + `Tester 交互实操` | 缺双独立会话判 `BLOCKED` |
| **AC-13** | 高 | 双独立浏览器会话对战中 + 等待房 | ① P1 断线 4s 自动重连 `FULL_SYNC` + 3s 倒计时后立即按 `WASD` + `J`/`K`；② P1 断线超 15s；③ `waiting` 房内刷新重连 | ① 原比分续打且 **P1 移动与击球 100% 即时响应不失灵**；② 超 15s 弹出唯一 `MATCH_OVER(reason:'forfeit')` 胜利结算；③ 等待房刷新仍留在等待大厅 | 双端截图 + 输入响应日志 + 集成测试输出 | `脚本自动测` + `Tester 交互实操` | 缺双独立会话判 `BLOCKED` |
| **AC-14** | 高 | `?netdebug=1`（配合 `?test=1` 压测注入） | 验证 DPR 上限、降档与最多回升 1 次、`60/90/100/120/144 Hz` 限帧策略及面板指标 | `ActiveDPR ≤ 2.0`；降档稳定后最多回升 1 次（`upgradeCount ≤ 1`）；仅 `120/144 Hz` 限 60fps（`90/100 Hz` 不限）；`?netdebug=1` 完整 | 单元测试 + `?netdebug=1` 截图 | `脚本自动测` + `Tester 交互实操` + `Reviewer 代码审` | 非 Retina/120Hz 真机观感标「非门槛待用户自测」 |
| **AC-15** | 中 | 正常入口打开游戏 | 触发 `CLEAN`/`SOLID`/`STRETCH` 击球、三场地弹地、鹰眼、得分，再切静音键 | 0 AudioContext 报错、0 外部音频 404；静音即时生效增益归零；无 Takeover 残留音效 | 控制台日志 + `AudioManager` 代码审 | `Tester 交互实操` + `Reviewer 代码审` | 无外部依赖 |
| **AC-16** | 高 | `VITE_BASE_PATH=/tennis/` 构建 + 16 并发房压测 | ① 本地 `/tennis/` 静态+WS 反代跑通单机与联机；② 16 并发房 60Hz 跑 30 秒 | 静态资源、**`/tennis/assets/models/tennis_player.glb`** 与 `/tennis/ws` 全部 0 个 404；16 房平均 tick `< 8 ms`、Node RSS `≤ 256 MB` | 网络请求日志 + 16 房压测日志 | `脚本自动测` | 无外部依赖 |
| **AC-17** | 高 | 正常 URL（无 `?test=1`）与 `git diff` | 核查全局测试对象与 git 改动范围 | 正常入口 `window.__COURT2K_TEST__ === undefined` 且无调试 UI；改动严格限于 `tennis-2k/**`，零触碰 `main`/`gold-miner`/远端 | 控制台检查 + `git status`/`diff` 输出 | `Reviewer 代码审` + `脚本自动测` | 无外部依赖 |

---

## 五、受控测试钩子设计（`?test=1` 严格隔离）

仅在客户端 URL 携带 `?test=1` 时挂载 `window.__COURT2K_TEST__`；服务端仅在环境变量 `ENABLE_TEST_HOOKS=1` 时受理 `TEST_COMMAND`（否则返回 `FORBIDDEN_TEST_HOOK`）。正常入口零暴露、零影响，钩子不得替代正常入口端到端验收（`AC-01`、`AC-12`）。

```ts
export interface Court2KTestHook {
  getState(): Readonly<TestStateSnapshot>; // 定义于 @court2k/shared，含 avatarLoaded / avatarSource / avatarTriangles / stance / 比分 / 画质 / inputDiagnostics
  setSeed(seed: number): void;
  setScore(patch: ScorePatch): void;
  triggerHawkeyeShot(opts: { inBounds: boolean; distCm: number; line?: 'sideline' | 'baseline' }): void;
  spawnIncomingBall(opts: { targetX: number; targetZ: number; speedXZ?: number; forPlayerIndex?: 0 | 1 }): void;
  fastForwardPause(seconds: number): void;
  simulatePerfSpike(frameMs: number, durationMs: number): void;
  simulateRefreshRate(hz: number): void;
  simulateDisconnect(reconnectAfterMs: number): void;
}
```

---

## 六、已批准预授权与红线清单

- **已获授权自动推进（2026-11-27「可以开始」）**：
  1. 定稿 `docs/SPEC.md`、`docs/CONTRACT.md` 与 Obsidian V2 主本 → 契约评审（`4900–4999`）→ 6 项 Preflight；
  2. 按 `(WP1 shared ∥ WP-Asset Blender) → (WP2 client ∥ WP3 server) → integration/v2` 顺序拉起 Builder / Reviewer / Tester；
  3. 调用本机 Blender 5.2 CLI 导出 `.glb` 并在 `3100–4999` 本地端口执行构建、压测与双会话 E2E 验收；单包返工 ≤ 5 轮、整合返工 ≤ 3 轮内自动闭环并按阶段汇报。
- **绝对红线（必须单独请示）**：
  1. 合并至 `main`、`git push` 或改动 `gold-miner` 任何文件；
  2. 任何涉及上海服务器或公网部署的操作；
  3. 超出返工上限、发现规格物理矛盾或中途变更 `CONTRACT.md` 跨包接口；
  4. 引入付费外部服务、修改全局系统配置或清理既有非本任务文件。
