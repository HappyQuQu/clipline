# Clipline 运维：配置、保留、备份与升级

适用于 0.6.0 / D5；schema `0004_log_sequence`。本地测试只使用独立的 `clipline-phase-one-clipline-1`（8088）。

## 配置与保留

设置按 scan/playback/export/tasks 分类保存；`revision` 冲突返回 409 和当前值。默认扫描间隔只影响新源，近期写入保护影响之后提交的扫描；回看偏好立即应用；导出模式及跨度影响新导出；并行变更只限制新领取，不中断运行任务。部署路径、时区、识别策略及以下参数在界面只读。

| 环境变量 | 默认值 | 行为 |
| --- | --- | --- |
| CLIPLINE_EXPORT_TTL_HOURS | 24 | 发布时固定到期；到期禁止新下载，已有下载继续 |
| CLIPLINE_LOG_RETENTION_DAYS | 30 | 自动清理到期业务日志；不删除任务/尝试历史 |
| CLIPLINE_PLAYBACK_CACHE_MAX_BYTES | 2147483648 | 播放缓存上限，按最近使用顺序释放未使用缓存 |
| CLIPLINE_MAINTENANCE_INTERVAL_SECONDS | 60 | 维护间隔，独立于媒体执行与心跳 |
| CLIPLINE_USAGE_LEASE_SECONDS | 90 | API/浏览器使用租约，浏览器按返回 TTL 续租 |
| CLIPLINE_USAGE_IDLE_SECONDS | 30 | 已完成读取后的短暂保护期 |
| CLIPLINE_TEMPORARY_RETENTION_SECONDS | 3600 | 终态旧尝试及可确认归属孤立结果的最小保留时间 |
| CLIPLINE_EVENT_RETENTION_HOURS / CLIPLINE_EVENT_MAX_COUNT | 24 / 10000 | SSE 重放窗口；过期游标要求刷新快照 |

清理范围仅限应用的 exports、playback-proxies、thumbnails、tmp。活动任务的尝试/manifest 保护，正在播放和下载的结果保护，未知用户文件和符号链接保留。过期导出仍显示原任务记录，可以重新导出为新任务。

程序 stdout/stderr 由 Compose 的 json-file 日志驱动轮转（10 MiB × 3），业务日志单独存 SQLite，导出与诊断不复制环境变量全集。

## 在线一致性备份

先启动正常服务，再执行：

```bash
docker exec clipline-phase-one-clipline-1 python -m app.backup create
# 使用上一条输出的文件名
docker exec clipline-phase-one-clipline-1 python -m app.backup verify "backup-name.sqlite3"
```

结果保存在 `/app/data/backups`，包括 SQLite 文件和同名 JSON manifest（工具版本、schema、UTC 时间、大小、SHA256）。SQLite backup 包含已提交 WAL 数据；不能只复制运行中的主 DB 文件。备份不包含录像、缓存或导出媒体，可按业务需要单独保留应用数据目录中的生成文件。

备份目录不参与到期清理，需自行保留所需版本并管理容量。

## 同版本离线恢复

1. 停止 API/Worker 的整个容器，保持录像挂载只读。
2. 使用当前镜像、相同数据映射执行 restore。恢复前自动备份当前 DB；完整性、manifest、schema、API/Worker 锁检查失败时不会覆盖 DB。
3. 启动服务，检查 ready 和版本，重新打开工作台。

本地环境示例，仓库根目录执行；替换备份文件名：

```bash
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) docker compose --env-file deploy/local-test.env.example stop
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) docker compose --env-file deploy/local-test.env.example run --rm --no-deps --entrypoint python clipline -m app.backup restore "backup-name.sqlite3"
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) docker compose --env-file deploy/local-test.env.example up -d --no-build
curl -fsS http://127.0.0.1:8088/api/health/ready
```

API 或 Worker 仍在运行时，restore 会拒绝获取锁。业务任务继续使用持久化队列恢复；生成结果缺失时明确提示重新准备/导出，不伪造文件。

## 升级与回滚

升级前保存一致性备份及当前镜像标签/摘要；停止服务，选择新镜像再启动。bootstrap 在迁移前自动创建旧库备份，迁移成功后才启动 API/Worker。旧版未版本化数据库仍不会直接导入。

回滚必须同时选择匹配的旧镜像与旧 schema 备份。D4 → D5 从 `0003_indexing_queue` 升至 `0004_log_sequence`；D4 镜像不能读取 D5 库。D5 工具支持离线恢复已知旧 schema：

```bash
# 服务已停止，用 D5 镜像恢复旧库
docker compose --env-file deploy/local-test.env.example run --rm --no-deps --entrypoint python clipline -m app.backup restore "pre-d5-backup.sqlite3" --target-schema 0003_indexing_queue
```

随后将部署镜像选择改为已保存的 D4 镜像（本地示例为 d4-local）再启动。不要恢复旧库后直接启动 D5 镜像，否则会再次升级。恢复演练使用临时数据目录；正式数据恢复由操作者明确选择备份执行。
