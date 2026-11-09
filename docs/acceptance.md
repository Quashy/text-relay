# TextRelay 开发验收记录

验收日期：2026-11-09。位置：云电脑独立目录 `/workspace/scratch/45067b13b38d/text-relay`。结论：应用开发与本地验收通过；远程发布和服务器相关验收尚未执行。

## 已完成与证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript 与生产构建 | 通过 | [构建日志](evidence/build.txt) |
| API 集成测试 | 15/15 通过 | [测试日志](evidence/api-tests.txt) |
| Chromium 端到端 | 7/7 通过 | [浏览器日志](evidence/browser-tests.txt) |
| 管理员与备份 CLI | PTY 初始化、重置、备份均通过 | [命令验证](evidence/cli-tests.txt) |
| npm 依赖审计 | 生产与开发共 0 已知漏洞 | [审计 JSON](evidence/dependency-audit.json) |
| 源码格式 | 通过 | [格式检查](evidence/format-check.txt) |
| 本地 Git | main 已初始化，交付本地提交；无 remote | 可用 git log / git remote -v 核对 |
| 临时账号清理 | 验收库 admin=0、sessions=0 | 测试 afterAll 自动清理并再次核对 |

API 覆盖：严格四位 ASCII、大小写与前导零、正文保真、未知/停用统一错误、同码并发唯一、停用占码、换码/删除立即复用、版本冲突、UTF-8 字节上限、SQL 参数边界、搜索分页、所有管理接口鉴权、来源/类型/自定义头、Cookie 与摘要、退出/过期/改密撤销、IP/全站限速、伪造代理头、编码路径与查询参数回归、重置与在途登录竞争、SQLITE_BUSY 和 WAL 快照恢复。

本云机器的 50 次注入请求、每组5并发，验码本地 P95 为 **25.29 ms**。这仅是本机 Fastify 注入测量，含路由与数据库，不包含真实网络、TLS 或目标服务器性能。

浏览器覆盖：桌面1440×1000、手机390×844、窄屏320×720；原样复制及安全纯文本渲染；创建编辑、搜索、启停、换码删除；手机全屏编辑与放弃更改；旧搜索延迟和启停请求延迟；复制权限失败后完整选中回退文本；改密后重新登录与退出。测试用例覆盖交互路径，不等同于人工跨设备全浏览器认证。

## 视觉证据

桌面与手机整体页面均已打开并检查，辅助文字对比度已提高。截图只使用虚构内容和临时测试账号。

- [桌面首页](evidence/public-desktop.png) / [手机首页](evidence/public-mobile.png)
- [桌面管理台](evidence/manage-desktop.png) / [手机管理台](evidence/manage-mobile.png)
- [桌面编辑](evidence/editor-desktop.png) / [手机编辑](evidence/editor-mobile.png)
- [桌面阅读](evidence/reader-desktop.png) / [手机阅读](evidence/reader-mobile.png)
- [搜索空态](evidence/search-empty.png)

## 审查与修复

使用环境 review-agent 技能进行了两轮独立只读审查。已修复并回归：
1. 编码路由绕过鉴权/来源校验；现在依据 Fastify 的已解析路由身份检查。
2. 查询字符串绕过限速。
3. 密码重置期间旧密码在途登录创建会话；密码更新在事务中复核。
4. 搜索乱序覆盖，及启停完成后旧筛选闭包覆盖；请求序号与当前筛选 ref 防护。
5. 删除末页后分页越界；后端 clamp、前端同步有效页码。
6. 反代真实 IP：显式可信代理列表，默认不信任 XFF。
7. 复制失败时尾部换行丢失；改用原字符串只读文本框全选。

依赖扫描发现的静态文件插件问题已升级修复版本；全依赖审计为0。浏览器自动化使用固定 Playwright 1.56.1 与专用 Chromium Headless Shell，成功绕开系统 Chromium 的运行环境不兼容；未通过改变用户浏览器权限完成。

## 尚未完成与限制

- 云环境无 Docker/Nginx，容器、named volume 重建、真实反代/HTTPS、证书续期、正式备份/回滚与既有站点隔离仅完成配置和文档静态审查，未假称实测。
- GitHub Actions 未在 GitHub 运行；尚未登录 CLI、建立远程、上传或部署。CI 当前无生产密钥和发布步骤，后续 CD 目标未确认。
- 独立云浏览器不能访问命令沙箱的本地端口，因此当前不交付对外在线链接。真实端到端验收在同一命令沙箱的应用与 Headless Chromium 中完成。可按 development.md 在有浏览器访问权限的终端运行预览。
- 仅保存原方案副本与本次可见对话摘录；没有移动或完整导出原聊天。未建立正式管理员、部署密钥或持久访问凭据。

## 重新预览

在项目目录运行 `npm ci`、复制 .env.example 为 .env、`npm run build`、交互式 `npm run admin -- init`、`npm start`，访问 http://localhost:3000 和 /manage。初始化由用户在自己终端输入正式密码。

已有 `data/acceptance.db` 只有虚构样例、无管理员与会话。需要重现整套截图时运行 `npm run test:e2e`，测试会重建该专用验收库，切勿把真实数据放进去。
