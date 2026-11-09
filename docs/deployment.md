# 自部署与后续发布

当前没有部署服务器、创建远程或生成部署密钥。以下是可审阅方案；现有服务器架构、域名、HTTPS 和代理拓扑需在用户参与的下一步确认。

## 一个应用，一个数据卷

有 Docker 的机器可使用 deploy/compose.yaml。该示例假设 Nginx 在宿主机，通过 127.0.0.1:18080 访问应用。容器代理拓扑需要调整受限网络，不能照抄。

1. 配置 .env 中的实际 APP_ORIGIN=https://share.example.com；生产必须 HTTPS、COOKIE_SECURE=true、NODE_ENV=production。
2. 构建并启动独立 Compose project：`docker compose -f deploy/compose.yaml up -d --build`。
3. 交互初始化唯一管理员：`docker compose -f deploy/compose.yaml exec app node dist/server/cli.js init`。
4. 新增本站 Nginx 配置与证书，参考示例；不覆盖现有站点。先 nginx -t，再平滑 reload。
5. 验证入口 HTTPS、登录、读取、限速和现有站点。数据与备份为独立 named volume，容器重建不删除它们；禁止 down -v。

示例容器非 root、只读根目录、单独可写数据卷，不挂 Docker socket，限制 CPU/内存/进程。镜像构建与运行均为 Node24 Debian，原生 SQLite 匹配同一 Linux 环境。正式构建前确认 CPU 架构；本云电脑无 Docker，容器实测尚未完成。

## 真实来源 IP 与限速

应用默认不信任任何转发头。反代部署后设置 TRUSTED_PROXY 为应用实际看到的**已确认代理地址/CIDR**。宿主 Nginx 转发至 Docker 发布端口时可能看到 bridge 网关地址，不可盲设 loopback 或信任全部网段。先在隔离配置核实，代理覆盖 X-Forwarded-For，应用端口仅回环开放。Nginx 示例另设 IP 和全站入口预算，编码路径仍受应用路由限速保护。多用户共享出口 IP 的阈值根据实际量调整。

应用健康检查需带配置域名的 Host。代理必须保留 Host。HTTP 只做转 HTTPS 或证书校验；HSTS 在核验证书续期和本站影响后启用。

## 保持 CI/CD 简单

当前 .github/workflows/ci.yml 是无秘密的 CI：安装锁文件 → 类型检查 → API → 构建 → Chromium → 依赖审计 → Docker 构建。PR 和分支均不接触生产凭据，也不上传产物。Actions 是否在 GitHub 实际运行，需下一步推送后验证。

后续接通 CD 时保留一个工作流，main push 且检查全通过后：
1. 构建目标服务器架构镜像，标签为提交 SHA。
2. 经固定主机指纹和受限部署入口传输镜像，不授予普通 shell 或全主机 Docker 控制权。
3. 取得项目发布锁，拒绝过时发布，迁移前一致性备份。
4. 只更新 TextRelay 容器，健康及 HTTPS 冒烟通过再记录成功。
5. 失败保留旧服务；仅在 schema 兼容时回滚镜像，数据库恢复另按演练步骤处理。

并发组 cancel-in-progress:false，加服务器发布序号防旧构建覆盖新版本。不使用 pull_request_target。秘密仅置于受控 GitHub environment/Secrets，不写进 YAML 或仓库。当前没有为未知目标写一个假装可直接运行的生产部署步骤。

## GitHub 交接

本地 Git 已准备；不调用 gh auth login、不创建 origin、不 push。用户参与时先确认账号/归属，再运行 GitHub CLI 的设备登录流程，由 CLI 实际返回地址与当次验证码；不预先生成会过期的设备码。然后检查暂存内容、建立公共仓库并按用户批准范围推送。
