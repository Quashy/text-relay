# 备份与恢复

运行中不单独复制 SQLite 主文件，因为最新提交可能仍在 WAL 中。

```sh
npm run backup
# 或指定一个尚不存在的目标
npm run backup -- ./backups/before-upgrade.db
```

容器中运行 `node dist/server/cli.js backup /app/backups/目标.db`。命令调用 SQLite online backup API，校验 integrity_check，写入临时文件后原子改名，旁边 JSON 记录 SHA-256、schema 与应用版本。数据库和快照目录只授予应用用户。每天一份，升级前额外一份；运维定时器调用命令，保留最近7份日常备份，升级前快照另存。未在本次任务安装机器级定时器。

恢复演练：
1. 停止 TextRelay，保留当前数据库及 WAL/SHM 为独立安全副本。
2. 校验备份的 SHA-256 与 integrity_check；使用清单记录的匹配应用版本。
3. 恢复到独立数据目录（不要混入旧 WAL/SHM），保留权限。设置 PUBLIC_READ_ENABLED=false。
4. 运行 `npm run admin -- clear-sessions` 清除所有旧会话；启动应用。
5. 登录后台核对分享、码、近期删除/停用/换码。恢复会回到快照时间，不能自动重现之后的操作。
6. 核对完成后启用公开读取并重启本应用。

备份包括管理员哈希与正文，不能上传公共仓库。业务硬删除后内容可能仍在保留期备份。定期将快照复制到用户控制的另一台设备或私有存储；目的地留待用户决定。

本次集成测试已经完成 WAL 快照 → 打开恢复库 → 完整性检查 → 原文与迁移版本校验 → 暂停公开读取；正式卷恢复和跨设备备份待实际部署环境验收。
