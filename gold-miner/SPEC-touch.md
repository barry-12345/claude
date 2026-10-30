# 黄金矿工 · 第 2.5 阶段实现规格:触屏 / 手机支持 (SPEC-touch) · 已获用户批准

> 状态:**已获用户批准**。本文件是实现和验收的唯一依据,取代草案 `PLAN-touch.md`。
> 顺序:第二阶段(`SPEC-phase2.md`)验收通过后、第三阶段(排行榜)之前实现。
> 用户原始需求:"我希望我的朋友们可以在手机上玩,所以也增加触屏版功能给手机用户"。

## 0. 用户已批准的决策(必须遵守)

| # | 决策 | 落实位置 |
|---|---|---|
| U1 | **手机版只有单人模式**("手机版只有单人模式") | 全文 |
| U2 | 触屏设备上对战和合作**完全隐藏**,不是置灰 | §2 |
| U3 | 接了实体键盘的平板**也不开放**双人模式。触屏设备永远只有单人 | §1、§2 |
| U4 | 触屏界面**放大游戏中的文字** | §5 |
| U5 | 不做任何双人触屏设计:左右分区点按、两人多点触控、拔河狂点都不做 | §6 |
| U6 | 键盘玩法不变;手机玩家只会出现在单人排行榜 | §10、§11 |

---

## 1. 设备识别

```js
const mq = q => window.matchMedia && matchMedia(q).matches;
const TOUCH_UI = /[?&]touch=1/.test(location.search) ? true
               : /[?&]touch=0/.test(location.search) ? false
               : mq('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && !mq('(any-pointer: fine)'));
```

- 页面加载时计算一次,存到 `G.touchUI`,之后不再变化。测试可以用 `__game.setTouchUI(bool)` 切换,只在 start 屏有效。
- **手机、平板(包括接了键盘的平板)**:`G.touchUI === true`,只有单人(U3)。收到键盘输入**不会**解锁双人模式。
- **电脑、触屏笔记本、二合一电脑**:主指针是鼠标或触控板,`G.touchUI === false`。界面和三个模式和第二阶段完全一样。如果用户点按屏幕也接受:按钮可以点,场地点按 = 发射;但不画触屏专用的按钮和放大字号。

## 2. 主菜单(触屏界面)

- **只显示单人一张卡片**:居中,宽 760、高 120(游戏坐标),写"单人模式 · 一人独占矿场",下方显示单人最佳纪录。对战和合作卡片**完全不画**,也没有任何提示文字(U2)。
- 在触屏界面下,`G.mode` 只能是 `'solo'`:
  - `MENU_ORDER` 在触屏界面下视为 `['solo']`,`G.menuMode` 固定为 0;
  - 按 `Digit2/3`、`Numpad2/3`、←/→/A/D 都不会切换模式;
  - `localStorage['goldminer.mode']` 不管存的是什么,触屏界面下都当作 `'solo'`,也**不改写**这个值,换回电脑时仍然记得原来的选择;
  - 暂停菜单的"重新开始"、终局的"再来一局"仍然是单人。
- 规则面板只显示 `RULES.solo`;标题旁的小字显示"单人"。
- 操作说明改为:"点按屏幕 发射钩子 · 炸药按钮 使用炸药 · 暂停按钮 暂停"。
- 图鉴:"图鉴 ▶"按钮点按翻页,相当于 Tab。

## 3. 视口与手势

- viewport:`<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">`
- 另加 `<meta name="apple-mobile-web-app-capable" content="yes">` 和 `<meta name="mobile-web-app-capable" content="yes">`。
- CSS:
  - `html, body, canvas { touch-action: none; overscroll-behavior: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }`;
  - `body { position: fixed; inset: 0; }`。
- JS:
  - 画布上的 `touchstart / touchmove / touchend` 用 `{ passive: false }` 监听,并调用 `preventDefault()`;
  - `gesturestart / gesturechange / dblclick` 调用 `preventDefault()`;
  - 所有点按都用 `pointerdown` 触发,不用 `click`。
- **全屏按钮**(只在触屏界面显示,右上角):
  - 调用 `document.documentElement.requestFullscreen({ navigationUI: 'hide' })`;成功后尝试 `screen.orientation.lock('landscape')`,失败就忽略。
  - 浏览器没有 `requestFullscreen` 时(例如 iPhone Safari),不显示这个按钮,改为在主菜单底部显示小字"添加到主屏幕可全屏游玩"。

## 4. 屏幕方向:必须横屏

- 竖屏(`innerHeight > innerWidth`)时盖上全屏遮罩:旋转手机图标 + "请横屏游玩",并设 `G.portrait = true`。
  - 如果在 intro 或 play 屏,自动 `pauseGame()`;
  - 转回横屏后遮罩消失,停在暂停菜单,由玩家点"继续"。
- 不做竖屏布局。原因:
  1. 游戏按 1280×720 设计,竖屏缩放只有约 0.29,字号会小到 3–4 px;
  2. 竖屏布局需要改场地几何(绞盘、摆角、可达范围),会让第二阶段校准好的难度和排行榜分数失去可比性;
  3. 钩子玩法靠横向角度,横屏视野更合适。

## 5. 缩放、安全区与放大文字

**缩放与安全区**
- 读取 `env(safe-area-inset-left/top/right/bottom)`:用一个隐藏 div 设 `padding: env(...)`,再读它的计算样式。测试时可以用 `?safe=左,上,右,下`(px)覆盖。
- 可用区域 = 视口减去安全边距;缩放 `s = min(可用宽/1280, 可用高/720)`;画布在可用区域内居中,其余部分填充背景色。
- DPR 上限仍是 2,另加自适应降级(§9)。

**目标机型**(横屏,逻辑像素)

| 机型 | 视口 | 安全区左/右 | 缩放 s |
|---|---|---|---|
| iPhone SE / 8 | 667×375 | 0 / 0 | 0.52 |
| iPhone 13 / 14 | 844×390 | 47 / 47 | 0.54 |
| Pixel 7 | 915×412 | 0 / 0 | 0.57 |
| iPhone 14 Pro Max | 932×430 | 59 / 59 | 0.60 |

**触摸目标**
- 每个触屏按钮的命中区域至少 88×88 游戏像素。在最小缩放 0.52 下约等于 46 CSS px,满足 ≥ 44 CSS px。

**放大文字(U4)**
- 触屏界面用一套放大字号的绘制参数 `TOUCH_FONT`,只在 `G.touchUI` 为真时生效:

  | 文字 | 电脑版(游戏像素) | 触屏版(游戏像素) | 0.52 缩放下约合 CSS px |
  |---|---|---|---|
  | 金币、目标、倒计时、本关收入 | 18–28 | **≥ 30** | ≥ 15.6 |
  | 星级说明、加成名、炸药数、商店价格、商品名 | 11–16 | **≥ 22** | ≥ 11.4 |
  | 商品说明、规则正文、结算明细 | 12–15 | **≥ 20** | ≥ 10.4 |
  | 物品上的飘字(+$X、"差一点!"等) | 22–38 | **≥ 28** | ≥ 14.6 |

- 所有 intro、play、results、shop、final、暂停屏幕上的文字,最小字号 ≥ 20 游戏像素。
- 为了放得下放大的文字,触屏 HUD 做以下调整:
  - 左面板只保留头像、金币、进度条、炸药数,加成图标改为一排小图标,不写文字;
  - 中面板显示关数、目标、倒计时;
  - 右面板显示本关收入和三颗星,星级说明放大后换成两行;"纪录同期"缩写为"纪录 $X"。
- 实现方式:所有文字都经过 `T()` / `TW()` 绘制。在触屏界面下给它们传入放大后的字号;同时记录本帧用过的最小字号 `G.minFont`(只统计上面这些屏幕,用来验收)。

## 6. 游戏中的触屏操作(单人)

| 操作 | 方式 |
|---|---|
| 发射钩子 | 点按画面任意位置(按钮除外),`pointerdown` 时立即调用和 `KeyS` 相同的处理 |
| 炸药按钮 | 天空带左侧,游戏坐标 (40, 92) 起,120×90。显示炸弹图标和剩余数量;只有正在拉回物品时可用,不可用时置灰。点按调用和 `KeyW` 相同的处理 |
| 暂停按钮 | 天空带右侧,游戏坐标 (1150, 92) 起,100×90,调用和 `KeyP` 相同的处理 |
| 全屏按钮 | 暂停按钮左边,(1040, 92) 起,100×90(只在支持全屏时显示) |
| 位置原则 | 按钮都在 HUD 面板下方、矿场上方(y < 190),**不压住矿场**。点矿场永远是发射 |
| 多点触控 | 每个 `pointerId` 独立处理;只有 `pointerdown` 触发操作,`move/up` 不触发。一根手指按住场地时,另一根手指点炸药按钮也必须生效 |

不做双人触屏(U5)。

## 7. 菜单点按

先做一个统一的点击区域表:绘制时用 `UI.btn(id, x, y, w, h, onTap)` 登记,每帧重建;`pointerdown` 时把坐标换算成游戏坐标,再按登记顺序的**逆序**命中(后画的在上层)。`onTap` 调用和按键**相同的处理函数**,或者合成同一个按键码。按钮命中区域 ≥ 88×88(§5)。

| 屏幕 | 点按操作 |
|---|---|
| 主菜单 | 点单人卡片 → 进入角色选择(等价于空格);"图鉴 ▶" → 翻页;全屏按钮 |
| 角色选择 | 点角色卡片 → 选中;再点同一张卡片,或者点"开始"按钮 → 确认,0.8 秒后自动开始;"立即开始"等价于空格;"返回"等价于 Esc |
| intro | 点任意位置 → 跳过 |
| 结算 | "继续"按钮,0.4 秒后可以点,等价于空格 |
| 商店 | 点商品卡片 → 选中;再点已选中的卡片,或者点"购买"按钮 → 购买;刷新卡同理;"准备好了":第一次点进入"已准备"(和第二阶段键盘的二次确认一样,1.5 秒内有效),第二次点开始下一关 |
| 暂停菜单 | 每一行都能点(继续 / 重新开始 / 主菜单),另有"声音 开/关"(对应 M 键)和"特效 开/关"(对应 V 键)两个开关 |
| 终局 | "再来一局"(等价于空格)和"主菜单"(等价于 Esc)两个按钮 |

## 8. 声音解锁(iOS Safari)

- 第一次 `pointerup` / `touchend` 时调用 `Snd.init()`、`ctx.resume()`,并播放 1 帧静音 buffer,用来解锁 iOS。
- 页面在 `visibilitychange` 时:隐藏 → `suspend`;显示 → `resume`,但游戏处于暂停状态时不恢复。
- 解锁之前跳过所有音效,不报错。

## 9. 性能

- **目标**:中端手机(Pixel 6a / iPhone 11 级别),游戏中帧率中位数 ≥ 55 fps。逻辑是固定步长,掉帧不影响结果。
- **DPR 自适应**:
  - 起点 `min(devicePixelRatio, 2)`,对应 `G.dprLevel = 2`;
  - (验收第 3 轮修订)只统计游戏中的帧,每回合前 1 秒、降档后 0.5 秒不计:2 → 1.5 需连续两个 2 秒窗口的 25 分位帧时间 > 22 ms;1.5 → 1 只需一个窗口中位数 > 22 ms;若一个窗口 90% 的帧 > 22 ms 且中位数 > 30 ms 则立即降档。不用平均值(少数长帧会拉高平均值);降档时重建背景缓存,原因记在 `G.dprReason`;
  - 不会自动升回。
- 触屏界面下粒子总数上限 300;"特效关"时再减半。页面隐藏时停止渲染。

## 10. 键盘与回归

- 键盘玩法不变。触屏界面下按键盘也能玩单人,但永远不会出现双人(U3)。
- `G.touchUI === false` 时,画面、菜单和三个模式都和第二阶段完全一样。
- 触屏代码只调用现有的处理函数,不改游戏逻辑,不新增 `Math.random()` 调用;第二阶段的回归测试必须仍然通过。

## 11. 第三阶段提示:手机上输入名字

- 名字输入用真实的 DOM `<input>`:不设 `maxlength`(它按 UTF-16 计数，会截断输入法拼写中的字、把 emoji 算两个)，改为在 input 事件里用 `lbClampName` 按码点截断到 12 个字;`enterkeyhint="done"`、`autocomplete="off"`、`autocapitalize="off"`。
- 输入浮层固定在可视区域顶部:监听 `visualViewport` 的 `resize` / `scroll`,设 `top = visualViewport.offsetTop + 8`。浮层高度 ≤ 可视高度的 40%,保证输入框、"提交"和"跳过"都不会被系统键盘挡住。
- 提交后 `input.blur()` 收起键盘,并把页面滚回原位。
- 手机只玩单人,所以只会提交单人成绩(U6),第三阶段不需要为此做特殊处理。

## 12. 可测试性要求

- `G.touchUI`、`G.portrait`、`G.dprLevel`、`G.minFont`。
- `__game.setTouchUI(bool)`:只在 start 屏有效。
- `__game.uiButtons()`:返回当前帧所有已登记按钮 `[{ id, x, y, w, h }]`(游戏坐标)。
- `__game.safeInsets()`:返回当前使用的安全边距。
- URL 参数 `?touch=0|1`、`?safe=l,t,r,b`。

## 13. 量化验收标准

全部在 Playwright 里完成,使用设备描述 `devices['iPhone 13 landscape']`、`devices['Pixel 7 landscape']`(`hasTouch: true, isMobile: true`)。点按用 `page.touchscreen.tap(x, y)`;多点触控用 CDP `Input.dispatchTouchEvent`。按钮的屏幕坐标由 `__game.uiButtons()` 的游戏坐标乘以缩放、再加画布偏移得到。

| # | 验收项 | 通过标准 |
|---|---|---|
| T-01 | 设备识别 | iPhone 13 和 Pixel 7 模拟下 `G.touchUI === true`;桌面 Chromium(无触屏)下为 `false`;`?touch=0` 和 `?touch=1` 能强制切换 |
| T-02 | **纯触屏整局** | iPhone 13 横屏,`?fast=1&seed=3`。只用 `touchscreen.tap`,不按键,不调用 `__game` 的任何函数(只允许读 `G` 和 `uiButtons()` 做判断):点单人卡片 → 点角色 → 点"开始";游戏中每 600 ms 点一下场地;结算点"继续";商店点"准备好了"两次;一直到 `G.screen === 'final'`。零报错;`goldminer.soloBest` 写入成功;全程 `G.mode === 'solo'`。在 Pixel 7 上重复一次 |
| T-03 | 双人完全隐藏(U2) | 触屏界面主菜单:`uiButtons()` 里只有一张模式卡片(`mode-solo`);截图里没有"对战"和"合作"字样;在电脑版对战/合作卡片的位置点按 → `G.screen` 仍是 `start`,`G.mode` 不变;`localStorage['goldminer.mode'] = 'versus'` 时刷新 → 仍然只有单人,并且 localStorage 里的值没被改写 |
| T-04 | 接键盘也不开放(U3) | iPhone 13 模拟下,用 `page.keyboard.press` 依次按 `Digit2`、`Digit3`、`ArrowRight`、`KeyD`,再按 `Space` → 进入的选择页是单人(`G.mode === 'solo'`);整个过程中对战和合作都没有出现 |
| T-05 | 放大文字(U4) | 3 种视口(667×375、844×390、932×430)下,play、shop、results、final 屏各推进 1 秒:`G.minFont ≥ 20`;金币、目标和倒计时所用字号 ≥ 30;电脑版(`touchUI = false`)的字号和第二阶段相同(对比同一帧的 `G.minFont`) |
| T-06 | 按钮尺寸与安全区 | 3 种视口下,`uiButtons()` 中每个按钮的宽高换算成 CSS px 后都 ≥ 44;用 `?safe=47,0,47,21` 时,所有按钮和 HUD 文字都在安全区内 |
| T-07 | 点按发射延迟 | 在场地上 tap 后,下一帧内 `hook.state === 'extend'` |
| T-08 | 炸药和多点触控 | CDP 让触点 A 按住场地,同时触点 B 点炸药按钮(钩子正在拉回物品)→ `p.dyn` 减 1,物品被炸;触点 A 没有额外触发发射 |
| T-09 | 竖屏遮罩 | 视口 390×844 时出现"请横屏游玩"遮罩,`G.portrait === true`;游戏中切到竖屏 → `G.paused === true`;切回 844×390 → 遮罩消失,停在暂停菜单 |
| T-10 | 手势屏蔽 | 画布上派发的 `touchmove` 事件 `defaultPrevented === true`;画布计算样式的 `touch-action` 是 `none`;viewport meta 含 `user-scalable=no`;双击后 `visualViewport.scale === 1` |
| T-11 | 菜单全覆盖 | 用 tap 完成:图鉴翻 4 页;暂停菜单三项和两个开关(点"特效 关"后 `localStorage['goldminer.reduceFx'] === '1'`);商店选中、购买(金币减少等于价格)、刷新;终局"再来一局"(仍是单人)和"主菜单" |
| T-12 | 声音解锁 | 第一次 tap 之后 `Snd.ctx.state === 'running'`;解锁之前零报错 |
| T-13 | 性能 | Pixel 7 模拟,正常速度,单人第 4 关游戏中 20 秒:不限速时帧率中位数 ≥ 55;CDP `Emulation.setCPUThrottlingRate(4)` 时中位数 ≥ 40,并且至少降档一次(`G.dprLevel < 2`) |
| T-14 | 键盘不退化 | 桌面:第二阶段的 AC-P2-01、AC-P2-02、AC-P2-21 全部通过,三个模式都能进入;触屏模拟下按 `ArrowDown` 照样能发射 |
| T-15 | 截图 | 3 种手机尺寸各截 5 张:主菜单(只有单人卡)、角色选择、游戏中、商店、终局。中文无裁切、无重叠,按钮不压住 HUD 文字,文字明显比电脑版大 |

## 14. Builder 实施顺序(建议)

1. 设备识别、viewport/CSS/手势屏蔽、安全区和缩放。
2. 点击区域表 `UI.btn` + `pointerdown` 分发;主菜单只保留单人。
3. 游戏中的按钮和点按发射;多点触控。
4. 其它所有菜单的点按;竖屏遮罩;全屏;声音解锁。
5. 放大字号的 `TOUCH_FONT`,触屏 HUD 布局,`G.minFont` 统计。
6. DPR 自适应;粒子上限。
7. 写 T-01 到 T-15 的测试并自测;再跑第二阶段回归。
