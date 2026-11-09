# TextRelay 技术设计 v1.0

依据：[原 TRD](https://chatgpt.com/space/page_f4b7f6d0f238819191614f1af195fa3b)；原文快照见 source-trd-v0.4.md。最新用户指令覆盖原稿中的 Windows 路径和“当前仅设计”状态。

- Node 24、TypeScript、React 19、Vite、Fastify 5、better-sqlite3。一个 package.json、一个应用进程、一个 SQLite 文件；不使用 ORM、队列或独立数据库服务。
- SQLite 开启 WAL、foreign_keys、busy_timeout=1000、synchronous=FULL。迁移在 db.ts 内版本化执行并记录 schema_migrations，避免编译产物遗漏 SQL 文件。code 的 BINARY 唯一约束为最终裁决。
- code 使用 crypto.randomInt 从完整 62 字符集抽取；随机冲突有限重试 30 次；换码排除当前码。短写事务无 await。version 乐观锁保护编辑/换码/删除；409 提示重新加载。
- 每个管理路由通过 Fastify 已解析的 routeOptions.url 鉴权，避免编码路径绕过。服务端 JSON Schema 严格校验，不自动转换类型或静默删除额外字段。
- 密码：异步 scrypt N32768/r8/p3，16 字节随机盐，64 字节派生键，timingSafeEqual。登录和改密在异步计算后于事务中重新检查凭据状态，防止重置竞争。
- 会话：32 字节随机值的 SHA-256 摘要入库，固定 8 小时。Cookie HttpOnly / SameSite=Strict / Secure（仅本地 HTTP 例外）/ Path=/。退出、改密、重置删除会话。
- 写请求要求 JSON、自定义 X-TextRelay-Request:1、Origin 严格等于 APP_ORIGIN；Host 校验。不开放 CORS。正文不记录到日志，不进入 URL，API 结果 no-store，CSP 禁止内联脚本及被嵌套。
- 应用内 token bucket 提供单 IP 与全站限速，查询参数与编码路径同样计数。默认不信任 XFF；TRUSTED_PROXY 仅显式指定已知代理地址/CIDR，代理覆盖输入 XFF。数据库无需存失败计数。
- Fastify 仅服务 dist/client 内静态文件和显式 /、/manage、/manage/、/manage/login；未知 API 返回 JSON 404。React 普通文本节点 + pre-wrap，无 HTML 解析。
- CLI 交互初始化/重置，无默认密码；备份使用 db.backup、完整性校验、SHA-256 与版本清单。
- 自写 CSS 和 lucide 图标，无额外组件服务；可选 Astryx 没有采用，以减少 Beta 依赖及样式层。
- GitHub CI 完成类型、API、构建、Chromium、生产依赖审计和容器构建；尚未绑定任何正式部署通道。未来 CD 只在 main 检查通过后更新单个应用，具体目标授权后接通。

原稿的 Nginx、HTTPS、资源隔离、备份与安全部署原则保留。当前交付中的部署文件均为未执行示例，不能将其称作已上线验证。
