# 开发与测试

需要 Node 24、npm 和原生 SQLite 驱动支持。生产仅一个 Node 应用；开发时可用 Vite 热更新。

```sh
npm ci
cp .env.example .env
npm run admin -- init
npm run build
npm start
```

首页 http://localhost:3000；后台 /manage。APP_ORIGIN 需与地址栏的协议、主机、端口完全一致，localhost 与 127.0.0.1 不等同。

热更新：在 .env 中改 APP_ORIGIN=http://localhost:5173，两个终端分别 `npm run dev` 和 `npm run dev:client`，访问 5173。Vite 代理 API；生产不运行 Vite。

```sh
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium-headless-shell
npm run test:e2e
```

API 测试使用临时或内存数据库，不接触运行数据。浏览器测试独占 3000 端口及 data/acceptance.db，只写虚构内容、临时测试账号，结束后删除管理员和所有会话。不要把真实数据放入验收库。测试模式仅用于隔离测试，不得作为生产 NODE_ENV。

测试截图位于 docs/evidence；trace 和机器报告在 test-results（Git 忽略）。CI 使用 Playwright 管理的 headless shell；可通过 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定本地兼容浏览器。

目录：src/client 是界面，src/server 是 API/数据库/CLI，src/shared 是类型；tests 是行为验收；deploy 是未执行部署示例。更改数据库结构应增加新版本迁移并先做备份，不编辑已经发布的迁移。
