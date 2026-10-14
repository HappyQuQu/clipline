# Clipline 一期后端

当前实现 D1–D6：运行基础、后台索引、真实页面接入、本地日时间轴、按时间定位、原文件 Range 播放与后台兼容代理，以及详情/片段库/文件信息搜索、真实区间裁剪、跨片段拼接和导出下载。

`/api/capabilities` 中 scan/reindex/playback/prepare/export 为 true，识别能力为 false，backendStage 为 maintenance。默认页面使用真实 API；Docker 候选镜像关闭演示模式，开发服务器可显式打开 `?mode=demo`。设置保存、日志筛选/导出/诊断、SSE、缓存与到期清理和一致性备份已接入。

## 本机开发

在仓库根目录创建独立数据目录，再进入 backend：

```bash
mkdir -p data/local-test
cd backend
uv sync --locked
export CLIPLINE_DATA=/Users/qu/Documents/GitHub/clipline/data/local-test
export CLIPLINE_RECORDINGS_ROOT=/Volumes/extended/clipline
export CLIPLINE_PORT=8088
uv run --frozen python -m app.runtime
```

直接在宿主机运行时录影输入受应用路径约束，Docker 的只读挂载提供更明确的写保护，真实录像验证优先使用下方容器方式。

打开 <http://127.0.0.1:8088/docs> 查看接口。API 单独启动需要先 `uv run python -m app.bootstrap`，之后运行 uvicorn；未启动 Worker 时 live 为正常、ready 为 503，这是预期行为。

## Docker 本地测试

以下命令在仓库根目录执行；项目名为 `clipline-phase-one`，端口为 8088，与旧 `clipline` 容器分开：

```bash
mkdir -p data/local-test
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) \
  docker compose --env-file deploy/local-test.env.example up --build -d
```

映射 `/Volumes/extended/clipline` 到 `/recordings` 并只读，新数据目录到 `/app/data` 并可写。使用 `GET /api/recording-directories?relativePath=media` 浏览真实录像目录；旧 DB、模型、代理及导出不作为输入源。

UID/GID 应与可写数据目录权限匹配；NAS 部署使用实际 NAS 用户和目录。不要把新数据目录指向旧映射目录。

## 验证

在 backend 内：

```bash
uv run --frozen ruff check . ../deploy
uv run --frozen ruff format --check . ../deploy
uv run --frozen pytest -q
```

107 项测试覆盖迁移/升级保护、目录边界、幂等与领取竞争、租约隔离、资源限额、取消/重试/恢复、真实合成媒体探测、文件稳定性、离线/部分扫描保护、跨日搜索/时间轴、Range/HEAD/ETag、代理发布/校验/取消及容量限制。新增导出计划、快速/精准媒体、时间戳/音轨、发布崩溃、过期下载及取消/恢复测试。媒体测试需本机安装 ffmpeg/ffprobe。CI 使用 Python 3.11/3.12；Docker 运行层锁定 Python 3.11，依赖由 `uv.lock` 和带 hash 的 `requirements.lock` 锁定。

真实目录验证在仓库根目录执行 `python3 deploy/smoke_indexing.py --restart`，会创建本地测试源，执行扫描、增量、取消、重试并强制结束测试容器内 Worker，验证 Docker 重启后的恢复。仅用于上述独立本地测试容器。

D3 播放验证：`python3 deploy/smoke_playback.py --restart`。在已有真实索引中选择尚未缓存的较短录像，提交兼容准备、检查去重、处理期间强制结束 Worker，等待恢复后验证缓存与 206/416。该脚本会执行真实 CPU 转码；常规复验可省略 `--restart` 复用缓存。

D4 导出验证：`python3 deploy/smoke_exports.py --controls`。使用指定目录的真实索引做整段快速导出与 5+5 秒精准拼接，下载到忽略的 `data/qa/d4-smoke`；随后取消真实转码、新 ID 重试并 SIGKILL Worker 检查第二次尝试恢复。只针对独立本地测试容器。

D5 运维验证：`python3 deploy/smoke_operations.py`。验证真实分类保存/冲突、SSE、约 129 MB 下载期间的文件锁保护、过期 410、下载完整性、物理清理、新 ID 重导出、全量日志与在线备份。测试设置恢复到运行前的值，原录像挂载保持只读。

## 当前 API

| 接口 | 已实现行为 |
| --- | --- |
| GET/POST `/api/sources`；PATCH `/api/sources/{id}` | 创建/编辑/启停；可同事务创建首次扫描；配置 revision 冲突检测 |
| POST `/api/sources/{id}/scan`；POST `/api/tasks` | 提交 scan/reindex，202 返回 taskId；支持 Idempotency-Key 和活动任务复用 |
| GET `/api/tasks`、`/{id}`；POST `/{id}/cancel`、`/{id}/retry` | 状态/类型/源筛选及分页、尝试记录、取消和新 ID 重试 |
| GET `/api/segments`、`/{id}`、`/{id}/thumbnail` | 源/本地日/文件名或起止时刻搜索、稳定分页、真实元数据和 JPEG |
| GET `/api/sources/{id}/dates`、`/api/timeline`、`/api/sources/{id}/resolve` | 有录像日期、本地日覆盖/断档、时间窗分页与稳定定位；重叠不重复计时 |
| GET `/api/segments/{id}/playback`；POST `/{id}/prepare` | 返回状态/mediaUrl；空对象为默认规格，force=true 为浏览器失败后的兼容准备 |
| GET/HEAD `/api/segments/{id}/media?fingerprint=…` | 安全 ID 路径、指纹检查、单段 Range、206/416、HEAD/ETag；GET 不转码 |
| POST `/api/exports/plan`；POST `/api/exports` | 同源同日计划预览、planHash 复核和持久化提交；跨度默认 30 分钟 |
| GET/HEAD `/api/exports/{id}/download`；POST `…/resubmit` | 已登记结果下载、206/416/ETag、安全文件名、未完成 409、过期 410 和新 ID 重新导出 |
| GET `/api/settings`；PATCH `/api/settings/{group}` | 四分类字段白名单、严格类型、分类 revision；冲突 409 返回当前值；部署与识别只读 |
| GET `/api/logs/export`、`/api/system/diagnostics`；GET `/api/logs/{id}` | 当前筛选的一致快照全量 JSON、结构化详情、版本/schema/架构及配置摘要；下载字段白名单 |
| GET `/api/events`；POST `/api/segments/{id}/lease` | SSE 游标重放/reset/心跳，页面保持播放缓存租约；轮询兜底 |
| GET `/api/logs` | taskId/sourceId 筛选和游标分页；级别/类型/关键词/源/任务筛选及稳定快照分页 |

扫描频率可选 5/10/30 分钟；创建时省略频率采用已保存默认值，显式 null 表示仅手动。索引存在或任务活动时不能改目录。停用取消未开始的维护任务，已运行任务可完成，历史索引保留。

扫描参数保存源路径/时区和近期文件保护快照；prepare 保存片段 ID、指纹和版本化 profile。源级 scan/reindex 互斥，prepare 使用片段锁；总并行默认 2，媒体槽默认 1。正常停机重新排队；异常最多自动恢复 3 次。用户重试产生新 ID，原任务保留。缩略图取首帧；播放代理为宽度最大 1920 的 H.264/YUV420P，音轨存在时转 AAC，无音轨不补音频。部署可设置 `CLIPLINE_PLAYBACK_MAX_WIDTH` 降低分辨率，`CLIPLINE_PLAYBACK_TIMEOUT_SECONDS` 限制处理时长。

代理指纹/profile 缓存去重，校验成功后在受租约保护的终态事务中发布；取消不暴露半成品。执行缓存容量限制、按最近使用顺序清理和活跃使用保护。原文件变化或源离线时明确报错，不能按旧索引播放其他文件。

已实现边界和验证结果见 [D1](../docs/qa/D1_FOUNDATION.md)、[D2](../docs/qa/D2_INDEXING.md)、[D3](../docs/qa/D3_PLAYBACK.md)、[D4](../docs/qa/D4_EXPORTS.md)、[D5](../docs/qa/D5_OPERATIONS.md)及 [D6](../docs/qa/D6_ACCEPTANCE.md)，后续任务见 [开发清单](../docs/TASKS.md)。

导出始终读取原始文件。fast 检查编码、分辨率、帧率、时间基与 extradata，相容才复制；单个裁剪偏差超过 5 秒报 FAST_BOUNDARY_UNSAFE，不发布结果。precise 默认 25 fps、最大宽度 3840，按累计帧数分配边界、顺序编码 NUT/PCM 中间片段，再一次编码 AAC 音轨；有声/无声混合时补齐对应静音，全无音轨不生成音轨。结果验证帧数、逐包时间戳、音视频时长，并解码精准结果检查错误。

验证后写 fsync manifest；终态事务复核租约、取消和输入，再原子发布与登记 Artifact。重启可对账已校验的暂存/最终文件，半成品不开放下载。导出默认 24 小时有效；D4 已执行访问过期控制，D5 已接入自动物理清理。部署参数包括 CLIPLINE_EXPORT_FPS、CLIPLINE_EXPORT_MAX_WIDTH、CLIPLINE_EXPORT_TIMEOUT_SECONDS 和 CLIPLINE_EXPORT_TTL_HOURS。

维护每 60 秒检查一次。导出默认保留 24 小时，日志 30 天，事件 24 小时且最多 10,000 条；旧尝试与可确认归属的孤立结果至少等待 1 小时。只清理 exports/playback-proxies/thumbnails/tmp 内的应用文件，跳过符号链接和源目录。下载持久租约 + OS 共享文件锁保护慢流，播放页面每 20 秒以内续租，正常关闭后有短暂保护期。旧 Worker 恢复不会清除 API/浏览器租约。

备份与离线恢复步骤见 [运维说明](../docs/OPERATIONS.md)。迁移前自动做 SQLite 一致性备份和 SHA256/schema manifest；恢复要求 API/Worker 全部停止。D5 的 schema 为 `0004_log_sequence`，原日志 UUID 和任务记录保持。

D6 原生候选镜像验收由 `deploy/smoke_release.py` 驱动，涵盖软件媒体流程与真实进程故障；两种架构分别在原生 Ubuntu runner 上执行。NAS 配置、部署预检及发布门禁见 [部署说明](../docs/DEPLOYMENT.md)。应用候选版本 0.7.0，schema 沿用 0004。
