# Clipline 运维：配置、保留、备份与升级

适用于当前一期版本；本地验证使用独立的 Clipline 测试容器，不操作原录像及其他服务。

## 配置与保留

运行参数在系统「设置」中按分类保存，使用 revision 检测并发编辑冲突，配置保存在应用数据目录的 SQLite 中。无需重启容器，API 与 Worker 分别读取同一份持久化配置。

| 分类 | 可保存项目 | 生效范围 |
| --- | --- | --- |
| 基础设置 | 录像时区、业务日志保留天数、播放缓存容量 | 展示时区在后续查询生效，新源使用新时区，已有源保留原索引时区；清理在下一轮维护生效 |
| 扫描与索引 | 默认扫描间隔、近期写入保护 | 间隔仅影响新源；保护时长影响之后提交的扫描 |
| 录像回看 | 自动续播、跳过断档、兼容播放最大宽度 | 偏好保存后应用，宽度写入新播放准备任务的规格快照 |
| 录像导出 | 默认模式、最大跨度、精准输出最大宽度、结果保留小时数 | 输出宽度固定在提交计划中；保留时长由任务开始时取得，已生成结果到期时间不变 |
| 后台任务 | 队列并行数、媒体线程数、媒体并行上限 | 新任务读取线程数快照；新媒体任务按最新上限领取槽位，降低上限不中断已有任务 |

默认值：时区 Asia/Shanghai，媒体 2 线程 / 1 个并行，兼容播放宽度 1920，精准输出宽度 3840，导出保留 24 小时，播放缓存 2 GiB，业务日志 30 天。用户在界面保存后的设置优先于旧部署的对应环境变量；未保存字段兼容沿用旧环境初始值。

目录映射与端口仍由 Docker 管理；CPU、内存硬限制可选。二期识别继续占位，不能启用模型或提交识别任务。

维护默认每 60 秒检查一次。清理范围仅限应用的 exports、playback-proxies、thumbnails、tmp。活动任务、正在播放和下载的文件受保护，未知用户文件和符号链接保留。过期导出仍显示原任务记录，可以重新导出为新任务。缩短日志保留期限会清理超期业务日志，任务与执行记录保留，原录像不参与清理。

程序 stdout/stderr 使用 Docker 日志轮转，业务日志单独存 SQLite。数据库一致性备份包含设置，恢复后可恢复这些配置。

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
