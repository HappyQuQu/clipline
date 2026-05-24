# Clipline Technical Design

## 1. 文档目的

本文档定义 Clipline MVP 的技术架构、模块边界、核心流程、文件安全策略和开发拆分。

目标是支持一个轻量、单机、Docker 部署的录像片段时间线回放工具。

## 2. 总体架构

Clipline 第一版采用轻量单体架构。

```text
Browser
  |
  | HTTP / WebSocket
  |
FastAPI Backend
  |
  +-- Static Frontend
  +-- SQLite
  +-- Scanner Worker
  +-- Export Worker
  +-- FFmpeg / ffprobe
  +-- Structured Logging
  +-- Thumbnail Cache
  +-- Export Cache
  +-- Read-only Recordings Mounts
```

## 3. 技术栈

### 3.1 前端

- React。
- TypeScript。
- Vite。
- Tailwind CSS。
- Radix UI。
- TanStack Query。
- lucide-react。
- 原生 HTML video。

### 3.2 后端

- Python。
- FastAPI。
- Uvicorn。
- SQLAlchemy。
- SQLite。
- FFmpeg。
- ffprobe。

说明：MVP 使用 SQLAlchemy 初始化 SQLite schema；Alembic 迁移放到 P1。

### 3.3 部署

- 单容器 Docker。
- Docker Compose。
- 前端构建产物由后端静态服务托管。
- 源视频目录通过只读 volume 挂载到 `/recordings`。
- 应用数据通过 volume 挂载到 `/app/data`。

## 4. 目录结构建议

```text
clipline/
  backend/
    app/
      core/
      services/
      api.py
      db.py
      models.py
      schemas.py
      main.py
    pyproject.toml
  frontend/
    src/
      App.tsx
      api.ts
      main.tsx
      styles.css
      types.ts
    package.json
  docs/
  docker/
  Dockerfile
  docker-compose.yml
```

## 5. 运行时目录

```text
/app/data
  clipline.db
  thumbnails/
  exports/
  tmp/
  logs/

/recordings
  front-door/
  dashcam/
  living-room/
```

约束：

- `/recordings` 只读。
- `/app/data` 可读写。
- 源文件永不修改、移动、删除。
- 所有缓存、临时文件、导出文件只写入 `/app/data`。

## 6. 配置

### 6.1 环境变量

```text
TZ=Asia/Shanghai
CLIPLINE_PORT=8080
CLIPLINE_DB=/app/data/clipline.db
CLIPLINE_DATA=/app/data
CLIPLINE_RECORDINGS_ROOT=/recordings
CLIPLINE_SCAN_INTERVAL_SECONDS=300
CLIPLINE_EXPORT_TTL_HOURS=24
CLIPLINE_MAX_EXPORT_MINUTES=30
CLIPLINE_MAX_CONCURRENT_EXPORTS=1
CLIPLINE_THUMBNAIL_MODE=middle
CLIPLINE_SKIP_RECENT_SECONDS=30
CLIPLINE_LOG_LEVEL=INFO
CLIPLINE_LOG_FORMAT=text
CLIPLINE_LOG_FILE=/app/data/logs/clipline.log
```

### 6.2 配置文件

配置文件只保存应用级配置。录像源由用户在 Web UI 中创建，并持久化到 SQLite。

```yaml
app:
  port: 8080
  timezone: Asia/Shanghai
  recordings_root: /recordings

scanner:
  interval_seconds: 300

exports:
  ttl_hours: 24
  max_minutes: 30
  max_concurrent: 1

thumbnails:
  mode: middle
  width: 320
  quality: 80
```

## 7. 后端模块

### 7.1 API 层

职责：

- 提供 REST API。
- 提供 OpenAPI 文档。
- 提供前端静态文件。
- 校验请求参数。
- 统一错误响应。

主要 API：

- 源管理。
- 目录树。
- 时间线。
- 片段播放。
- P1 缩略图。
- 导出任务。
- 系统状态。

### 7.2 数据访问层

职责：

- 管理 SQLite 连接。
- 管理事务。
- 提供 repository 或 service 封装。
- 使用 Alembic 管理 schema 迁移。

### 7.3 源管理服务

职责：

- 创建源。
- 编辑源。
- 启用或停用源。
- 校验源路径。
- 自动触发首次扫描。

路径校验规则：

- 必须是绝对路径。
- 必须位于 `CLIPLINE_RECORDINGS_ROOT` 下。
- 规范化路径后不能逃逸录像根目录。
- 不能包含路径穿越。
- 必须存在。
- 必须可读。
- 不能与已有源路径重复。

### 7.4 目录浏览服务

职责：

- 返回 `/recordings` 下的目录树。
- 只返回目录，不返回视频文件。
- 标记不可读目录。
- 限制最大扫描深度。
- 支持按需展开，避免一次遍历大目录。
- API 请求只能传当前目录 `path`，后端必须校验该路径位于 `CLIPLINE_RECORDINGS_ROOT` 内。

建议：

- MVP 默认返回 2 到 3 层。
- 后续支持搜索目录。

### 7.5 扫描服务

职责：

- 遍历源目录。
- 过滤支持的视频扩展名。
- 检测文件是否稳定。
- 调用 ffprobe 提取元数据。
- 推断视频开始时间和结束时间。
- 写入或更新 `video_segments`。
- 记录扫描任务状态。

增量扫描策略：

- 使用 path、size、mtime 判断文件是否变化。
- 未变化文件跳过 ffprobe。
- 已删除文件或源路径变更后的旧文件记录需要在扫描完成后清理。
- 同一源已有 `queued` 或 `running` 扫描任务时，手动扫描复用已有任务，避免重复排队。

正在写入文件策略：

- 跳过最近 N 秒内修改的文件。
- 或连续两次检测 size 一致后再处理。
- 未稳定文件标记 pending。

### 7.6 时间解析服务

时间推断优先级：

1. 常见文件名格式。
2. 目录名和文件名组合。
3. 视频 metadata 时间。
4. 文件修改时间减去视频时长。
5. 文件修改时间作为开始时间。

MVP 内置识别格式：

```text
20260524_104902.mp4
2026-05-24_10-49-02.mp4
2026_05_24_10_49_02.mp4
VID_20260524_104902.mp4
ch01_20260524104902.mp4
Camera1/2026/05/24/10/49/02.mp4
```

建议保存：

- `start_time`。
- `end_time`。
- `duration_seconds`。
- `time_source`。
- `time_confidence`。

`time_source` 可选值：

- filename。
- directory。
- metadata。
- mtime_minus_duration。
- mtime。

`time_confidence` 取值 0 到 1，用于表达时间推断可靠程度。

### 7.7 缩略图服务

P1 能力。

MVP 策略：

- 每个视频取中间一帧。
- 输出 JPEG。
- 缓存到 `/app/data/thumbnails`。
- 生成失败时记录错误，并使用占位图。

命令示例：

```text
ffmpeg -ss {middle_time} -i input.mp4 -frames:v 1 thumbnail.jpg
```

### 7.8 播放服务

职责：

- 根据 segment id 返回视频流。
- 支持 HTTP Range 请求。
- 设置正确 Content-Type。
- 不允许通过任意路径读取文件。

安全规则：

- API 只能通过 segment id 访问视频。
- segment path 必须属于已配置源目录。
- 源目录必须位于录像根目录内。

### 7.9 时间线服务

职责：

- 按源和日期查询片段。
- 返回当天录像区间。
- 计算断档。
- 返回片段摘要和缩略图地址。

断档计算：

```text
previous_end = day_start

for segment in segments:
    if segment.start_time > previous_end:
        gap = previous_end -> segment.start_time
    previous_end = max(previous_end, segment.end_time)

if previous_end < day_end:
    gap = previous_end -> day_end
```

### 7.10 导出服务

职责：

- 创建导出任务。
- 校验导出时间范围。
- 查询相交片段。
- 检测导出区间是否包含断档。
- 裁剪临时片段。
- 合并输出 MP4。
- 更新任务状态和进度。
- 清理临时文件。

时间范围匹配：

```sql
SELECT *
FROM video_segments
WHERE source_id = ?
  AND end_time > ?
  AND start_time < ?
ORDER BY start_time ASC;
```

单片段裁剪计算：

```text
clip_start = max(request_start, segment_start)
clip_end = min(request_end, segment_end)
offset = clip_start - segment_start
duration = clip_end - clip_start
```

断档处理：

- MVP 默认跳过断档，只导出实际存在的录像内容。
- 不补黑场，不补静音。
- 导出任务记录 `has_gaps` 和 `gap_duration_seconds`。
- 前端提交前必须提示输出视频时长可能短于选择区间。

快速导出：

```text
ffmpeg -ss {offset} -i input.mp4 -t {duration} -c copy temp.mp4
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
```

精准导出：

```text
ffmpeg -ss {offset} -i input.mp4 -t {duration} \
  -c:v libx264 -preset veryfast -crf 20 \
  -c:a aac -movflags +faststart temp.mp4
```

## 8. 后台任务

MVP 使用应用内 worker，不引入 Redis。

任务类型：

- scan。
- P1 thumbnail。
- export。

建议实现：

- 启动时创建 worker loop。
- 任务写入 SQLite。
- worker 从数据库中拉取 queued 任务。
- 单实例按状态锁定任务。
- 任务状态变更写入数据库。

状态：

- queued。
- running。
- completed。
- failed。
- canceled。

限制：

- 扫描任务可以串行。
- 同一源同一时间只允许一个活跃扫描任务。
- 导出任务默认同时 1 个。
- P1 缩略图任务可以低优先级执行。

## 9. 前端模块

### 9.1 页面

- PlaybackPage。
- SettingsPage。
- ExportJobsPage。

### 9.2 核心组件

- SourceSelector。
- DatePicker。
- VideoPlayer。
- Timeline。
- SegmentList。
- ExportRangeSelector。
- ExportJobList。
- SourceForm。
- DirectoryPicker。
- SystemStatusPanel。

### 9.3 数据请求

使用 TanStack Query：

- 缓存源列表。
- 缓存时间线数据。
- 定时刷新源列表、导出任务和日志。
- 扫描任务排队后刷新源列表、时间线和日志。
- 导出完成后刷新任务列表。

### 9.4 UI 组件

使用 Radix UI 承载复杂交互：

- Select：源选择。
- Switch：源启用或停用。
- ToggleGroup：导出模式切换。
- Toast：操作反馈。

使用 Tailwind CSS 作为样式工具链，保留少量语义 class 来维持工作台页面的可读性和稳定布局。

## 10. 文件安全

必须遵守：

- 禁止任意路径读取。
- 禁止 `../` 路径穿越。
- 所有路径先规范化再校验。
- 源路径必须位于 `CLIPLINE_RECORDINGS_ROOT` 下。
- 视频播放必须通过 segment id。
- 缩略图必须通过 thumbnail id。
- 导出下载必须通过 export job id。
- 导出文件必须位于 `/app/data/exports` 下。

## 11. 可观测性

日志能力：

- 控制台日志和轮转文件日志同时输出。
- 默认文件路径为 `/app/data/logs/clipline.log`。
- 支持 `text` 和 `json` 两种格式。
- 每个 HTTP 请求生成或透传 `X-Request-ID`。
- 请求日志包含 method、path、status_code、elapsed_ms。
- 业务日志记录源创建/编辑、扫描开始/完成/失败、ffprobe 错误、导出开始/完成/失败。
- `GET /api/system/logs` 返回最近 N 行应用日志，便于 UI 内查看。

状态页展示：

- 版本号。
- FFmpeg 是否可用。
- SQLite 是否可用。
- 录像根目录是否可读。
- 每个源是否可读。
- P1 缩略图缓存大小。
- 导出缓存大小。
- 最近一次扫描时间。

## 12. Docker Compose 示例

```yaml
services:
  clipline:
    image: clipline/clipline:latest
    container_name: clipline
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - /volume1/camera/front-door:/recordings/front-door:ro
      - /volume1/dashcam:/recordings/dashcam:ro
    environment:
      - TZ=Asia/Shanghai
      - CLIPLINE_DB=/app/data/clipline.db
      - CLIPLINE_DATA=/app/data
      - CLIPLINE_RECORDINGS_ROOT=/recordings
      - CLIPLINE_LOG_LEVEL=INFO
      - CLIPLINE_LOG_FORMAT=text
    restart: unless-stopped
```

## 13. 开发里程碑

### 13.1 Milestone 1: 项目骨架

- 后端 FastAPI 项目。
- 前端 Vite 项目。
- Dockerfile。
- Docker Compose。
- SQLite 初始化。
- 前端静态文件托管。

### 13.2 Milestone 2: 源管理

- 源表。
- 源 API。
- 目录树 API。
- 设置页源列表。
- 新建源表单。
- 路径安全校验。

### 13.3 Milestone 3: 扫描索引

- scan_jobs 表。
- 扫描 worker。
- ffprobe 集成。
- 时间推断。
- 增量扫描。
- 扫描状态展示。

### 13.4 Milestone 4: 回看

- timeline API。
- segments API。
- Range stream。
- 回看页。
- 时间线组件。
- 片段列表。
- 单片段播放。
- 连续播放。

### 13.5 Milestone 5: 导出

- export_jobs 表。
- 导出 API。
- 导出 worker。
- 快速导出。
- 精准导出。
- 导出任务页。
- 下载接口。

### 13.6 Milestone 6: 收尾

- P1 缩略图。
- 系统状态页。
- 错误处理。
- 日志。
- 验收测试。
- 文档整理。
