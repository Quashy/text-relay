# 多用户迁移与恢复

## 迁移与权限边界

schema 2 以 users、user_sessions 和 shares.owner_id 代替旧单管理员结构。迁移在一个 IMMEDIATE 事务内执行；旧 id=1 的账号和密码哈希原样复制为唯一 superadmin，原分享所有字段原样保留并归其所有。缺少原管理员却存在分享时迁移停止并回滚，禁止猜测归属。应用拒绝比自身更新的 schema。

旧 sessions 被丢弃，新 Cookie 为 tr_session_v2，所有人升级后重新登录。每个后台分享端点都使用服务端会话身份限定 owner_id，无最高管理员例外。用户管理仅返回账号元数据，不返回他人的分享或密码哈希。用户名不区分 ASCII 大小写且唯一。

最高管理员仅能创建普通用户；不可删除、更名或降级最高管理员。修改普通用户账号会撤销其登录会话；用户自己改密码只撤销自己的会话。删除普通用户通过外键同时删除其分享和会话，访问码释放。

## 发布前检查

1. 检查工作树、完整测试和 CI；不要用真实同事账户做自动化测试。
2. 使用当前运行的旧版本 CLI：`node dist/server/cli.js backup /app/backups/pre-multiuser-唯一时间.db`。保留返回的 .db 和 .json，并核对 SHA-256 和 integrity_check。部署器还会另做一次 pre-deploy 备份。
3. 在服务器内的临时备份副本上演练新 openDb；比较账号凭据、分享正文/访问码/状态/版本/时间全部不变，owner_id 均为 1、外键检查通过、新会话为空。禁止将生产正文或凭据导出到日志。
4. 正常发布后检查 schema=2、唯一 quashy superadmin、每条旧分享 owner_id=1、数据数量及原分享码仍可公开读取。不要创建虚构同事账户。

## 失败与恢复

备份命令直接以只读连接创建快照，不触发迁移。

schema 2 不兼容旧应用。镜像回滚不能撤销数据库迁移；旧单管理员镜像不得被视为恢复成功。旧 admin/sessions 表及旧 Cookie 已停用，避免回滚旧代码时放宽成全量分享访问。

迁移失败会事务回滚并停止启动。优先修复并向前发布；不要让旧镜像继续写新库。若必须恢复 v1：

1. 停止 TextRelay，保存故障库及 WAL/SHM 为独立安全副本，保持 named volumes，不执行 down -v。
2. 由操作者核对部署前备份哈希、integrity_check 和时间，评估并保存迁移后的新增数据；恢复旧备份会回退其后的写入，不自动覆盖生产库。
3. 使用版本匹配的旧备份与旧镜像，按 backup-restore.md 的停机流程恢复；清理旧会话，验证账号、正文和公开访问码后再开放写入。

备份含密码哈希和分享正文，留在服务器私有备份卷，不提交 Git。旧会话被撤销是预期行为，并非数据丢失。

参考：[SQLite 外键](https://www.sqlite.org/foreignkeys.html)、[OWASP 授权](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)、[OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 部署失败保护与恢复演练

`deploy/deploy.sh` 在替换容器前读取 schema 并通过当前运行版本备份。启动或健康检查失败后先停止失败实例，通过一次性只读 Node 进程查询结构；仅当迁移前后 schema 已知且相同时才回退镜像。schema 改变、查询失败或无法停止实例时禁止自动回退，保留数据库及备份，返回失败供操作者处理。根拥有的 `/usr/local/sbin/textrelay-deploy` 需要单独安装审核后的脚本，提交仓库不会自动替换它。

2026-11-12 在服务器使用 `/tmp` 合成数据完成实际故障演练，未写入生产数据卷：

1. 建立 v1 账号和分享，创建 v1 快照；运行实际 v2 迁移并增加一条迁移后写入。
2. 占用临时本机端口，确认实际新程序因 `EADDRINUSE` 启动失败。
3. 保存故障 v2 快照，确认其中仍有迁移后新增写入；实际已安装旧程序无法使用 v2 数据库登录。
4. 将 v1 快照恢复到独立临时路径，搭配实际旧程序，确认登录、私有分享列表和原公开分享码访问全部恢复；故障 v2 快照中的新增写入保持可查。

该演练验证了匹配恢复的可行性，不代表旧备份会自动包含迁移后写入。恢复生产前必须先封存故障库并处理增量数据。部署脚本自动测试覆盖同版本回退、已完成迁移后的启动失败、查询异常、异常版本、未知原版本、首次部署以及停止失败。生产预迁移备份 `pre-multiuser-20261112T030623.db` 已再次验证 SHA-256 一致、`integrity_check=ok`、schema=1、原有分享 2 条；备份内容保持私有。
