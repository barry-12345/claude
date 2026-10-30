# 黄金矿工 排行榜服务端

- 运行: `npm ci && npm start`(默认 `127.0.0.1:8787`,数据在 `./data/scores.db`,环境变量见 SPEC-phase3 §2.1)
- 测试: `npm test`(node:test,约 15 秒;需要 `better-sqlite3`,可选 nginx / shellcheck / systemd-analyze / playwright,缺少时对应用例自动 skip)
- 管理: `node admin.js list|delete|rename|archive|clear`
- 备份: `node scripts/backup.js [--db --out --keep-days --now]`
- 前端客户端模块: `client/leaderboard-client.js`,集成说明见 `client/INTEGRATION.md`
- 部署: 见 `../deploy/DEPLOY.md`
