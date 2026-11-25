# 🍬 糖果塔防对战（Candy TD Battle）V1

面向情侣与双人好友的 PC 桌面浏览器轻量级高颜值实时 1v1 策略塔防对战游戏（附带单人 AI 陪练模式）。

## 快速启动

```bash
npm install
npm start
```

默认监听 `http://127.0.0.1:3000`（支持环境变量 `PORT` 覆盖，例如 `PORT=3100 npm start`）。

### 测试模式与自动化测试

- **运行自动化单测与 WS 协议集成测试**：
  ```bash
  npm test
  ```
- **开启受控测试钩子启动服务端**（仅测试验收使用，生产模式严禁开启）：
  ```bash
  npm run start:test
  ```
  浏览器访问 `http://127.0.0.1:3000/?test=1` 即可挂载 `window.__CANDY_TEST__`（需同时满足服务端 `CANDY_ALLOW_TEST_HOOKS=1` 与 URL `?test=1` 双门控）。
- **性能诊断浮层**：在任意局 URL 后附加 `?netdebug=1` 显示 `FPS / Render(ms) / RTT(ms) / ServerTick(ms) / DPR / Entities`。

## 玩法要点

1. **建塔防御（快捷键 `1-4`）**：草莓豆豆炮（单体速射）、薄荷冰淇淋（溅射减速，Lv3 附带 +15% 易伤）、焦糖爆米花（群体 AOE）、柠檬破甲狙（专克太妃硬糖与婚礼蛋糕王）。
2. **派怪运营（快捷键 `Q/W/E/R/T/F`）**：派怪给对手同时永久提升己方每 6 秒发薪的 `Eco` 数值。
3. **3 秒糖果快递 & 虚晃假动作**：狂欢箱 / Boss 空投与虚晃快递在 3 秒内对防守方呈现完全一致的粉车预警（WS 报文在前 60 ticks 严禁下发真假字段）。假动作到达后喷彩带造成 `0` 伤害，进攻方稳赚 `+5 Eco`。
4. **防误触偷看对手**：鼠标移入右侧「👀 偷看对手」热区（与棋盘保留 60px 安全隔离带）或按住 `Space` 键平滑查看对手阵地；偷看期间严格禁用己方建塔点击。

## 子路径反向代理部署

前端资源均采用相对路径，WebSocket URL 自动依据 `window.location` 推导（例如部署于 `https://example.com/candy-td/` 时自动连接 `wss://example.com/candy-td/ws`），服务端兼容带前缀与剥离前缀的 `/ws` 升级请求。
