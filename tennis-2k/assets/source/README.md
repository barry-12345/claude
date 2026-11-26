# Court 2K V2 — 风格化 3D 网球角色资产说明（WP-Asset）

- **生成环境**：`Blender 5.2.3 LTS`（Windows 本机 `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`）
- **主生成脚本**：`tennis-2k/assets/source/generate_player_avatar.py`
- **契约校验脚本**：`tennis-2k/assets/source/verify_glb.py`
- **渲染预览脚本**：`tennis-2k/assets/source/render_previews.py`
- **导出目标（不提交 `.blend`）**：`tennis-2k/client/public/assets/models/tennis_player.glb`

---

## 1. 一键复现与校验命令（PowerShell）

```powershell
# 1) 无参默认导出至 tennis-2k/client/public/assets/models/tennis_player.glb
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/generate_player_avatar.py

# 2) 指定自定义输出路径导出
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/generate_player_avatar.py -- --output tennis-2k/client/public/assets/models/tennis_player.glb

# 3) 离线校验 glTF 二进制契约（21 骨 / 6 节点 / 10 材质 / 8 动画 / 0 scale 轨道 / 包体与面数 / 朝向与尺寸）
python tennis-2k/assets/source/verify_glb.py tennis-2k/client/public/assets/models/tennis_player.glb --json tennis-2k/docs/review/wp-asset/evidence/v2-round-2/verify_glb.json

# 4) 渲染 8 张明亮日光摄影棚预览图至 docs/review/wp-asset/evidence/v2-round-2/
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/render_previews.py -- tennis-2k/client/public/assets/models/tennis_player.glb tennis-2k/docs/review/wp-asset/evidence/v2-round-2
```

---

## 2. 坐标系、朝向与尺寸规范

- **Blender 建模空间**：正面朝 `+Y`、上方向 `+Z`、右手持拍侧 `+X`。
- **导出 glTF 2.0（`export_yup=True`）**：
  - 人物正面（五官、胸口撞色条、`Headgear_Visor` 帽檐）严格朝 **`-Z`**（匹配客户端 `yaw = 0`）；
  - 人物背面（`Headgear_CapBackwards` 帽檐、`Headgear_Headband` 飘带）朝 **`+Z`**；
  - 右手持拍（`Hand_R` / `RacquetSocket` / `Racquet`）严格位于 **`+X`**；
  - 脚底鞋底平面 `minY = 0.000 m`（满足 `|minY| ≤ 0.01 m`），总高 `~1.76 m`（满足 `1.75–1.82 m`）。

---

## 3. 21 根骨骼层级树（`Armature`）

```text
Hips
├─ Spine
│  └─ Chest                      # WP2 运行期设置 scale.x = shoulderScale
│     ├─ Neck
│     │  └─ Head
│     │     └─ HeadgearSocket    # 挂载 3 款独立头饰节点
│     ├─ Shoulder_L
│     │  └─ UpperArm_L
│     │     └─ Forearm_L         # 挂载 Wristband_L
│     │        └─ Hand_L
│     └─ Shoulder_R
│        └─ UpperArm_R
│           └─ Forearm_R         # 挂载 Wristband_R
│              └─ Hand_R
│                 └─ RacquetSocket  # 挂载 Racquet
├─ Thigh_L
│  └─ Shin_L
│     └─ Foot_L
└─ Thigh_R
   └─ Shin_R
      └─ Foot_R
```

---

## 4. 6 个独立可切换场景节点（`getObjectByName`）

| 节点名称 | 挂载骨骼 | 显示流派 | 材质分配 |
| --- | --- | --- | --- |
| `Headgear_Headband` | `HeadgearSocket` | `power` | `Mat_JerseyAccent` |
| `Headgear_Visor` | `HeadgearSocket` | `serve_volley` | 带身 `Mat_JerseyPrimary` / 帽檐 `Mat_JerseyAccent` |
| `Headgear_CapBackwards` | `HeadgearSocket` | `defender` | 帽冠 `Mat_JerseyAccent` / 帽檐 `Mat_JerseyPrimary` |
| `Wristband_L` | `Forearm_L` | `power`, `allcourt` | `Mat_JerseyAccent` |
| `Wristband_R` | `Forearm_R` | `power`, `allcourt` | `Mat_JerseyAccent` |
| `Racquet` | `RacquetSocket` | 全流派常显 | `Mat_RacquetFrame` / `Mat_RacquetStrings` / `Mat_RacquetGrip` |

---

## 5. 材质清单（10 换色材质 + 4 静态细节材质）

- **运行期可换色（10 个，精确匹配 `CONTRACT.md` §4.2）**：
  - `Mat_JerseyPrimary`、`Mat_JerseyAccent`、`Mat_Shorts`、`Mat_Skin`、`Mat_Hair`、`Mat_Socks`、`Mat_ShoeUpper`、`Mat_ShoeSole`、`Mat_RacquetFrame`、`Mat_RacquetStrings`
- **静态不换色细节（4 个）**：
  - `Mat_EyeWhite`、`Mat_EyeIris`、`Mat_FaceDetail`、`Mat_RacquetGrip`

---

## 6. 8 条嵌入式 NLA 骨骼动画 Clip（严禁骨骼 `scale` 轨道）

| Clip 名称 | 时长（s） | 用途 | 骨骼 `scale` 轨道数 |
| --- | --- | --- | --- |
| `idle` | `1.20` | 运动待机准备姿态（循环） | `0` |
| `run` | `0.56` | 球场跑动摆臂迈步（循环） | `0` |
| `slide` | `0.50` | 极限救球滑步弓步 | `0` |
| `serve_toss` | `0.35` | 发球抛球 + 奖杯引拍姿态 | `0` |
| `forehand` | `0.36` | 正手引拍-击球-随挥 | `0` |
| `backhand` | `0.36` | 反手引拍-击球-随挥 | `0` |
| `lob` | `0.40` | 蹲低挑高挥拍 | `0` |
| `celebrate` | `1.00` | 胜利起跳挥拳庆祝（循环） | `0` |
