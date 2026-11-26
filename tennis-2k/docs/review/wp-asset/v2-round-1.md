结论：FAIL
候选版本：feat/v2-wpasset @ 534ac17f44e072d64e75bba5c08df1e070f6d94b（基点 2f6c96fae70e9b6040c54ef7a23221513a3f8c23；tennis_player.glb SHA256 F05A44E69B747BDC573E8E368EC7D7470FFB75FB99885424369E29D883D8177B）
本轮核验方式：代码审（generate_player_avatar.py / verify_glb.py / render_previews.py / README.md）+ 独立 Blender 5.2.3 LTS CLI 无头复现导出与哈希比对 + 独立 Python glTF 2.0 二进制结构解析 + 逐张审查 Builder 6 张预览图与 2 张独立补充角度/动作渲染图（无需 Tester）

达标项：
- [版本与写边界] `HEAD === 534ac17f44e072d64e75bba5c08df1e070f6d94b`，工作区洁净，diff 严格限于 `tennis-2k/assets/source/**`、`tennis-2k/client/public/assets/models/tennis_player.glb` 与 `tennis-2k/docs/review/wp-asset/**`，零 `.blend` / `.pyc` / `__pycache__` 残留。
- [确定性复现] 独立执行 `blender.exe --background --python tennis-2k/assets/source/generate_player_avatar.py -- --output <临时路径>` 成功导出且与入库 `.glb` 逐字节一致（SHA256 均为 `F05A44E69B747BDC573E8E368EC7D7470FFB75FB99885424369E29D883D8177B`，`345,960 B` / `337.85 KB ≤ 350 KB`）。
- [CONTRACT §4.2 二进制结构契约] 独立解析 `tennis_player.glb` 验证全部硬性指标达标：
  - 21 根骨骼命名与父子层级 100% 精确匹配，`Chest` 本地坐标轴在 glTF Y-up 空间严格对齐世界 `(1,0,0)/(0,1,0)/(0,0,1)`（支持 WP2 `shoulderScale`）；
  - 1 个 `SkinnedMesh`（`Avatar_Body`，0 个 NaN 顶点，蒙皮权重严格归一 `max_w_err = 0.00000`）；
  - 6 个独立可切换网格节点（`Headgear_Headband`/`Headgear_Visor`/`Headgear_CapBackwards`/`Wristband_L`/`Wristband_R`/`Racquet`）均正确挂载于契约指定骨骼且材质槽映射准确；
  - 10 个必需运行期换色材质 + 4 个静态细节材质齐全；
  - 8 条动画 Clip（`idle` 1.20s、`run` 0.56s、`slide` 0.50s、`serve_toss` 0.35s、`forehand` 0.36s、`backhand` 0.36s、`lob` 0.40s、`celebrate` 1.00s）齐全，骨骼 `scale` 轨道严格为 `0`，非 `Hips` 位移轨道为 `0`；
  - 单角色可见三角面 `power=5,068` / `allcourt=4,788` / `serve_volley=4,920` / `defender=4,804`（均落于 `3,500–7,500`），全文件 `5,584 ≤ 9,000`，最坏可见 Draw Calls `17 ≤ 18`；
  - 总高 `1.7566 m`（满足 `1.75–1.80 m`）、接地 `minY = 0.00000 m`（`|minY| ≤ 0.01 m`）、正面 `-Z`（`Visor minZ = -0.214`、`CapBackwards maxZ = +0.224`）、右手持拍 `+X`（`Racquet centerX = +0.6766`）。

返工项（FAIL 时填写）：

【问题 1（必须）：三款流派头饰与头发严重穿模，且反戴鸭舌帽/遮阳帽造型失真】
- 现象与证据：
  - 证据：[06_archetypes_lineup.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/06_archetypes_lineup.png)、[05_action_forehand_and_serve.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/05_action_forehand_and_serve.png) 与独立 3/4 近景渲染 [headgear_closeup.png](file:///C:/Users/Barry/.gemini/antigravity/brain/dd94d2f2-1c22-4a57-b5ae-9e51b219d4ee/scratch/renders/headgear_closeup.png)。
  - `Headgear_CapBackwards` 帽冠最高仅 `Y = 1.724 m`，无法包裹高达 `1.757 m` 的发顶尖簇与前刘海，导致 **6 根粗刘海与 3 根发顶尖刺直接刺穿帽冠正面与顶部**；帽檐过于扁平僵直。
  - `Headgear_Visor` 帽带横穿前额刘海，帽檐外径达 `0.210 m`、弧度跨度过宽（`0.20π–0.80π`）且厚度仅 `6 mm`，正面看呈突兀的飞碟状薄片横伸出双耳外侧。
  - `Headgear_Headband` 直接横向截穿额前刘海。
- 影响：大厅 3D 预览切换四流派时，3 款头饰肉眼可见严重穿模，直接破坏角色精致度与流派辨识度。
- 修改方向：
  - 统一协同设计发型与 3 款头饰的空间包络：适当收敛发顶尖刺高度，使 `Headgear_CapBackwards` 帽冠完整、自然包覆头顶发块（绝不破顶穿模），仅允许额前/耳侧自然发梢从帽沿下方露出，并为反戴帽檐增加自然弧度与合理厚度；
  - `Headgear_Visor` 收窄左右张角与外伸长度（仅覆盖前额扇区，不横伸出太阳穴两侧），增加运动遮阳帽特有的前倾弯曲弧面与厚度，调整帽带与额前刘海高低分层避免互相穿插；
  - `Headgear_Headband` 贴合额头位置并与刘海自然分层过渡（例如刘海位于发带上方或贴额顺滑避让，避免硬切穿模）。
- 下轮验收标准：3/4 近景与正面渲染图中，3 款头饰（`Headband`/`Visor`/`CapBackwards`）与发型、头部均实现 0 穿模、轮廓比例协调自然。

【问题 2（必须）：面部五官与发型观感粗糙怪异，未达到 Mario Tennis / Switch Sports 风格化颜值水准】
- 现象与证据：
  - 证据：[03_closeup_face_upper.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/03_closeup_face_upper.png)、[01_front_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/01_front_full.png)、[02_back_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/02_back_full.png) 与 [headgear_closeup.png](file:///C:/Users/Barry/.gemini/antigravity/brain/dd94d2f2-1c22-4a57-b5ae-9e51b219d4ee/scratch/renders/headgear_closeup.png)。
  - **发型**：前额 6 根独立低模管状刘海呈“香蕉/触手”状垂挂、切面生硬；侧面耳前太阳穴存在大块秃斑断层，耳下可见黑色暗角杂面；背面看呈光滑圆球顶着三根孤立尖刺。
  - **五官**：眼白/虹膜/瞳孔/高光作为多层外凸椭球叠加于脸面，3/4 视角明显前凸如“金鱼眼”；平直浮空眉条与眼睫使正面神态偏呆滞委屈；颈部细长直筒且与下颌过渡生硬，略显“棒棒糖/木偶”感。
- 影响：V2 美术重构的核心目标正是解决用户反馈的“人物太丑”，当前头脸与发型近景观感依然显粗糙、不够阳光讨喜。
- 修改方向：
  - 重构发型为包裹完整发际线与两侧鬓角的流畅一体化风格化发罩 + 柔和贴合额面的层次发丝块（消除独立管状悬空刘海、太阳穴秃块、耳下黑角与背面突兀三尖刺）；
  - 五官改用紧贴面部曲面的扁薄弧面眼部构造（消除侧面外凸感），优化眼型、眉形角度（略带阳光自信弧度）、鼻梁与微笑比例；适度缩短增粗颈部并柔和下颌-颈部过渡曲线，使头身比更贴近 *Mario Tennis / Switch Sports* 的清爽健康运动风。
- 下轮验收标准：正面、背面与 3/4 近景图中，五官贴脸无凸眼、神态清爽阳光、发型包裹完整有层次且无秃块/杂面。

【问题 3（必须）：身体肩腋/胯部仍为管状硬插拼装，抬臂与跑动时出现明显尖刺拉扯与短裤穿帮，且球鞋造型过于简陋】
- 现象与证据：
  - 证据：[01_front_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/01_front_full.png)、[03_closeup_face_upper.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/03_closeup_face_upper.png)、[04_closeup_shoes.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/04_closeup_shoes.png)、[05_action_forehand_and_serve.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/05_action_forehand_and_serve.png) 与独立动作渲染 [extra_clips.png](file:///C:/Users/Barry/.gemini/antigravity/brain/dd94d2f2-1c22-4a57-b5ae-9e51b219d4ee/scratch/renders/extra_clips.png)。
  - **肩部/腋下畸变**：躯干与双臂为独立封口管状体硬插（`generate_player_avatar.py` L351–460），静态可见肩袖硬切接缝；在 `celebrate`（`extra_clips.png` 最左）和 `serve_toss`（`05_action_forehand_and_serve.png` 左）举臂动作中，**双肩腋下外侧向外拉扯出尖锐三角形破面尖刺**。
  - **短裤/骨盆穿帮**：躯干底部平封口盒在 `serve_volley` 白裤正面（`05_action_forehand_and_serve.png`、`06_archetypes_lineup.png`）与背面（`02_back_full.png`）透出明显的方形深色阴影块；`run`/`slide`（`extra_clips.png`）中大腿前抬时胯部短裤出现硬切错位感。
  - **球鞋与肢体细节**：`04_closeup_shoes.png` 显示球鞋呈单调白块木屐/拖鞋状（无鞋舌、鞋领口弧线、鞋带/分层中底造型），外侧仅贴有一颗孤立白色小椭圆点；小腿与手臂偏直筒木讷，手掌形体略僵硬。
- 影响：实战挥拍/发球/庆祝与跑动过程中肩部破面与短裤穿帮肉眼极易察觉，违背 SPEC `AC-11`“一体化平滑蒙皮、无关节黑缝/穿模”门槛。
- 修改方向：
  - 重做肩腋与骨盆-短裤连接拓扑及权重过渡（扩大 `Chest ↔ Shoulder ↔ UpperArm` 与 `Hips ↔ Thigh` 平滑过渡区、消除手臂上举时的尖锐顶点拉扯，移除透出短裤外的躯干硬底盖面使短裤裆部平滑连贯）；
  - 精细化网球运动鞋轮廓（分层鞋底/中底、鞋口脚踝弧度、鞋舌与撞色条纹/鞋带色块，去掉侧面孤立小白豆）并自然刻画肩臂、小腿肌理与握拍手势。
  - **体量/Draw Call 提醒**：当前 `.glb` 已达 `337.85 KB / 350 KB`、最坏 Draw Calls 已达 `17 / 18`；请避免新增材质槽，并可通过适当优化动画采样帧步长（如保持精确起止时长同时降低冗余采样密度）为更精细的网格留出充足字节余量。
- 下轮验收标准：`celebrate`、`serve_toss`、`run`、`slide` 极限动作下肩腋与短裤零尖刺拉扯、零方形封口穿帮；鞋袜近景呈现清晰的运动网球鞋层次感；同时仍严格满足 `≤ 350 KB`、`3,500–7,500` 可见面数、`≤ 18` Draw Calls。

【问题 4（必须）：多段核心网球动画姿态失真，且 `forehand` / `serve_toss` / `celebrate` 存在球拍穿脸/穿头穿模】
- 现象与证据：
  - 证据：[01_front_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/01_front_full.png)、[05_action_forehand_and_serve.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1/05_action_forehand_and_serve.png) 与 [extra_clips.png](file:///C:/Users/Barry/.gemini/antigravity/brain/dd94d2f2-1c22-4a57-b5ae-9e51b219d4ee/scratch/renders/extra_clips.png)。
  - `forehand`（`05_action_forehand_and_serve.png` 右）：双臂平行前伸，**球拍拍框直接横切面部遮挡鼻眼**，缺乏转髋拉拍与侧前舒展挥拍轨迹。
  - `serve_toss`（`05_action_forehand_and_serve.png` 左）：持拍臂后翻过近导致**球拍直接穿插/贴死于脑后及遮阳帽**，下肢直立缺乏蓄力感。
  - `celebrate`（`extra_clips.png` 最左）：双臂在头顶向内交叉，**球拍与左臂/头部严重穿模**。
  - `backhand`（`extra_clips.png` 左二）：躯干直立、右臂侧平举，不像网球跨步转体反手挥拍；`idle`（`01_front_full.png`）双脚并拢过窄、左手外摊僵硬，缺乏网球经典开立微蹲准备姿。
- 影响：待机、发球、正反手挥拍与胜利庆祝均为高频核心画面，球拍穿头/打脸与僵硬动作会严重损害真实对战观感。
- 修改方向：
  - 系统校准全部 8 段动画的关节角度与重心：`idle` 改为双脚自然开立微蹲、右手斜举球拍于身前、左手自然靠近拍喉或收于腹前；`forehand`/`backhand` 增大转体与侧前方挥拍外展空间，确保球拍全程远离头脸与躯干；`serve_toss` 将右臂拉拍外展至头侧后方安全距离并配轻微屈膝抛球；`celebrate` 改为双臂斜上打开欢呼避免头顶交叉穿拍。
  - 请在 `render_previews.py` 中新增覆盖 `run`/`slide`/`backhand`/`celebrate` 以及 `Visor`/`CapBackwards` 3/4 近景的渲染输出，下轮作为必查证据一并提交。
- 下轮验收标准：8 条动画（重点核查 `idle`/`run`/`slide`/`serve_toss`/`forehand`/`backhand`/`celebrate`）姿态舒展符合真实网球运动力学，全程零球拍穿头/穿脸/穿身与双臂交叉穿模，且仍保持 0 条骨骼 `scale` 轨道。

阻塞项（BLOCKED 时必填）：
- 无

规格层面问题（如有）：
- 轻微口径提示（非阻塞）：`SPEC.md` §3.5 写“身高 `1.78 m`”、本轮评审提示写 `1.74–1.80 m`，而 `CONTRACT.md` §4.2 写 `1.75–1.82 m`；建议资产持续保持在公共交集 **`1.75–1.80 m`** 内（本轮为 `1.7566 m`），可同时满足全部文档口径。

未验证项（非门槛 / 环境限制）：
- Three.js `GLTFLoader` / `SkeletonUtils.clone()` 真实浏览器 WebGL 渲染、双人同屏 Draw Calls、JS+CSS/总 gzip 体积与 120Hz FPS 由下游 WP2（`client`）与 `integration/v2` 在浏览器实机中验收。

给用户的摘要：WP-Asset V2 第 1 轮在底层技术契约上全部达标（`.glb` 体积 337.85 KB、21 根骨骼、6 个独立挂点、14 组材质、8 段无 scale 轨道动画均确定性可复现），但在美术颜值与穿模把关上未过关。逐张核查预览图与补充动作特写发现：反戴鸭舌帽和遮阳帽与头发严重穿模、五官外凸且管状刘海观感较粗糙、举臂与跑动时肩腋出现尖刺畸变且短裤穿帮，同时正手/发球/庆祝动作存在球拍穿脸或穿头问题。已判 FAIL 并退回 Builder，针对发型头饰、面部精致度、肩胯平滑蒙皮、流线球鞋与网球动作姿态给出明确返工要求。

Obsidian 一行摘要：FAIL / WP-Asset R1 技术契约全过但头饰穿模、五官发型粗糙、举臂肩刺短裤穿帮及挥拍穿头未达颜值标准 / 退回 Builder 专项精修造型、蒙皮权重与动作姿态后复验
