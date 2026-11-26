# Builder 交付报告 — V2 Round 1（WP-Asset · Blender 5.2 风格化 3D 角色资产）

## 0. 快速索引
- **候选版本**：`feat/v2-wpasset`（基于 `2f6c96fae70e9b6040c54ef7a23221513a3f8c23`；最终提交哈希以汇报为准）
- **本轮相对上轮变化**：首次交付；使用本机 `Blender 5.2.3 LTS` 无头脚本从零构建 *Mario Tennis / Nintendo Switch Sports* 风格化一体化平滑蒙皮角色、21 骨 `Armature`、6 个独立可切换节点、10 个运行期换色材质（+4 个静态五官/握把材质）及 8 条无 `scale` 轨道 NLA 骨骼动画，并通过离线二进制校验与 6 张日光摄影棚渲染图逐张肉眼审查调优。
- **启动方式与 Tester 前置条件**：
  - 默认生成命令：`& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/generate_player_avatar.py`
  - 自定义输出命令：`& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/generate_player_avatar.py -- --output <path>`
  - 资产说明清单：`tennis-2k/assets/source/README.md`
  - 运行期消费路径：`tennis-2k/client/public/assets/models/tennis_player.glb`（由 WP2 `GlbPlayerAvatar` 加载，零 `.blend` 文件入库）
- **自测命令与证据索引**：
  - 离线契约校验脚本：`& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/verify_glb.py`（结果：全部契约项 PASS）
  - 渲染预览脚本：`& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python tennis-2k/assets/source/render_previews.py`
  - 校验 JSON 与 6 张高清预览图证据：`tennis-2k/docs/review/wp-asset/evidence/v2-round-1/`（含 `verify_glb.json` 及 `01_front_full.png` ~ `06_archetypes_lineup.png`）
- **环境未验证缺口**：本包仅交付离线 Blender 资产与 `.glb` 模型；浏览器 Three.js `GLTFLoader` / `SkeletonUtils.clone()` 运行期渲染、双人同屏 Draw Calls 与 120Hz FPS 由下游 WP2（`client`）与 `integration/v2` 在真实 WebGL 会话中联调验证。

---

## 1. 实现概述与接口说明

### 1.1 造型与审美重构
针对 V1 胶囊拼装人偶与关节黑缝问题，在 `tennis-2k/assets/source/generate_player_avatar.py` 中通过 `bmesh` 连续截面放样（loft）与光滑雕刻拓扑实现一体化平滑蒙皮网格 `Avatar_Body`：
- **头身比例与五官**：约 `1 : 5.7` 运动比例（`height = 1.7566 m`），圆润额颅与柔和下颌收尖、立体多层次扫刘海与发顶蓬松发簇（`Mat_Hair`）、清澈眼白（`Mat_EyeWhite`）+ 钴蓝虹膜（`Mat_EyeIris`）+ 瞳孔/上睫线/微笑弧线（`Mat_FaceDetail`）+ 高光点，彻底消除木偶或平面贴图感。
- **一体化服饰与鞋袜**：无缝连接的短袖网球服（`Mat_JerseyPrimary` + 领口/袖口/胸带 `Mat_JerseyAccent`）、修身运动短裤（`Mat_Shorts` + 侧边撞色条）、中筒运动袜（`Mat_Socks`）与平底流线网球鞋（`Mat_ShoeUpper` + `Mat_ShoeSole`，`minY = 0.0000 m`）。
- **明确分区权重绑定**：通过构建期顶点区域标签（`PART_TORSO` / `PART_ARM_L` / `PART_ARM_R` / `PART_LEG_L` / `PART_LEG_R` / `PART_HEAD`）精确计算 21 骨平滑过渡权重，彻底杜绝跨部位错误牵拉与关节黑缝。

### 1.2 契约对齐细节（`CONTRACT.md` §4.2）
- **21 骨精确层级**：`Hips → Spine → Chest → (Neck → Head → HeadgearSocket; Shoulder_L → UpperArm_L → Forearm_L → Hand_L; Shoulder_R → UpperArm_R → Forearm_R → Hand_R → RacquetSocket)` 及 `Hips → (Thigh_L → Shin_L → Foot_L; Thigh_R → Shin_R → Foot_R)`；中心柱骨骼保持零 roll，确保 WP2 对 `Chest` 施加 `scale.set(shoulderScale, 1, zScale)` 时精准沿左右 `X` / 前后 `Z` 缩放。
- **6 个独立可切换节点**（均通过 `parent_set(type="BONE", keep_transform=True)` 精确绑定对应骨骼，未并入 `Avatar_Body`）：`Headgear_Headband`（`HeadgearSocket`）、`Headgear_Visor`（`HeadgearSocket`，帽檐朝 `-Z`）、`Headgear_CapBackwards`（`HeadgearSocket`，帽檐朝 `+Z`）、`Wristband_L`（`Forearm_L`）、`Wristband_R`（`Forearm_R`）、`Racquet`（`RacquetSocket`，位于 `+X` 右侧，含握把、Y 型拍喉、流线拍框与 9×11 交叉 3D 球线网面）。
- **14 组材质**：精确包含 10 个运行期换色材质（`Mat_JerseyPrimary`、`Mat_JerseyAccent`、`Mat_Shorts`、`Mat_Skin`、`Mat_Hair`、`Mat_Socks`、`Mat_ShoeUpper`、`Mat_ShoeSole`、`Mat_RacquetFrame`、`Mat_RacquetStrings`）及 4 个静态细节材质（`Mat_EyeWhite`、`Mat_EyeIris`、`Mat_FaceDetail`、`Mat_RacquetGrip`）。
- **8 条嵌入式 NLA 动画（0 条 `scale` 轨道）**：使用 `FPS = 100` 与 `export_optimize_animation_keep_anim_armature=False` 导出 `idle`（`1.20 s`）、`run`（`0.56 s`）、`slide`（`0.50 s`）、`serve_toss`（`0.35 s`）、`forehand`（`0.36 s`）、`backhand`（`0.36 s`）、`lob`（`0.40 s`）、`celebrate`（`1.00 s`），仅包含骨骼旋转与 `Hips` 位移轨道，**骨骼 `scale` 轨道严格为 `0`**。

---

## 2. 验收项逐条自测结果（对应 SPEC `AC-11` 与 `CONTRACT.md` §4.2）

| 核验项 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| `.glb` 文件体积（`≤ 350 KB`） | `verify_glb.py` + 文件系统实测 | **`337.85 KB`**（达标） | [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/verify_glb.json) |
| 三角面数（单角色 `3,500–7,500`、总计 `≤ 9,000`） | `verify_glb.py` 解析 glTF accessors | 单角色可见：`power=5,068` / `allcourt=4,788` / `serve_volley=4,920` / `defender=4,804`；全文件总计 **`5,584`** | [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/verify_glb.json) |
| 单角色 Draw Calls 估算（`≤ 18`） | `verify_glb.py` 统计可见 mesh primitives | 最坏可见组合（`power`）= **`17`**（`Body 11 + Headband 1 + Wristband_L 1 + Wristband_R 1 + Racquet 3`） | [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/verify_glb.json) |
| 21 骨层级 & 6 个独立挂载节点 | `verify_glb.py` 校验 `nodes` 父子树 | 21 骨全匹配；6 节点独立挂于对应 Socket/骨骼且均含独立 `mesh` | [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/verify_glb.json) |
| 10 个必需换色材质 + 4 静态材质 | `verify_glb.py` 校验 `materials` | 10/10 必需材质全部精确存在（总材质数 14） | [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/verify_glb.json) |
| 8 条 NLA 动画 & `0` 条 `scale` 轨道 | `verify_glb.py` 遍历 `animations.channels` | 8/8 Clip 名称与时长精确匹配，`scale_channels_count = 0` | [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/verify_glb.json) |
| 尺寸、接地与朝向（`-Z` 正面、`+X` 持拍） | `verify_glb.py` 世界矩阵变换包围盒 | `height_m = 1.7566 m`、`min_y_m = 0.0 m`、`visor_min_z = -0.214`、`cap_max_z = 0.224`、`racquet_center_x = +0.6766` | [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/verify_glb.json) |
| 日光摄影棚多角度渲染与肉眼审查 | Blender 5.2 EEVEE 实导 `.glb` 渲染 + `read_file` 逐张审查 | 6 张预览图无关节黑缝、无穿模、五官清晰神采自然、4 流派服饰/头饰/肩宽体型差异鲜明、发球/正手动作舒展 | [01_front_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/01_front_full.png), [02_back_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/02_back_full.png), [03_closeup_face_upper.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/03_closeup_face_upper.png), [04_closeup_shoes.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/04_closeup_shoes.png), [05_action_forehand_and_serve.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/05_action_forehand_and_serve.png), [06_archetypes_lineup.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/06_archetypes_lineup.png) |
