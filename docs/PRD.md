# Clipline PRD

## 1. 产品概述

### 1.1 产品名称

Clipline

### 1.2 一句话定位

Clipline 是一个 Docker 部署的 NAS 录像片段时间线回放工具，用来把分散在文件夹里的短视频片段整理成可连续预览、回放和导出的时间线。

### 1.3 产品背景

很多行车记录仪、家用摄像头、智能门铃、运动相机、米家摄像头等设备会把录像保存成多个短视频文件。部分设备支持把录像同步到 NAS，但最终文件通常仍然是几分钟一段。

这种保存方式对设备友好，但对人工回看很不友好：

- 用户需要一个一个打开文件。
- 很难按真实时间定位某个时刻。
- 视频跨文件时，回看和下载都被打断。
- 需要导出某段证据视频时，经常要手动裁剪、合并。
- 普通媒体库软件更适合影视内容，不适合按时间回看监控类片段。
- 完整 NVR 软件又过重，包含大量摄像头接入、录像调度、告警和设备管理能力。

Clipline 只解决一个问题：让用户轻松查看已经存在于 NAS 或磁盘目录中的录像片段。

### 1.4 产品目标

- 将零散录像文件组织成一条连续时间线。
- 支持按日期、时间、片段快速回看。
- 支持跨文件连续播放。
- 支持跨文件导出一个完整视频。
- 支持 Docker 部署，方便运行在 NAS、家庭服务器、小主机上。
- 默认只读挂载源视频目录，避免误删和破坏原始录像。

### 1.5 非目标

Clipline 第一阶段不做以下能力：

- 不接管摄像头。
- 不负责实时直播。
- 不负责录像计划。
- 不负责摄像头码流管理。
- 不做完整 NVR 权限、告警、设备管理。
- 不直接修改、移动、删除源视频文件。
- 不做家庭安防系统。
- 不强依赖 AI 检测。

## 2. 用户与场景

### 2.1 目标用户

#### 家用摄像头用户

用户家里有米家、小米、萤石、Tapo、UniFi 或其他摄像头，录像通过设备自身能力保存到 NAS 或共享目录。用户希望像看连续录像一样回看这些碎片视频。

#### 行车记录仪用户

用户把行车记录仪 SD 卡或自动同步文件夹挂载到服务器，希望按日期和时间快速找到路上的某一段录像，并导出完整片段。

#### 小型店铺或办公室用户

用户有少量摄像头，但不想部署复杂 NVR，只想把已有录像片段快速浏览、下载、备份。

#### 家庭服务器/NAS 用户

用户熟悉 Docker 和路径映射，希望部署一个轻量服务专门处理录像片段回看。

### 2.2 核心使用场景

#### 场景 A：按日期快速回看

用户打开 Clipline，选择某个摄像头或文件夹，再选择日期。系统显示当天所有可用片段和时间线。用户拖动时间线即可跳转播放。

#### 场景 B：连续播放碎片视频

用户点击一个片段开始播放。当前片段播放结束后，Clipline 自动播放时间上紧接着的下一个片段。如果两个片段之间有断档，界面显示断档提示。

#### 场景 C：导出跨文件片段

用户选择 `10:49:30` 到 `10:50:20`。这段时间可能跨越两个源视频文件。Clipline 后端自动裁剪相关文件并合并成一个完整的 `50s` MP4 下载文件。

#### 场景 D：快速浏览当天发生过什么

用户不想逐段播放，只想大致扫一遍当天片段。Clipline MVP 提供片段列表、底部片段条、时间线密度显示，帮助用户快速定位可能有价值的片段。P1 增加缩略图网格。

#### 场景 E：源视频目录持续新增

摄像头持续向 NAS 写入新文件。Clipline 周期扫描目录或监听文件变化，将新片段加入索引，不影响用户正在回看。

## 3. 产品边界

### 3.1 Clipline 是什么

- NAS 视频片段浏览器。
- 本地录像时间线工具。
- 跨片段播放工具。
- 跨片段导出工具。
- 面向已有文件的轻量 Web App。

### 3.2 Clipline 不是什么

- 不是 NVR。
- 不是摄像头管理平台。
- 不是实时监控中心。
- 不是 Jellyfin/Plex 影视媒体库。
- 不是云相册。
- 不是完整视频剪辑软件。

## 4. MVP 范围

### 4.1 MVP 必须包含

- Docker Compose 部署。
- 在 Web UI 中新建一个或多个录像源。
- 为每个录像源选择一个已挂载的视频目录。
- 扫描目录中的视频文件。
- 根据文件名、目录名、文件修改时间推断片段开始时间。
- 使用 ffprobe 获取视频时长、编码、分辨率等元数据。
- 建立 SQLite 索引。
- 按源、日期、时间展示片段。
- Web 播放单个片段。
- 播放结束后自动切换到下一个连续片段。
- 日历选择日期。
- 时间线展示当天有录像的区域和断档。
- 用户选择开始时间和结束时间。
- 后端跨片段导出一个完整 MP4 文件。
- 导出任务进度查看。
- 导出文件下载。
- 基础系统设置页。

### 4.2 MVP 可以延后

- AI 人车检测。
- 运动检测。
- 多摄像头同步播放。
- 实时摄像头流。
- 移动端 PWA。
- 用户多账号权限。
- WebDAV/SMB 内置挂载。
- 云端同步。
- 视频删除和生命周期管理。
- 地图轨迹。
- OCR、水印识别。
- 片段缩略图和缩略图缓存管理。

## 5. 核心功能需求

### 5.1 目录源管理

#### 需求描述

用户可以在 Web UI 中新建一个或多个录像源。每个录像源只需要填写名称，并从容器内可访问的视频目录中选择一个目录。

对用户来说，录像源就是“门口摄像头”“车载记录仪”“客厅摄像头”这类可识别的名称，加上一个对应的视频文件夹。系统内部自动生成源 ID，统一使用系统时区，并默认使用自动时间识别规则。

由于 Clipline 运行在 Docker 容器内，界面中可选择的目录来自已挂载到容器内的只读录像目录，例如 `/recordings`。用户不需要为每个源编写配置文件，也不需要理解 Docker 宿主机路径和容器路径的差异。

#### 功能点

- 支持在界面中新建多个源。
- 新建源时填写源名称。
- 新建源时从可访问的视频目录中选择源路径。
- 支持浏览 `/recordings` 下的目录树。
- 支持手动输入容器内路径，作为高级兜底方式。
- 源路径必须位于允许访问的录像根目录内。
- 源路径在容器内以只读方式访问。
- 系统自动生成源 ID。
- 系统默认使用应用时区。
- 系统默认使用自动时间识别规则。
- 支持编辑源名称和路径。
- 支持手动触发重新扫描。
- 支持启用/停用某个源。
- 禁止多个源使用完全相同的路径。
- 如果选择的目录不可读，创建或保存时应给出明确错误提示。

#### 新建源流程

1. 用户进入设置页。
2. 点击“新建源”。
3. 输入源名称，例如“门口摄像头”。
4. 从目录选择器中选择视频目录，例如 `/recordings/front-door`。
5. 点击保存。
6. 系统校验目录是否存在、是否可读、是否位于允许的录像根目录内。
7. 保存成功后自动触发首次扫描。

#### 目录选择说明

MVP 中，目录选择器只展示容器内已挂载的录像目录。推荐用户在 Docker Compose 中将一个或多个宿主机目录只读挂载到 `/recordings` 下，然后在 Clipline 界面中选择具体子目录。

示例：

```text
/recordings
  front-door/
  dashcam/
  living-room/
```

### 5.2 视频扫描与索引

#### 需求描述

系统扫描源目录下的视频文件，提取元数据并写入数据库。

#### 支持格式

MVP 支持：

- `.mp4`
- `.mov`
- `.mkv`
- `.avi`
- `.ts`
- `.m4v`

后续可扩展：

- `.dav`
- `.264`
- `.265`
- 设备私有格式

#### 扫描字段

- 文件绝对路径。
- 文件大小。
- 文件修改时间。
- 文件创建时间，如果系统可获取。
- 视频容器格式。
- 视频编码。
- 音频编码。
- 分辨率。
- 帧率。
- 时长。
- 推断开始时间。
- 推断结束时间。
- 时间推断来源。
- 时间推断置信度。
- 是否可播放。
- 是否需要转码。
- 索引状态。
- 错误信息。

#### 时间推断优先级

1. 用户配置的文件名规则。
2. 常见时间格式自动识别。
3. 目录名和文件名组合识别。
4. 文件内 metadata 时间。
5. 文件修改时间减去视频时长。
6. 文件修改时间作为开始时间。

#### 常见文件名识别

系统应尽量识别以下模式：

```text
20260524_104902.mp4
2026-05-24_10-49-02.mp4
2026_05_24_10_49_02.mp4
VID_20260524_104902.mp4
ch01_20260524104902.mp4
Camera1/2026/05/24/10/49/02.mp4
```

### 5.3 时间线

#### 需求描述

Clipline 将当天的多个视频片段渲染成一条连续时间线。

#### 功能点

- 支持按天查看。
- 时间线显示 00:00 到 24:00。
- 有录像的区间高亮。
- 没有录像的区间显示断档。
- 当前播放时间有明显指针。
- 可拖动时间线跳转。
- 支持缩放时间尺度。
- 支持点击某个时间点直接播放。
- 支持键盘左右键快退/快进。
- 支持选择一段时间用于导出。

#### 时间线状态

- 有录像。
- 无录像。
- 正在播放。
- 用户选中导出区间。
- 当前片段加载中。
- 片段损坏或不可播放。

### 5.4 缩略图

#### 需求描述

系统为每个片段生成预览缩略图，方便用户快速识别内容。

缩略图属于 P1 能力，不阻断 MVP 发布。MVP 可以先使用文件名、时间、状态和占位图展示片段列表。

#### 功能点

- 每个片段至少生成一张缩略图。
- 缩略图缓存到应用数据目录。
- 页面滚动时懒加载缩略图。
- 原始视频不被修改。
- 如果生成失败，使用占位图并显示错误状态。

#### 缩略图策略

P1：

- 每个视频取中间一帧作为缩略图。

后续：

- 可配置生成片段开始、中间、结束三张缩略图。
- 每 N 秒生成一张预览帧。
- 时间线 hover 显示对应时间缩略图。
- 生成雪碧图提升预览性能。

### 5.5 视频播放

#### 需求描述

用户可以在 Web 页面中播放片段，并感知为连续回放。

#### 功能点

- 支持播放、暂停。
- 支持音量控制。
- 支持静音。
- 支持倍速播放。
- 支持全屏。
- 支持当前时间显示。
- 支持片段内进度条。
- 当前片段播放结束后自动播放下一个片段。
- 如果下一片段时间连续，自动无感切换。
- 如果下一片段有断档，显示断档时间并跳到下一片段。

#### 浏览器兼容策略

- 浏览器直接支持的 MP4/H.264/AAC 优先直出。
- 浏览器不支持的编码，标记为需要转码。
- MVP 可先显示“该片段编码暂不支持在线播放”，但仍允许导出。
- 后续支持临时转码或 HLS 预览。

### 5.6 跨片段导出

#### 需求描述

用户选择任意开始时间和结束时间，系统导出一个完整视频文件。时间范围可以位于单个文件内，也可以跨多个文件。

#### 示例

用户选择：

```text
10:49:30 - 10:50:20
```

源文件：

```text
clip_002.mp4: 10:49:00 - 10:50:00
clip_003.mp4: 10:50:00 - 10:51:00
```

导出结果：

```text
export_20260524_104930_105020.mp4
```

内容：

```text
clip_002.mp4 的后 30 秒 + clip_003.mp4 的前 20 秒
```

#### 导出模式

##### 快速导出

- 使用 stream copy。
- 速度快。
- CPU 占用低。
- 裁剪点可能不完全精确到帧。
- 适合普通备份和快速分享。

##### 精准导出

- 重新编码相关片段。
- 时间点更准确。
- 兼容性更好。
- CPU 占用较高。
- 适合作为证据片段或精确剪辑。

#### 导出流程

1. 用户选择时间范围。
2. 后端查询与该时间范围相交的视频片段。
3. 计算每个源文件需要裁剪的起点和时长。
4. 为每个源文件生成临时片段。
5. 将临时片段合并成一个 MP4 文件。
6. 更新导出任务状态。
7. 前端显示完成状态和下载入口。
8. 系统按配置清理过期导出文件。

#### 断档处理

如果用户选择的导出区间中包含无录像断档，MVP 默认只导出实际存在的录像内容，不补黑场、不补静音，也不生成与用户选择区间等长的视频。

前端在提交前必须提示：

- 该区间包含断档。
- 导出文件会跳过断档。
- 输出视频时长可能短于用户选择的时间范围。

后续可增加“保留断档并补黑场”的导出模式。

#### 导出限制

MVP 默认限制：

- 单次导出最长 30 分钟。
- 单个任务最大输出 2GB。
- 同时导出任务数默认 1。
- 导出文件默认保留 24 小时。

限制可通过配置调整。

### 5.7 片段列表

#### 需求描述

除时间线外，用户也可以通过片段列表浏览当天所有文件。

#### 功能点

- 按时间倒序或正序排列。
- P1 显示缩略图。
- 显示开始时间、结束时间、时长。
- 显示文件大小。
- 显示播放状态。
- 显示是否损坏、不可播放。
- P1 显示缺失缩略图状态。
- 点击片段进入播放。

### 5.8 搜索与过滤

#### MVP

- 按日期过滤。
- 按源过滤。
- 按是否可播放过滤。
- 按是否有断档过滤。

#### 后续

- 按时间范围搜索。
- 按文件名搜索。
- 按运动事件过滤。
- 按 AI 标签过滤。

### 5.9 系统设置

#### 功能点

- 查看源目录状态。
- 查看扫描进度。
- 手动重新扫描。
- 设置扫描间隔。
- 设置导出保留时间。
- 查看 FFmpeg 可用性。
- 查看磁盘缓存占用。
- 清理导出缓存。

P1 增加：

- 设置缩略图生成策略。
- 清理缩略图缓存。

## 6. 用户体验设计

### 6.1 信息架构

MVP 页面结构：

```text
首页 / 回看页
设置页
导出任务页
```

### 6.2 回看页布局

```text
+-------------------------------------------------------------+
| 顶部栏：Clipline / 源选择 / 日期选择 / 设置入口              |
+--------------+----------------------------------------------+
| 左侧栏        | 主播放区                                      |
| - 源列表      | - 视频播放器                                  |
| - 日期        | - 当前时间                                    |
| - 快捷过滤    | - 播放控制                                    |
+--------------+----------------------------------------------+
| 底部：当天时间线 / 片段条 / 导出区间选择                      |
+-------------------------------------------------------------+
```

### 6.3 核心交互

#### 点击片段

- 播放器加载该片段。
- 时间线指针移动到片段开始时间。
- 片段卡片进入选中状态。

#### 拖动时间线

- 拖动过程中显示时间提示，P1 增加缩略图预览。
- 松开后跳转到最接近的可播放片段。
- 如果目标时间无录像，提示最近可播放时间。

#### 选择导出区间

- 用户点击“导出”进入区间选择模式。
- 在时间线上拖拽选择开始和结束。
- 系统显示预计时长和预计涉及片段数。
- 用户选择快速导出或精准导出。
- 提交后进入导出任务。

#### 跨片段播放

- 当前片段结束前预取下一片段元数据。
- 播放结束后自动切换。
- UI 中继续显示真实时间线进度。

### 6.4 空状态

#### 无源目录

显示：

```text
还没有配置录像目录
请在 docker compose 中映射至少一个 /recordings 路径，并在设置中添加源。
```

#### 当天无视频

显示：

```text
这一天没有找到录像片段
```

#### 文件无法播放

显示：

```text
该片段暂时无法在线播放
可以尝试导出，或开启转码预览。
```

### 6.5 移动端适配

MVP 以桌面端为主，但应保证移动端可基础使用：

- 顶部源选择和日期选择可用。
- 播放器宽度自适应。
- 时间线支持横向滚动。
- 片段列表单列展示。

## 7. 技术方案

### 7.1 推荐架构

```text
Browser
  |
  | HTTP / WebSocket
  |
Backend API
  |
  +-- SQLite
  +-- FFmpeg / ffprobe
  +-- Thumbnail Cache
  +-- Export Cache
  +-- Read-only Recordings Mounts
```

### 7.2 推荐技术栈

Clipline 第一版采用轻量单体架构，前端和后端最终打包到一个 Docker 镜像中。后端负责 API、扫描、索引、导出任务；前端负责时间线、播放器、片段浏览和导出交互。P1 增加缩略图生成和缩略图浏览能力。

#### 总体选型

| 模块 | 技术 |
| --- | --- |
| 前端框架 | React + TypeScript + Vite |
| UI 基础 | Tailwind CSS + Radix UI/shadcn 风格组件 |
| 图标 | lucide-react |
| 数据请求 | TanStack Query |
| 播放器 | 原生 HTML video，后续按需加入 hls.js |
| 后端框架 | Python + FastAPI + Uvicorn |
| 数据库 | SQLite |
| ORM 与迁移 | SQLAlchemy + Alembic |
| 视频处理 | FFmpeg + ffprobe |
| 后台任务 | MVP 使用后端内置 worker，不引入 Redis |
| 部署 | 单容器 Docker + Docker Compose |

#### 后端

- 使用 FastAPI 提供 REST API、OpenAPI 文档和静态文件服务。
- 使用 Uvicorn 作为 ASGI 运行时。
- 使用 SQLite 存储源目录、视频片段、扫描任务、导出任务。P1 增加缩略图记录。
- 使用 SQLAlchemy 管理数据库访问。
- 使用 Alembic 管理数据库 schema 迁移。
- 使用 FFmpeg / ffprobe 做视频元数据读取、裁剪、合并和转码。P1 使用 FFmpeg 生成缩略图。
- 使用内置后台 worker 处理扫描和导出任务。P1 增加缩略图生成任务。
- 暂不引入 Celery、Redis、PostgreSQL，避免部署复杂度过高。

#### 前端

- 使用 React 构建单页应用。
- 使用 TypeScript 保证 API 数据结构和时间线状态的类型安全。
- 使用 Vite 作为开发和构建工具。
- 使用 TanStack Query 管理 API 请求、缓存、轮询导出任务状态。
- 使用 Tailwind CSS 构建轻量、可控的界面样式。
- 使用 Radix UI/shadcn 风格组件实现弹窗、菜单、日期选择、滑块、标签页等交互。
- 使用 lucide-react 提供播放器、导出、设置、筛选等图标。
- 播放器第一版基于原生 HTML video。
- 后续如需要 HLS 转码预览，再引入 hls.js。

#### 部署

- 使用 Docker Compose 部署。
- 第一版优先单容器，降低 NAS 用户部署成本。
- 容器内包含后端、前端静态文件、FFmpeg、ffprobe。
- 源视频目录通过只读 volume 映射到 `/recordings`。
- 应用数据、数据库、缩略图、导出缓存通过 volume 持久化到 `/app/data`。

### 7.3 技术选型理由

#### 为什么第一版使用 FastAPI

Clipline 后端核心工作是扫描文件、调用 FFmpeg、维护 SQLite 索引、处理导出任务。Python 对文件处理、正则解析、子进程调用和快速迭代很友好。FastAPI 可以自动生成 OpenAPI 文档，方便前后端联调。

Go 也适合做长期稳定的轻量服务，但 MVP 阶段扫描规则、导出策略、时间解析逻辑会频繁变化，FastAPI 更适合快速验证产品。

#### 为什么第一版使用 SQLite

Clipline 是典型单机本地工具，主要访问模式是本地索引查询和后台写入任务。SQLite 部署简单、备份容易、无需额外数据库容器，适合 NAS 和家庭服务器场景。

#### 为什么前端使用 React + Vite

Clipline 的核心交互集中在时间线、播放器状态、导出区间选择、任务状态轮询。React 生态成熟，Vite 开发体验快，TypeScript 可以降低复杂交互状态出错概率。

#### 为什么暂不引入 Redis

MVP 的扫描和导出任务并发量低，内置 worker 足够。引入 Redis 会增加 Docker Compose 复杂度。后续如果需要多任务并发、任务恢复、分布式 worker，再考虑 Redis 或其他队列。

### 7.4 数据目录

```text
/app/data
  clipline.db
  thumbnails/
  exports/
  tmp/
  logs/

/recordings
  source-a/
  source-b/
```

### 7.5 Docker Compose 示例

```yaml
services:
  clipline:
    image: clipline/clipline:latest
    container_name: clipline
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - /volume1/camera/xiaomi:/recordings/xiaomi:ro
      - /volume1/dashcam:/recordings/dashcam:ro
    environment:
      - TZ=Asia/Shanghai
      - CLIPLINE_DB=/app/data/clipline.db
      - CLIPLINE_DATA=/app/data
      - CLIPLINE_RECORDINGS_ROOT=/recordings
    restart: unless-stopped
```

## 8. 数据模型

### 8.1 sources

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
```

### 8.2 video_segments

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
```

说明：

- `scan_status = indexed` 的记录必须有 `start_time`、`end_time`、`duration_seconds`。
- `scan_status = pending` 或 `failed` 的记录允许时间和时长为空，避免不稳定文件或损坏文件无法落库。

### 8.3 thumbnails

P1 表。

```sql
CREATE TABLE thumbnails (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  timestamp_seconds REAL NOT NULL,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (segment_id) REFERENCES video_segments(id)
);
```

### 8.4 export_jobs

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
```

### 8.5 scan_jobs

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
```

## 9. API 设计

### 9.1 源管理

```http
GET /api/sources
```

返回所有源。

```http
POST /api/sources
```

创建源。

请求：

```json
{
  "name": "门口摄像头",
  "path": "/recordings/front-door"
}
```

```http
PATCH /api/sources/{sourceId}
```

更新源名称、路径或启用状态。

```http
POST /api/sources/{sourceId}/scan
```

手动触发扫描。

如果该源已有排队中或运行中的扫描任务，系统应返回已有任务，不重复创建扫描任务。

```http
GET /api/recording-directories?path=/recordings
```

返回可选择的视频目录树，用于新建或编辑源。`path` 必须位于系统配置的录像根目录内。

### 9.2 时间线

```http
GET /api/timeline?sourceId=src_001&date=2026-05-24
```

返回当天录像区间、断档、片段摘要。

返回示例：

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

### 9.3 片段播放

```http
GET /api/segments/{segmentId}
```

返回片段详情。

```http
GET /api/segments/{segmentId}/stream
```

返回视频文件流，支持 Range 请求。

```http
GET /api/segments/resolve?sourceId=src_001&time=2026-05-24T10:49:30+08:00
```

根据真实时间解析到具体片段和片段内偏移。

### 9.4 缩略图

```http
GET /api/thumbnails/{thumbnailId}
```

返回缩略图文件。P1 能力。

```http
POST /api/segments/{segmentId}/thumbnails
```

重新生成缩略图。P1 能力。

### 9.5 导出

```http
POST /api/exports
```

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

```http
GET /api/exports
```

返回导出任务列表，用于导出任务页。

```http
GET /api/exports/{exportId}
```

返回导出任务状态。

```http
GET /api/exports/{exportId}/download
```

下载导出文件。

```http
DELETE /api/exports/{exportId}
```

删除导出文件和对应任务记录。P1 能力。

### 9.6 系统状态

```http
GET /api/system/status
```

返回 FFmpeg 状态、数据库状态、磁盘缓存占用。

## 10. 后端关键算法

### 10.1 时间范围匹配片段

输入：

- source_id
- start_time
- end_time

查询逻辑：

```sql
SELECT *
FROM video_segments
WHERE source_id = ?
  AND end_time > ?
  AND start_time < ?
ORDER BY start_time ASC;
```

含义：

- 片段结束时间晚于导出开始时间。
- 片段开始时间早于导出结束时间。
- 两者相交即可被纳入导出。

### 10.2 单片段裁剪区间计算

对每个相交片段：

```text
clip_start = max(request_start, segment_start)
clip_end = min(request_end, segment_end)
offset = clip_start - segment_start
duration = clip_end - clip_start
```

### 10.3 跨片段导出伪代码

```text
segments = find_segments(source_id, request_start, request_end)

for segment in segments:
    clip_start = max(request_start, segment.start_time)
    clip_end = min(request_end, segment.end_time)
    offset = clip_start - segment.start_time
    duration = clip_end - clip_start

    temp_file = trim(segment.path, offset, duration, mode)
    temp_files.append(temp_file)

output = concat(temp_files, mode)
return output
```

### 10.4 断档计算

按开始时间排序片段：

```text
previous_end = day_start

for segment in segments:
    if segment.start_time > previous_end:
        gap = previous_end -> segment.start_time
    previous_end = max(previous_end, segment.end_time)

if previous_end < day_end:
    gap = previous_end -> day_end
```

## 11. FFmpeg 策略

### 11.1 获取元数据

使用 ffprobe 获取：

- duration
- codec_name
- width
- height
- r_frame_rate
- format_name

### 11.2 生成缩略图

P1 能力。

P1 策略：

```text
ffmpeg -ss {middle_time} -i input.mp4 -frames:v 1 thumbnail.jpg
```

### 11.3 快速导出

裁剪：

```text
ffmpeg -ss {offset} -i input.mp4 -t {duration} -c copy temp.mp4
```

合并：

```text
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
```

### 11.4 精准导出

裁剪并重编码：

```text
ffmpeg -ss {offset} -i input.mp4 -t {duration} \
  -c:v libx264 -preset veryfast -crf 20 \
  -c:a aac -movflags +faststart temp.mp4
```

合并：

```text
ffmpeg -f concat -safe 0 -i list.txt \
  -c:v libx264 -preset veryfast -crf 20 \
  -c:a aac -movflags +faststart output.mp4
```

### 11.5 注意事项

- 快速导出的裁剪点可能受关键帧影响。
- 不同源文件编码参数不一致时，快速合并可能失败。
- 精准导出更稳定，但消耗 CPU。
- 输出 MP4 应使用 `+faststart`，提升下载后播放兼容性。
- 临时文件必须任务结束后清理。

## 12. 权限与安全

### 12.1 文件安全

- 源录像目录默认只读挂载。
- Clipline 不提供删除源文件功能。
- 所有缓存和导出写入 `/app/data`。
- API 访问文件时必须通过 segment id，不允许任意路径读取。

### 12.2 路径安全

- 禁止 `../` 路径穿越。
- 所有文件访问必须校验是否属于已配置源目录。
- 导出下载只能访问 export_jobs 记录里的输出文件。

### 12.3 访问控制

MVP 可默认局域网裸访问。

后续可增加：

- 单用户密码。
- 反向代理认证。
- OIDC。
- 只读访客模式。

## 13. 性能需求

### 13.1 扫描性能

- 10,000 个视频文件内，首次扫描应可后台完成。
- 扫描过程中 UI 可用。
- 已扫描文件如大小和 mtime 未变化，不重复 ffprobe。

### 13.2 页面性能

- 当天 1,000 个片段以内，时间线交互应流畅。
- P1 缩略图懒加载。
- 时间线使用聚合数据，不一次性加载所有大文件信息。

### 13.3 导出性能

- 快速导出速度主要受磁盘 IO 影响。
- 精准导出速度取决于 CPU/GPU。
- 同时导出任务数可配置，默认 1，避免拖垮 NAS。

## 14. 可观测性

### 14.1 日志

需要记录：

- 启动日志。
- 源目录扫描日志。
- ffprobe 错误。
- P1 缩略图生成错误。
- 导出任务开始、完成、失败。
- API 错误。

日志系统要求：

- 同时输出到控制台和 `/app/data/logs/clipline.log`。
- 支持日志级别配置，默认 `INFO`。
- 支持文本和 JSON 两种格式，默认文本。
- 每个 API 请求带 request_id；响应头返回 `X-Request-ID`。
- UI 可查看最近 N 行应用日志，方便用户自助排查扫描和导出问题。

### 14.2 状态页

展示：

- 版本号。
- FFmpeg 是否可用。
- SQLite 是否可用。
- 源目录是否可读。
- P1 缩略图缓存大小。
- 导出缓存大小。
- 最近一次扫描时间。

## 15. 配置项

### 15.1 环境变量

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

### 15.2 配置文件

配置文件只保存应用级设置。录像源由用户在 Web UI 中创建，并持久化到 SQLite。

```yaml
app:
  port: 8080
  timezone: Asia/Shanghai
  recordings_root: /recordings

scanner:
  interval_seconds: 300
  extensions:
    - .mp4
    - .mov
    - .mkv
    - .avi
    - .ts

exports:
  ttl_hours: 24
  max_minutes: 30
  max_concurrent: 1

thumbnails:  # P1
  mode: middle
  width: 320
  quality: 80
```

## 16. 路线图

### 16.1 Phase 1: 可用 MVP

- Docker 单容器。
- 视频扫描。
- SQLite 索引。
- 时间线。
- 单源/多源回看。
- 连续播放。
- 跨片段导出。

### 16.2 Phase 2: 更好用的回看

- 缩略图。
- 时间线 hover 缩略图。
- 片段密度热力图。
- 快速跳转到上一个/下一个有录像片段。
- 导出区间微调。
- 移动端优化。
- HLS 预览转码。

### 16.3 Phase 3: 智能辅助

- 低成本运动检测。
- 事件片段自动标记。
- 人、车、宠物检测。
- 按事件筛选。
- 事件摘要视图。

### 16.4 Phase 4: 高级能力

- 多源同步回放。
- 地图/行车轨迹支持。
- OCR 时间戳校正。
- WebDAV/SMB/S3 源。
- 多用户权限。
- 插件式时间解析规则。

## 17. 成功指标

### 17.1 MVP 成功标准

- 用户可以在 10 分钟内完成 Docker 部署。
- 用户可以添加至少一个录像目录。
- 系统可以成功扫描并展示视频片段。
- 用户可以通过时间线快速定位片段。
- 用户可以连续播放跨文件录像。
- 用户可以导出跨文件完整 MP4。

### 17.2 产品体验指标

- 打开某一天时间线小于 2 秒。
- 点击片段开始播放小于 2 秒。
- 快速导出 5 分钟视频的耗时接近文件复制速度。
- 精准导出失败时有明确错误信息。

P1 体验指标：

- 缩略图首屏加载小于 3 秒。

## 18. 风险与对策

### 18.1 文件时间不准确

风险：

有些设备文件名不包含时间，或者 NAS 写入后 mtime 变成同步时间。

对策：

- 支持从目录名解析时间。
- MVP 内置常见文件名和目录名识别规则。
- 后续支持自定义文件名解析规则和手动选择时间来源。
- 后续支持 OCR 识别画面时间戳。

### 18.2 浏览器无法播放 H.265

风险：

很多摄像头使用 H.265，浏览器兼容性不好。

对策：

- 标记片段为不可直接播放。
- 提供导出转码。
- 后续提供 HLS 转码预览。

### 18.3 快速导出不够精确

风险：

`-c copy` 受关键帧影响，裁剪点可能有偏差。

对策：

- 产品中明确区分快速导出和精准导出。
- 默认普通用户使用快速导出。
- 对证据场景推荐精准导出。

### 18.4 大量视频导致扫描慢

风险：

首次扫描 NAS 大目录可能耗时较长。

对策：

- 后台扫描。
- 增量扫描。
- UI 显示扫描进度。
- 避免重复 ffprobe。

### 18.5 源文件正在写入

风险：

摄像头正在写入的视频文件可能还未完整。

对策：

- 跳过最近 N 秒内修改过的文件。
- 文件大小稳定后再索引。
- 对不完整文件标记 pending。

## 19. 验收标准

### 19.1 扫描验收

- 用户可以在 Web UI 中新建源，填写名称并选择 `/recordings` 下的视频目录。
- 选择不存在、不可读或超出录像根目录的路径时，系统应阻止保存并显示错误。
- 给定一个包含 100 个 MP4 的目录，系统可以扫描并建立索引。
- 同一目录再次扫描时，不重复处理未变化文件。
- 损坏文件不会导致扫描任务整体失败。

### 19.2 时间线验收

- 同一天多个片段能按真实时间排序。
- 有断档时，时间线能正确显示断档。
- 点击任意有录像时间点，可以定位到正确片段。

### 19.3 播放验收

- 用户点击片段后可以播放。
- 当前片段结束后自动播放下一片段。
- 时间线指针跟随真实时间移动。

### 19.4 导出验收

- 单文件内导出能生成完整 MP4。
- 跨两个文件导出能生成一个完整 MP4。
- 跨多个文件导出能按时间顺序合并。
- 快速导出失败时，可以提示用户改用精准导出。
- 导出任务完成后可下载。

### 19.5 Docker 验收

- 使用 Docker Compose 可以启动。
- 映射只读录像目录后可以扫描。
- 重启容器后数据库和导出记录仍保留。

## 20. 开放问题

- 默认是否启用登录密码？
- 是否需要支持中文文件名和 Windows NAS 路径特殊情况？
- 小米摄像头具体文件名格式是什么？
- 行车记录仪文件名格式是否需要独立内置识别规则？
- 是否需要保留导出历史？
- 目录选择器默认展示几级目录，是否需要支持搜索目录？

## 21. MVP 推荐决策

- 后端使用 Python + FastAPI + Uvicorn。
- 前端使用 React + TypeScript + Vite。
- UI 使用 Tailwind CSS + Radix UI/shadcn 风格组件 + lucide-react。
- 数据请求使用 TanStack Query。
- 数据库使用 SQLite。
- ORM 和迁移使用 SQLAlchemy + Alembic。
- 视频处理使用 FFmpeg + ffprobe。
- 后台任务 MVP 使用内置 worker，暂不引入 Redis。
- 部署使用单容器 Docker + Docker Compose。
- 第一版源管理在 Web UI 中完成，用户只需要填写源名称并选择视频目录。
- Docker 只负责把宿主机录像目录只读映射到容器内 `/recordings`。
- 默认不加登录，建议用户部署在局域网或反向代理后面。
- 导出默认使用快速导出，同时提供精准导出选项。
- 源目录只读，应用只写 `/app/data`。
- 第一版先不做 AI，只做好时间线、连续播放、连续导出。
