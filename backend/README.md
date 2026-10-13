# Clipline 一期后端

当前实现 D1 运行基础及 D2 后台索引：版本化 SQLite、目录边界与分页浏览、统一 API 错误、配置读取、健康/架构信息、独立 Worker 和容器进程管理，以及真实源配置、持久化扫描/重建队列、FFprobe 元数据、缩略图与增量索引。

`/api/capabilities` 中 scan/reindex 为 true，playback/prepare/export 与识别能力为 false。Worker 支持取消、用户重试、异常恢复及定时扫描。播放准备和导出在 D3/D4 接入；容器内页面仍是交互原型，页面操作尚未接真实后端。

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

64 项测试覆盖迁移/升级保护、目录边界、幂等与领取竞争、租约隔离、资源限额、取消/重试/恢复、真实合成媒体探测、文件稳定性、离线/部分扫描保护、跨日搜索和游标分页。媒体测试需本机安装 ffmpeg/ffprobe。CI 使用 Python 3.11/3.12；Docker 运行层锁定 Python 3.11，依赖由 `uv.lock` 和带 hash 的 `requirements.lock` 锁定。

真实目录验证在仓库根目录执行 `python3 deploy/smoke_indexing.py --restart`，会创建本地测试源，执行扫描、增量、取消、重试并强制结束测试容器内 Worker，验证 Docker 重启后的恢复。仅用于上述独立本地测试容器。

## 当前 API

| 接口 | 已实现行为 |
| --- | --- |
| GET/POST `/api/sources`；PATCH `/api/sources/{id}` | 创建/编辑/启停；可同事务创建首次扫描；配置 revision 冲突检测 |
| POST `/api/sources/{id}/scan`；POST `/api/tasks` | 提交 scan/reindex，202 返回 taskId；支持 Idempotency-Key 和活动任务复用 |
| GET `/api/tasks`、`/{id}`；POST `/{id}/cancel`、`/{id}/retry` | 状态/类型/源筛选及分页、尝试记录、取消和新 ID 重试 |
| GET `/api/segments`、`/{id}`、`/{id}/thumbnail` | 源/本地日/文件名或起止时刻搜索、稳定分页、真实元数据和 JPEG |
| GET `/api/logs` | taskId/sourceId 筛选和游标分页；完整日志筛选/导出仍在 D5 |

扫描频率可选 5/10/30 分钟；创建时省略频率采用已保存默认值，显式 null 表示仅手动。索引存在或任务活动时不能改目录。停用取消未开始的维护任务，已运行任务可完成，历史索引保留。

任务参数保存源路径/时区和近期文件保护快照。源级 scan/reindex 互斥；总并行默认 2，媒体槽默认 1。正常停机保留任务并重新排队；异常最多自动恢复 3 次。用户重试产生新任务 ID，原任务保留。缩略图取首个视频帧，避免部分 NAS HEVC 文件中点定位耗时过长。

已实现边界和验证结果见 [D1 记录](../docs/qa/D1_FOUNDATION.md)及 [D2 记录](../docs/qa/D2_INDEXING.md)，后续任务见 [开发清单](../docs/TASKS.md)。
