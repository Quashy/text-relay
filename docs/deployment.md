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

# Production deployment

Operator setup (not performed by CI):
- Install reviewed deploy/deploy.sh as root:root 0755 /usr/local/sbin/textrelay-deploy, and deploy/ssh-command.sh as root:root 0755 /usr/local/sbin/textrelay-ssh-command. Never execute wrappers from the fetched repository.
- Create root-owned /opt/text-relay, /opt/text-relay/releases and a root-owned Git repository /opt/text-relay/repo. Keep all parent directories and repository configuration unwritable by ubuntu/the deployment key.
- Install reviewed deploy/production.yaml as /opt/text-relay/compose.yaml, root:root 0644. Preserve /opt/text-relay/.env (root:root 0600), with APP_ORIGIN=https://1.14.186.80 and existing app secrets. CI never copies or replaces these operator files. Compose resolves .env relative to this installed file.
- Preserve the existing text-relay project and its text-relay_textrelay-data and text-relay_textrelay-backups volumes. Confirm actual volume names before adoption; do not create an empty replacement for existing data. No down -v is used.
- Grant only the fixed wrapper via a reviewed sudoers entry: ubuntu ALL=(root) NOPASSWD: /usr/local/sbin/textrelay-deploy *
  The wrapper validates exactly one lowercase 40-character SHA. Validate sudoers using visudo. An already privileged ubuntu account is not a dedicated least-privilege account; the new SSH key is restricted separately.
- Add the dedicated public key to ubuntu authorized_keys with restrict,command="/usr/local/sbin/textrelay-ssh-command" options. No PTY, forwarding, arbitrary command, or shell is granted to this key. Keep the authorized_keys file and SSH setup under operator control.
- Configure repository secrets TEXTRELAY_DEPLOY_KEY and TEXTRELAY_SSH_KNOWN_HOSTS. Obtain and verify the server host key through a trusted independent channel; do not trust ssh-keyscan output alone. The known_hosts entry must match 1.14.186.80.
- Configure Nginx/TLS separately to proxy to 127.0.0.1:18080; host checks use 1.14.186.80.

Deploy TextRelay only responds to successful Check TextRelay push runs on main in Quashy/text-relay. No artifacts or code from the triggering run execute on the Actions runner. No checkout/setup actions are needed. GitHub concurrency and server flock serialize deployment; the wrapper rejects a SHA that is no longer origin/main, builds the exact archived commit, backs up SQLite via the running app CLI, then replaces the container. Initial deployment has no prior container to back up.

The old image is retained as text-relay:rollback. Before replacement, the wrapper reads the current schema version and creates a verified SQLite backup using the running app. Failed startup or health checks first stop the failed app, then read the database schema through a one-off Node process without starting the application. Image rollback is allowed only when the before/after schema versions are known and identical. If stopping fails, the query fails, or the schema changes, automated recovery stops and the deployment exits unsuccessfully; the database and pre-deploy backup are preserved. SQLite is never automatically overwritten: a rollback would discard post-migration writes. For incompatible migrations, archive the failed database, then use an operator-led restore of a matched backup and application image, or deploy a compatible forward fix. See [multi-user recovery](multi-user-migration.md). Backups and release directories are retained; operator retention is required to prevent disk exhaustion. This is a brief-downtime single-container deployment, not zero-downtime.

The key authorizes deployment of current main; server-side checks enforce main identity, while successful-CI gating is enforced by the workflow. Protect main, workflow changes, secrets and operator access. A compromised deployment key could request current main without checking CI itself. Repository Dockerfile code is built with the Docker daemon; the trust boundary is approved main, not a sandbox for malicious repository maintainers.

Validation on 2026-11-12: 26 service/deployment tests, build/type checks and formatting passed locally; the multi-user feature also passed 16 browser tests. The schema-safe wrapper was separately installed as root:root 0755 and its exact SHA-256 verified. Its previous version is retained in /opt/text-relay/operator-backups. A synthetic server-side rehearsal verified actual startup failure after v2 migration, preservation of post-migration writes, and successful restoration of a v1 database with the installed old application. Actual feature rollout remains blocked by the GitHub account billing lock; do not bypass CI or interpret the wrapper installation as a multi-user application deployment. Production remains on c0b2862 with schema 1.