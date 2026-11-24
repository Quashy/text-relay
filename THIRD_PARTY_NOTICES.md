# 第三方组件

TextRelay 的直接运行依赖采用各自许可证：
- React / React DOM — MIT，Meta Platforms, Inc. and affiliates。
- Fastify / @fastify/cookie / @fastify/static — MIT，Fastify 项目贡献者。
- better-sqlite3 — MIT，Joshua Wise 及贡献者；内置 SQLite 属公共领域。
- lucide-react 图标 — ISC，Lucide contributors。
- Base UI、clsx、tailwind-merge — MIT；Class Variance Authority — Apache-2.0。
- coss/ui 组件与主题 — MIT，参见 [上游许可](src/client/ui/LICENSE.coss-ui.txt)。组件来自 [coss/ui 源码](https://github.com/cosscom/ui/tree/b2336c45f2b7355c42678ce786b6f14d62b819be)，使用本仓库的相对导入与代码格式，并适配控件对比度和减少动态效果。

开发依赖包括 TypeScript（Apache-2.0）、Vite、tsx、Playwright 等，详见锁文件和各 npm 包中的 LICENSE。分发镜像应保留 node_modules 中的许可证；TextRelay 的 MIT 不替代第三方许可。
