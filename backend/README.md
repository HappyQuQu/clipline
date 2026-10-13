# Clipline 一期后端

当前实现 D1–D3：运行基础、后台索引、真实页面接入、本地日时间轴、按时间定位、原文件 Range 播放与后台兼容代理，以及详情/片段库/文件信息搜索。

`/api/capabilities` 中 scan/reindex/playback/prepare 为 true，export 与识别能力为 false，backendStage 为 playback。默认页面使用真实 API；`?mode=demo` 才进入旧原型。导出在 D4、配置保存和完整日志运维在 D5 接入，当前禁用相应结果动作。

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

83 项测试覆盖迁移/升级保护、目录边界、幂等与领取竞争、租约隔离、资源限额、取消/重试/恢复、真实合成媒体探测、文件稳定性、离线/部分扫描保护、跨日搜索/时间轴、Range/HEAD/ETag、代理发布/校验/取消及容量限制。媒体测试需本机安装 ffmpeg/ffprobe。CI 使用 Python 3.11/3.12；Docker 运行层锁定 Python 3.11，依赖由 `uv.lock` 和带 hash 的 `requirements.lock` 锁定。

真实目录验证在仓库根目录执行 `python3 deploy/smoke_indexing.py --restart`，会创建本地测试源，执行扫描、增量、取消、重试并强制结束测试容器内 Worker，验证 Docker 重启后的恢复。仅用于上述独立本地测试容器。

D3 播放验证：`python3 deploy/smoke_playback.py --restart`。在已有真实索引中选择尚未缓存的较短录像，提交兼容准备、检查去重、处理期间强制结束 Worker，等待恢复后验证缓存与 206/416。该脚本会执行真实 CPU 转码；常规复验可省略 `--restart` 复用缓存。

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
| GET `/api/logs` | taskId/sourceId 筛选和游标分页；完整日志筛选/导出仍在 D5 |

扫描频率可选 5/10/30 分钟；创建时省略频率采用已保存默认值，显式 null 表示仅手动。索引存在或任务活动时不能改目录。停用取消未开始的维护任务，已运行任务可完成，历史索引保留。

扫描参数保存源路径/时区和近期文件保护快照；prepare 保存片段 ID、指纹和版本化 profile。源级 scan/reindex 互斥，prepare 使用片段锁；总并行默认 2，媒体槽默认 1。正常停机重新排队；异常最多自动恢复 3 次。用户重试产生新 ID，原任务保留。缩略图取首帧；播放代理为宽度最大 1920 的 H.264/YUV420P，音轨存在时转 AAC，无音轨不补音频。部署可设置 `CLIPLINE_PLAYBACK_MAX_WIDTH` 降低分辨率，`CLIPLINE_PLAYBACK_TIMEOUT_SECONDS` 限制处理时长。

代理指纹/profile 缓存去重，校验成功后在受租约保护的终态事务中发布；取消不暴露半成品。当前执行缓存容量硬限制，LRU 和使用保护清理在 D5 接入。原文件变化或源离线时明确报错，不能按旧索引播放其他文件。

已实现边界和验证结果见 [D1](../docs/qa/D1_FOUNDATION.md)、[D2](../docs/qa/D2_INDEXING.md)及 [D3](../docs/qa/D3_PLAYBACK.md)，后续任务见 [开发清单](../docs/TASKS.md)。
