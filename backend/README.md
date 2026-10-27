# Clipline 一期后端

当前实现 D1–D6：运行基础、后台索引、真实页面接入、本地日时间轴、按时间定位、原文件 Range 播放与后台兼容代理，以及详情/片段库/文件信息搜索、真实区间裁剪、跨片段拼接和导出下载。

`/api/capabilities` 中 scan/reindex/playback/prepare/export 为 true，识别能力为 false，backendStage 为 maintenance。默认页面使用真实 API；Docker 镜像关闭演示模式，开发服务器可显式打开 `?mode=demo`。设置保存、日志筛选/导出/诊断、SSE、缓存与到期清理和一致性备份已接入。

## 本机开发

在仓库根目录创建独立数据目录，再进入 backend；将下方路径替换为自己的实际路径：

```bash
mkdir -p data/local-test
cd backend
uv sync --locked
export CLIPLINE_DATA=/path/to/clipline/data/local-test
export CLIPLINE_RECORDINGS_ROOT=/path/to/recordings
export CLIPLINE_PORT=8088
uv run --frozen python -m app.runtime
```

直接在宿主机运行时录影输入受应用路径约束，Docker 的只读挂载提供更明确的写保护，真实录像验证优先使用下方容器方式。

打开 <http://127.0.0.1:8088/docs> 查看接口。API 单独启动需要先 `uv run python -m app.bootstrap`，之后运行 uvicorn；未启动 Worker 时 live 为正常、ready 为 503，这是预期行为。

## Docker 本地测试

完整容器启动、目录映射与 UID/GID 配置见 [部署说明](../docs/DEPLOYMENT.md#指定本地目录)。本地测试使用独立的 `data/local-test` 和端口 8088；原录像只读挂载，旧数据库、模型和导出不作为输入源。

## 验证

在 backend 内：

```bash
uv run --frozen ruff check . ../deploy
uv run --frozen ruff format --check . ../deploy
uv run --frozen pytest -q
```

后端测试覆盖迁移/升级保护、目录边界、幂等与领取竞争、租约隔离、资源限额、取消/重试/恢复、真实合成媒体探测、文件稳定性、离线/部分扫描保护、跨日搜索/时间轴、Range/HEAD/ETag、代理发布/校验/取消及容量限制。新增导出计划、快速/精准媒体、时间戳/音轨、发布崩溃、过期下载及取消/恢复测试。媒体测试需本机安装 ffmpeg/ffprobe。CI 使用 Python 3.11/3.12；Docker 运行层锁定 Python 3.11，依赖由 `uv.lock` 和带 hash 的 `requirements.lock` 锁定。

镜像验收和真实目录 smoke 命令见 [部署说明](../docs/DEPLOYMENT.md#可重复验收)。真实目录 smoke 脚本仅用于独立测试容器，可能执行 CPU 转码、取消任务和 Worker 故障恢复。

## 当前 API

| 接口 | 已实现行为 |
| --- | --- |
| GET/POST `/api/sources`；PATCH `/api/sources/{id}` | 创建/编辑/启停；可同事务创建首次扫描；配置 revision 冲突检测 |
| POST `/api/sources/{id}/scan`；POST `/api/tasks` | 提交 scan/reindex，202 返回 taskId；支持 Idempotency-Key 和活动任务复用 |
| GET `/api/tasks`、`/{id}`；POST `/{id}/cancel`、`/{id}/retry` | 状态/类型/源筛选及分页、尝试记录、取消和新 ID 重试 |
| GET `/api/segments`、`/{id}`、`/{id}/thumbnail` | 源/本地日/文件名或起止时刻搜索、稳定分页、真实元数据和 JPEG |
| GET `/api/sources/{id}/dates`、`/api/timeline`、`/api/sources/{id}/resolve` | 有录像日期、本地日覆盖/断档、时间窗分页与稳定定位；重叠不重复计时 |
| GET `/api/segments/{id}/playback`；POST `/{id}/prepare` | 返回状态/mediaUrl；mode=compatible/hevc/original/stream + startMs，默认 compatible；force=true 为兼容转码 |
| GET/HEAD `/api/segments/{id}/media?fingerprint=…` | 安全 ID 路径、指纹检查、单段 Range、206/416、HEAD/ETag；GET 不转码 |
| POST `/api/exports/plan`；POST `/api/exports` | 同源区间计划预览、planHash 复核和持久化提交；支持跨天，最大跨度默认 7 天，可在设置中降低 |
| GET/HEAD `/api/exports/{id}/download`；POST `…/resubmit` | 已登记结果下载、206/416/ETag、安全文件名、未完成 409、过期 410 和新 ID 重新导出 |
| GET `/api/settings`；PATCH `/api/settings/{group}` | 五分类字段白名单、严格类型、分类 revision；冲突 409 返回当前值；运行参数在对应分类保存，目录路径只读，识别为二期占位 |
| GET `/api/logs/export`、`/api/system/diagnostics`；GET `/api/logs/{id}` | 当前筛选的一致快照全量 JSON、结构化详情、版本/schema/架构及配置摘要；下载字段白名单 |
| GET `/api/events`；POST `/api/segments/{id}/lease` | SSE 游标重放/reset/心跳，页面保持播放缓存租约；轮询兜底 |
| GET `/api/logs` | taskId/sourceId 筛选和游标分页；级别/类型/关键词/源/任务筛选及稳定快照分页 |

扫描频率可选 5/10/30 分钟；创建时省略频率采用已保存默认值，显式 null 表示仅手动。索引存在或任务活动时不能改目录。停用取消未开始的维护任务，已运行任务可完成，历史索引保留。

扫描参数保存源路径/时区和近期文件保护快照；prepare 保存片段 ID、指纹和版本化 profile。源级 scan/reindex 互斥，prepare 使用片段锁；总并行默认 2，媒体槽默认 1。正常停机重新排队；异常最多自动恢复 3 次。用户重试产生新 ID，原任务保留。缩略图取首帧；H.265 根据浏览器实际解码能力优先 original 原片 Range 直读；不能播放原音轨时选择 hevc，仅复制视频并转 AAC，写 hvc1/faststart MP4。解码失败自动按 original → hevc → stream 回退，网络失败不触发转码。状态、媒体、视图租约携带同一 mode；HEVC 和 H.264 缓存按 profile 隔离并存。默认兼容播放代理为宽度最大 1920 的 H.264/YUV420P，音轨存在时转 AAC，无音轨不补音频。在系统回看设置中调整最大播放宽度；高级环境参数 `CLIPLINE_PLAYBACK_TIMEOUT_SECONDS` 可限制处理时长。

代理指纹/profile 缓存去重，校验成功后在受租约保护的终态事务中发布；取消不暴露半成品。执行缓存容量限制、按最近使用顺序清理和活跃使用保护。原文件变化或源离线时明确报错，不能按旧索引播放其他文件。

已实现边界和验证结果见 [D1](../docs/qa/D1_FOUNDATION.md)、[D2](../docs/qa/D2_INDEXING.md)、[D3](../docs/qa/D3_PLAYBACK.md)、[D4](../docs/qa/D4_EXPORTS.md)、[D5](../docs/qa/D5_OPERATIONS.md)及 [D6](../docs/qa/D6_ACCEPTANCE.md)，历史实施记录与二期计划见 [开发清单](../docs/TASKS.md)。

导出始终读取原始文件。快速模式保留视频编码、统一音轨为 AAC；编码兼容性与裁剪边界检查失败时明确报错，用户可改用精准模式。precise 默认 25 fps、最大宽度 3840，按累计帧数分配边界、顺序编码 NUT/PCM 中间片段，再一次编码 AAC 音轨；有声/无声混合时补齐对应静音，全无音轨不生成音轨。结果验证帧数、逐包时间戳、音视频时长，并解码精准结果检查错误。

验证后写 fsync manifest；终态事务复核租约、取消和输入，再原子发布与登记 Artifact。重启可对账已校验的暂存/最终文件，半成品不开放下载。导出默认 24 小时有效；D4 已执行访问过期控制，D5 已接入自动物理清理。精准输出宽度和导出保留期限在系统导出设置中保存；高级参数 CLIPLINE_EXPORT_FPS 与 CLIPLINE_EXPORT_TIMEOUT_SECONDS 保留兼容。

维护每 60 秒检查一次。导出默认保留 24 小时，日志 30 天，事件 24 小时且最多 10,000 条；旧尝试与可确认归属的孤立结果至少等待 1 小时。只清理 exports/playback-proxies/thumbnails/tmp 内的应用文件，跳过符号链接和源目录。下载持久租约 + OS 共享文件锁保护慢流，播放页面每 20 秒以内续租，正常关闭后有短暂保护期。旧 Worker 恢复不会清除 API/浏览器租约。

备份与离线恢复步骤见 [运维说明](../docs/OPERATIONS.md)。迁移前自动做 SQLite 一致性备份和 SHA256/schema manifest；恢复要求 API/Worker 全部停止。当前 schema 为 `0004_log_sequence`，原日志 UUID 和任务记录保持。

D6 原生候选镜像验收由 `deploy/smoke_release.py` 驱动，涵盖软件媒体流程与真实进程故障；两种架构分别在原生 Ubuntu runner 上执行。NAS 配置、部署预检及发布门禁见 [部署说明](../docs/DEPLOYMENT.md)。仓库版本见根目录 `version.txt`，已发布版本见 GitHub Releases；当前 schema 为 `0004_log_sequence`。

H.264 流式回看采用 4 秒 HLS 分片：先播放已完成分片，再继续后台转换。观看租约、按需定位、重启检查点、缓存容量和取消/重试规则见 [开发文档](../docs/DEVELOPMENT.md)。原录像保持只读，媒体处理继续共用部署的线程与并行限制。

运行参数现已接入系统设置：基础分类管理时区、日志保留和播放缓存；回看分类管理兼容播放宽度；导出分类管理精准输出宽度和结果保留期限；后台任务分类管理线程数和媒体槽位上限。保存无需重启，API 按请求读取配置，TaskContext 保存执行参数快照，播放任务保存输出宽度，导出计划保留输出规格，媒体槽按实时上限领取，维护进程每轮读取最新清理设置。旧环境变量仅为未保存字段提供初始值，系统保存后优先使用数据库值。
