# Clipline API and Database

## 1. 文档目的

本文档定义 Clipline MVP 的数据库表结构、API 约定、请求响应格式和状态枚举。

本文档是前后端联调的基础契约。

## 2. 通用约定

### 2.1 时间格式

所有 API 时间字段使用 ISO 8601 字符串，并包含时区。

示例：

```text
2026-05-24T10:49:30+08:00
```

日期字段使用：

```text
2026-05-24
```

### 2.2 ID 格式

ID 由后端生成，使用带前缀的字符串。

示例：

```text
src_01JY...
seg_01JY...
thumb_01JY...
scan_01JY...
exp_01JY...
```

### 2.3 分页格式

列表 API 如需分页，使用：

```http
?limit=50&offset=0
```

响应：

```json
{
  "items": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```

### 2.4 错误响应

```json
{
  "error": {
    "code": "INVALID_PATH",
    "message": "路径必须位于 /recordings 下",
    "details": {
      "path": "/app/data"
    }
  }
}
```

常见错误码：

- `VALIDATION_ERROR`。
- `NOT_FOUND`。
- `INVALID_PATH`。
- `PATH_NOT_READABLE`。
- `DUPLICATE_SOURCE_PATH`。
- `SCAN_ALREADY_RUNNING`。
- `SEGMENT_NOT_PLAYABLE`。
- `EXPORT_RANGE_TOO_LONG`。
- `EXPORT_NOT_READY`。
- `EXPORT_EXPIRED`。
- `FFMPEG_ERROR`。
- `INTERNAL_ERROR`。

### 2.5 请求追踪

- 后端会透传请求头 `X-Request-ID`。
- 如果请求未携带 `X-Request-ID`，后端自动生成一个。
- 响应头会返回本次请求的 `X-Request-ID`。
- 应用日志会记录 request_id，便于从 UI 日志面板定位一次请求。

## 3. 状态枚举

### 3.1 scan_status

- `pending`。
- `indexed`。
- `failed`。
- `missing`。

### 3.2 job_status

- `queued`。
- `running`。
- `completed`。
- `failed`。
- `canceled`。
- `expired`。

### 3.3 export_mode

- `fast`。
- `accurate`。

### 3.4 time_source

- `filename`。
- `directory`。
- `metadata`。
- `mtime_minus_duration`。
- `mtime`。

## 4. 数据库表

### 4.1 sources

录像源。用户在 Web UI 中创建。

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(path)
);

CREATE INDEX idx_sources_enabled ON sources(enabled);
```

字段说明：

- `id`：系统自动生成。
- `name`：用户填写的源名称，例如“门口摄像头”。
- `path`：容器内视频目录，例如 `/recordings/front-door`。
- `enabled`：是否启用。

### 4.2 video_segments

视频片段索引。

```sql
CREATE TABLE video_segments (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime TEXT,
  ctime TEXT,
  start_time TEXT,
  end_time TEXT,
  duration_seconds REAL,
  time_source TEXT,
  time_confidence REAL,
  container TEXT,
  video_codec TEXT,
  audio_codec TEXT,
  width INTEGER,
  height INTEGER,
  fps REAL,
  playable INTEGER NOT NULL DEFAULT 0,
  needs_transcode INTEGER NOT NULL DEFAULT 0,
  scan_status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE UNIQUE INDEX idx_video_segments_source_path
  ON video_segments(source_id, path);

CREATE INDEX idx_video_segments_source_time
  ON video_segments(source_id, start_time, end_time);

CREATE INDEX idx_video_segments_scan_status
  ON video_segments(scan_status);
```

字段说明：

- `path`：容器内源文件绝对路径。
- `start_time`：推断片段开始时间。
- `end_time`：推断片段结束时间。
- `time_source`：时间推断来源。
- `time_confidence`：时间推断置信度，取值 0 到 1。
- `playable`：浏览器是否可直接播放。
- `needs_transcode`：是否需要转码预览或精准导出。

说明：

- `scan_status = indexed` 的记录必须有 `start_time`、`end_time`、`duration_seconds`。
- `scan_status = pending` 或 `failed` 的记录允许时间和时长为空。

### 4.3 thumbnails

缩略图缓存。P1 表。

```sql
CREATE TABLE thumbnails (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  timestamp_seconds REAL NOT NULL,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (segment_id) REFERENCES video_segments(id)
);

CREATE INDEX idx_thumbnails_segment_id
  ON thumbnails(segment_id);
```

### 4.4 export_jobs

导出任务。

```sql
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  has_gaps INTEGER NOT NULL DEFAULT 0,
  gap_duration_seconds REAL NOT NULL DEFAULT 0,
  output_path TEXT,
  output_size_bytes INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX idx_export_jobs_source_created
  ON export_jobs(source_id, created_at);

CREATE INDEX idx_export_jobs_status
  ON export_jobs(status);
```

### 4.5 scan_jobs

扫描任务。

```sql
CREATE TABLE scan_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  status TEXT NOT NULL,
  scanned_files INTEGER NOT NULL DEFAULT 0,
  indexed_files INTEGER NOT NULL DEFAULT 0,
  failed_files INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX idx_scan_jobs_source_created
  ON scan_jobs(source_id, created_at);

CREATE INDEX idx_scan_jobs_status
  ON scan_jobs(status);
```

## 5. API

所有 API 以 `/api` 为前缀。

### 5.1 源管理

#### GET /api/sources

返回所有源。

响应：

```json
{
  "items": [
    {
      "id": "src_001",
      "name": "门口摄像头",
      "path": "/recordings/front-door",
      "enabled": true,
      "createdAt": "2026-05-24T10:00:00+08:00",
      "updatedAt": "2026-05-24T10:00:00+08:00",
      "lastScanAt": "2026-05-24T10:05:00+08:00",
      "segmentCount": 120,
      "failedCount": 2
    }
  ]
}
```

#### POST /api/sources

创建源。创建成功后自动触发首次扫描。

请求：

```json
{
  "name": "门口摄像头",
  "path": "/recordings/front-door"
}
```

响应：

```json
{
  "id": "src_001",
  "name": "门口摄像头",
  "path": "/recordings/front-door",
  "enabled": true,
  "createdAt": "2026-05-24T10:00:00+08:00",
  "updatedAt": "2026-05-24T10:00:00+08:00",
  "scanJobId": "scan_001"
}
```

校验：

- `name` 不能为空。
- `path` 必须是绝对路径。
- `path` 必须位于 `/recordings` 下。
- `path` 必须存在且可读。
- `path` 不能与已有源重复。

#### PATCH /api/sources/{sourceId}

更新源。

请求：

```json
{
  "name": "门口摄像头",
  "path": "/recordings/front-door",
  "enabled": true
}
```

响应：

```json
{
  "id": "src_001",
  "name": "门口摄像头",
  "path": "/recordings/front-door",
  "enabled": true,
  "updatedAt": "2026-05-24T10:10:00+08:00"
}
```

#### POST /api/sources/{sourceId}/scan

手动触发扫描。

响应：

```json
{
  "scanJobId": "scan_001",
  "status": "queued"
}
```

说明：

- 如果该源已有 `queued` 或 `running` 扫描任务，接口返回已有任务的 `scanJobId` 和当前 `status`。
- 如果源已停用，接口返回 `409`。

### 5.2 目录树

#### GET /api/recording-directories

返回可选择的视频目录树。

查询参数：

- `path`：可选，默认 `/recordings`，必须位于系统配置的录像根目录内。
- `depth`：默认 `2`。

示例：

```http
GET /api/recording-directories?path=/recordings&depth=2
```

响应：

```json
{
  "root": "/recordings",
  "items": [
    {
      "name": "front-door",
      "path": "/recordings/front-door",
      "readable": true,
      "hasChildren": false
    },
    {
      "name": "dashcam",
      "path": "/recordings/dashcam",
      "readable": true,
      "hasChildren": true
    }
  ]
}
```

### 5.3 扫描任务

#### GET /api/scan-jobs

返回最近扫描任务。

查询参数：

- `sourceId`：可选，按源过滤。
- `status`：可选，按任务状态过滤。
- `limit`：默认 `10`，范围 `1` 到 `100`。
- `offset`：默认 `0`。

响应：

```json
{
  "items": [
    {
      "id": "scan_001",
      "sourceId": "src_001",
      "status": "completed",
      "scannedFiles": 80,
      "indexedFiles": 76,
      "failedFiles": 4,
      "startedAt": "2026-05-24T10:00:00+08:00",
      "finishedAt": "2026-05-24T10:00:30+08:00",
      "errorMessage": null,
      "createdAt": "2026-05-24T10:00:00+08:00",
      "updatedAt": "2026-05-24T10:00:30+08:00"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

#### GET /api/scan-jobs/{scanJobId}

返回扫描任务状态。

响应：

```json
{
  "id": "scan_001",
  "sourceId": "src_001",
  "status": "running",
  "scannedFiles": 80,
  "indexedFiles": 76,
  "failedFiles": 4,
  "startedAt": "2026-05-24T10:00:00+08:00",
  "finishedAt": null,
  "errorMessage": null,
  "createdAt": "2026-05-24T10:00:00+08:00",
  "updatedAt": "2026-05-24T10:00:10+08:00"
}
```

### 5.4 时间线

#### GET /api/timeline

查询某个源某天的时间线。

查询参数：

- `sourceId`：必填。
- `date`：必填，格式 `YYYY-MM-DD`。

示例：

```http
GET /api/timeline?sourceId=src_001&date=2026-05-24
```

响应：

```json
{
  "sourceId": "src_001",
  "date": "2026-05-24",
  "timezone": "Asia/Shanghai",
  "segments": [
    {
      "id": "seg_001",
      "startTime": "2026-05-24T10:49:00+08:00",
      "endTime": "2026-05-24T10:50:00+08:00",
      "durationSeconds": 60,
      "playable": true,
      "needsTranscode": false,
      "thumbnailUrl": null
    }
  ],
  "gaps": [
    {
      "startTime": "2026-05-24T10:50:00+08:00",
      "endTime": "2026-05-24T10:52:00+08:00",
      "durationSeconds": 120
    }
  ]
}
```

### 5.5 片段

#### GET /api/segments

查询片段索引列表。MVP 主要用于扫描失败文件明细。

查询参数：

- `sourceId`：可选，按源过滤。
- `scanStatus`：可选，按扫描状态过滤，例如 `failed`。
- `limit`：默认 `50`，范围 `1` 到 `200`。
- `offset`：默认 `0`。

示例：

```http
GET /api/segments?sourceId=src_001&scanStatus=failed&limit=20
```

响应：

```json
{
  "items": [
    {
      "id": "seg_001",
      "sourceId": "src_001",
      "filename": "broken.mp4",
      "path": "/recordings/front-door/broken.mp4",
      "sizeBytes": 128,
      "startTime": null,
      "endTime": null,
      "durationSeconds": null,
      "container": null,
      "videoCodec": null,
      "audioCodec": null,
      "width": null,
      "height": null,
      "fps": null,
      "playable": false,
      "needsTranscode": false,
      "scanStatus": "failed",
      "errorMessage": "ffprobe failed"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

#### GET /api/segments/{segmentId}

返回片段详情。

响应：

```json
{
  "id": "seg_001",
  "sourceId": "src_001",
  "filename": "20260524_104900.mp4",
  "path": "/recordings/front-door/20260524_104900.mp4",
  "sizeBytes": 10485760,
  "startTime": "2026-05-24T10:49:00+08:00",
  "endTime": "2026-05-24T10:50:00+08:00",
  "durationSeconds": 60,
  "container": "mov,mp4,m4a,3gp,3g2,mj2",
  "videoCodec": "h264",
  "audioCodec": "aac",
  "width": 1920,
  "height": 1080,
  "fps": 25,
  "playable": true,
  "needsTranscode": false,
  "scanStatus": "indexed",
  "errorMessage": null
}
```

#### GET /api/segments/{segmentId}/stream

返回视频文件流。

要求：

- 支持 Range 请求。
- 不允许通过任意路径读取。
- 只能根据 segment id 访问源文件。

响应：

- `200 OK` 或 `206 Partial Content`。
- `Content-Type` 根据容器格式返回。
- `Accept-Ranges: bytes`。

#### GET /api/segments/resolve

根据真实时间解析到具体片段和片段内偏移。

查询参数：

- `sourceId`。
- `time`。

示例：

```http
GET /api/segments/resolve?sourceId=src_001&time=2026-05-24T10:49:30+08:00
```

响应：

```json
{
  "segmentId": "seg_001",
  "streamUrl": "/api/segments/seg_001/stream",
  "offsetSeconds": 30,
  "startTime": "2026-05-24T10:49:00+08:00",
  "endTime": "2026-05-24T10:50:00+08:00",
  "playable": true
}
```

如果目标时间无录像：

```json
{
  "segmentId": null,
  "nearestPrevious": {
    "segmentId": "seg_000",
    "time": "2026-05-24T10:48:59+08:00"
  },
  "nearestNext": {
    "segmentId": "seg_002",
    "time": "2026-05-24T10:52:00+08:00"
  }
}
```

### 5.6 缩略图

#### GET /api/thumbnails/{thumbnailId}

返回缩略图文件。P1 能力。

响应：

- `200 OK`。
- `Content-Type: image/jpeg`。

#### POST /api/segments/{segmentId}/thumbnails

重新生成缩略图。P1 能力。

响应：

```json
{
  "thumbnailId": "thumb_001",
  "status": "queued"
}
```

### 5.7 导出

#### POST /api/exports

创建导出任务。

请求：

```json
{
  "sourceId": "src_001",
  "startTime": "2026-05-24T10:49:30+08:00",
  "endTime": "2026-05-24T10:50:20+08:00",
  "mode": "accurate"
}
```

响应：

```json
{
  "exportId": "exp_001",
  "status": "queued"
}
```

校验：

- `sourceId` 必须存在且启用。
- `startTime` 必须早于 `endTime`。
- 导出最长默认不超过 30 分钟。
- 必须存在至少一个相交片段。
- 如果导出区间包含断档，MVP 默认跳过断档，只导出实际存在的录像内容。

#### GET /api/exports

返回导出任务列表。

查询参数：

- `sourceId`：可选。
- `status`：可选。
- `limit`。
- `offset`。

响应：

```json
{
  "items": [
    {
      "id": "exp_001",
      "sourceId": "src_001",
      "sourceName": "门口摄像头",
      "startTime": "2026-05-24T10:49:30+08:00",
      "endTime": "2026-05-24T10:50:20+08:00",
      "mode": "accurate",
      "status": "completed",
      "progress": 1,
      "hasGaps": true,
      "gapDurationSeconds": 120,
      "outputSizeBytes": 52428800,
      "downloadUrl": "/api/exports/exp_001/download",
      "errorMessage": null,
      "createdAt": "2026-05-24T11:00:00+08:00",
      "updatedAt": "2026-05-24T11:01:00+08:00",
      "expiresAt": "2026-05-25T11:01:00+08:00"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### GET /api/exports/{exportId}

返回导出任务状态。

响应：

```json
{
  "id": "exp_001",
  "sourceId": "src_001",
  "startTime": "2026-05-24T10:49:30+08:00",
  "endTime": "2026-05-24T10:50:20+08:00",
  "mode": "accurate",
  "status": "running",
  "progress": 0.45,
  "hasGaps": true,
  "gapDurationSeconds": 120,
  "outputSizeBytes": null,
  "downloadUrl": null,
  "errorMessage": null,
  "createdAt": "2026-05-24T11:00:00+08:00",
  "updatedAt": "2026-05-24T11:00:30+08:00",
  "expiresAt": null
}
```

#### GET /api/exports/{exportId}/download

下载导出文件。

要求：

- 任务必须是 completed。
- 文件必须存在。
- 文件必须位于 `/app/data/exports` 下。

失败：

- 未完成返回 `EXPORT_NOT_READY`。
- 文件过期返回 `NOT_FOUND` 或 `EXPORT_EXPIRED`。

#### DELETE /api/exports/{exportId}

删除导出文件和对应任务记录。P1 能力。

要求：

- 只能删除已完成、失败、取消或过期的任务。
- 如果输出文件存在，必须位于 `/app/data/exports` 下。

响应：

```json
{
  "deleted": true
}
```

### 5.8 系统状态

#### GET /api/system/status

返回系统状态、运行路径、日志配置和源概览。

响应：

```json
{
  "version": "0.1.0",
  "ffmpeg": {
    "available": true
  },
  "ffprobe": {
    "available": true
  },
  "database": {
    "available": true,
    "path": "/app/data/clipline.db"
  },
  "logging": {
    "level": "INFO",
    "format": "text",
    "file": "/app/data/logs/clipline.log"
  },
  "recordingsRoot": {
    "path": "/recordings",
    "readable": true
  },
  "cache": {
    "thumbnailBytes": 104857600,
    "exportBytes": 524288000
  },
  "sources": [
    {
      "id": "src_001",
      "name": "门口摄像头",
      "path": "/recordings/front-door",
      "enabled": true,
      "createdAt": "2026-05-24T10:00:00+08:00",
      "updatedAt": "2026-05-24T10:00:00+08:00",
      "lastScanAt": "2026-05-24T10:05:00+08:00",
      "segmentCount": 120,
      "failedCount": 2
    }
  ]
}
```

#### GET /api/system/logs

返回应用日志文件最近 N 行。

查询参数：

- `lines`：默认 `200`，范围 `1` 到 `2000`。

示例：

```http
GET /api/system/logs?lines=200
```

响应：

```json
{
  "path": "/app/data/logs/clipline.log",
  "lines": [
    "2026-05-24 18:46:13,155 INFO [6230597ef3da4fa0] app.services.scanner: scan job completed scanned_files=2"
  ]
}
```

## 6. 前端类型建议

```ts
export interface Source {
  id: string
  name: string
  path: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastScanAt?: string | null
  segmentCount?: number
  failedCount?: number
}

export interface TimelineSegment {
  id: string
  startTime: string
  endTime: string
  durationSeconds: number
  playable: boolean
  needsTranscode: boolean
  thumbnailUrl?: string | null
}

export interface TimelineGap {
  startTime: string
  endTime: string
  durationSeconds: number
}

export interface TimelineResponse {
  sourceId: string
  date: string
  timezone: string
  segments: TimelineSegment[]
  gaps: TimelineGap[]
}

export interface ExportJob {
  id: string
  sourceId: string
  sourceName?: string
  startTime: string
  endTime: string
  mode: 'fast' | 'accurate'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'expired'
  progress: number
  hasGaps: boolean
  gapDurationSeconds: number
  outputSizeBytes?: number | null
  downloadUrl?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  expiresAt?: string | null
}
```

## 7. API 优先级

### 7.1 P0

- `GET /api/sources`
- `POST /api/sources`
- `PATCH /api/sources/{sourceId}`
- `POST /api/sources/{sourceId}/scan`
- `GET /api/recording-directories`
- `GET /api/scan-jobs`
- `GET /api/scan-jobs/{scanJobId}`
- `GET /api/timeline`
- `GET /api/segments`
- `GET /api/segments/{segmentId}`
- `GET /api/segments/{segmentId}/stream`
- `GET /api/segments/resolve`
- `POST /api/exports`
- `GET /api/exports`
- `GET /api/exports/{exportId}`
- `GET /api/exports/{exportId}/download`
- `GET /api/system/status`
- `GET /api/system/logs`

### 7.2 P1

- `GET /api/thumbnails/{thumbnailId}`
- `POST /api/segments/{segmentId}/thumbnails`
- `DELETE /api/exports/{exportId}`
