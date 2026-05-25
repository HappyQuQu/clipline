<p align="center">
  <img src="docs/assets/clipline-logo.svg" width="112" alt="Clipline logo" />
</p>

<h1 align="center">Clipline</h1>

<p align="center">
  <strong>本地录像片段的扫描、回放、时间线定位和区间导出工作台。</strong>
</p>

<p align="center">
  <a href="#快速启动">快速启动</a>
  ·
  <a href="#界面预览">界面预览</a>
  ·
  <a href="#导出模式">导出模式</a>
  ·
  <a href="#本地开发">本地开发</a>
  ·
  <a href="docs/API_AND_DB.md">API 文档</a>
</p>

<p align="center">
  <img alt="Docker ready" src="https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-backend-009688?style=flat-square&logo=fastapi&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-frontend-61DAFB?style=flat-square&logo=react&logoColor=0F172A" />
  <img alt="FFmpeg" src="https://img.shields.io/badge/FFmpeg-media-22C55E?style=flat-square&logo=ffmpeg&logoColor=white" />
</p>

---

Clipline 面向行车记录仪、监控录像、执法记录仪等按片段保存的视频目录。它会扫描录像源目录，建立片段索引，生成缩略图，并在一个统一界面里完成回放、时间线定位、片段墙浏览和后台导出。

## 界面预览

<table>
  <tr>
    <td width="50%">
      <strong>录像回放</strong><br />
      视频和时间线在同一工作区，选择片段后自动定位到对应时间段。
    </td>
    <td width="50%">
      <strong>时间线导出</strong><br />
      点击导出后显示滑块，拖动左右把手选择区间，再确认创建任务。
    </td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/playback.png" alt="录像回放界面" /></td>
    <td><img src="docs/screenshots/export-range.png" alt="时间线导出区间" /></td>
  </tr>
  <tr>
    <td width="50%">
      <strong>片段墙</strong><br />
      按录像时间倒序展示缩略图，适合快速筛选和切换片段。
    </td>
    <td width="50%">
      <strong>录像源管理</strong><br />
      管理目录、扫描状态、定时扫描策略和扫描进度。
    </td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/clips.png" alt="片段墙" /></td>
    <td><img src="docs/screenshots/sources.png" alt="录像源管理" /></td>
  </tr>
</table>

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 录像源管理 | 添加本地或 Docker 挂载目录，启用、停用或配置定时扫描。 |
| 自动扫描 | 使用 FFmpeg / ffprobe 读取视频元数据，保存片段索引。 |
| 缩略图索引 | 为片段生成缩略图，片段墙可快速识别内容。 |
| 同步时间线 | 视频播放时间和时间线光标同步，选择片段后自动缩放定位。 |
| 区间导出 | 在时间线上通过滑块选择范围，支持快速和精准两种模式。 |
| 后台任务 | 确认导出后创建任务，完成后提示下载，不打断当前回放页面。 |
| 状态与日志 | 查看系统状态、扫描任务、导出任务和错误信息。 |
| Docker 优先 | 前后端打包到同一个镜像，方便本地验证和部署。 |

## 快速启动

### 1. 准备视频目录

把录像文件放在一个固定目录下，例如：

```powershell
C:\Users\EvanQ\Desktop\200video
```

如果使用自己的目录，请修改 `docker-compose.yml` 里的挂载路径：

```yaml
volumes:
  - ./data:/app/data
  - C:/your/video/folder:/recordings/video1:ro
```

容器内路径 `/recordings/video1` 就是 Clipline 里要添加的录像源路径。

### 2. 启动容器

```powershell
docker compose up -d --build
```

默认访问：

```text
http://127.0.0.1:8080
```

本机调试也可以手动映射到 `28080`：

```powershell
docker build -t clipline-clipline:latest .
docker rm -f clipline
docker run -d --name clipline --restart unless-stopped `
  -p 28080:8080 `
  -v "${PWD}\data:/app/data" `
  -v "C:\Users\EvanQ\Desktop\200video:/recordings/200video:ro" `
  -e TZ=Asia/Shanghai `
  clipline-clipline:latest
```

访问：

```text
http://127.0.0.1:28080
```

### 3. 添加录像源

进入“录像源”页面，点击“添加录像源”，填入：

```text
名称：200video
路径：/recordings/200video
```

添加后可以手动扫描，也可以启用定时扫描。

## 使用流程

```text
启动服务 -> 添加录像源 -> 扫描入库 -> 选择片段 -> 时间线定位 -> 选择导出区间 -> 创建导出任务 -> 下载结果
```

1. 启动 Docker 服务。
2. 在“录像源”中添加容器内的视频目录。
3. 等待扫描完成，片段进入索引。
4. 在“录像回放”中选择源和片段。
5. 使用时间线定位当前播放点，或切换上一个、下一个事件。
6. 点击“导出”显示导出区间滑块。
7. 拖动左右滑块选择范围。
8. 选择“快速”或“精准”模式。
9. 点击“确认导出”创建后台导出任务。
10. 导出完成后根据提示下载文件，或进入“导出任务”查看历史。

## 导出模式

| 模式 | 说明 | 适用场景 |
| --- | --- | --- |
| 快速 | 尽量不重新编码，导出速度更快，边界可能贴近关键帧。 | 临时取证、快速分享、长片段导出 |
| 精准 | 重新编码，起止时间更准确，但速度更慢。 | 对起止点要求更高的短片段 |

## 配置项

服务通过 `CLIPLINE_` 前缀读取环境变量。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CLIPLINE_PORT` | `8080` | 后端监听端口 |
| `CLIPLINE_DATA` | `/app/data` | 数据目录 |
| `CLIPLINE_DB` | `/app/data/clipline.db` | SQLite 数据库路径 |
| `CLIPLINE_RECORDINGS_ROOT` | `/recordings` | 可浏览的录像根目录 |
| `CLIPLINE_RECORDINGS_ROOTS` | 空 | 多个录像根目录，使用英文逗号分隔 |
| `CLIPLINE_SCAN_INTERVAL_SECONDS` | `300` | 调度器扫描间隔 |
| `CLIPLINE_EXPORT_TTL_HOURS` | `24` | 导出文件保留时间 |
| `CLIPLINE_MAX_EXPORT_MINUTES` | `30` | 单次最大导出分钟数 |
| `CLIPLINE_MAX_CONCURRENT_EXPORTS` | `1` | 最大并发导出数 |
| `CLIPLINE_THUMBNAIL_MODE` | `middle` | 缩略图截取策略 |
| `CLIPLINE_TIMEZONE` | `Asia/Shanghai` | 时间显示和扫描时区 |
| `CLIPLINE_SKIP_RECENT_SECONDS` | `30` | 扫描时跳过最近写入的文件，避免读取未写完片段 |
| `CLIPLINE_LOG_LEVEL` | `INFO` | 日志级别 |
| `CLIPLINE_LOG_FILE` | `/app/data/logs/clipline.log` | 日志文件路径 |

## 本地开发

### 后端

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"

$env:CLIPLINE_DATA = "../data"
$env:CLIPLINE_DB = "../data/clipline.db"
$env:CLIPLINE_RECORDINGS_ROOT = "C:/Users/EvanQ/Desktop/200video"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

### 前端

```powershell
cd frontend
npm install
npm run dev
```

前端开发服务器默认运行在：

```text
http://127.0.0.1:5173
```

`frontend/vite.config.ts` 会把 `/api` 代理到 `VITE_API_TARGET`，默认是：

```text
http://127.0.0.1:8080
```

需要改后端地址时：

```powershell
$env:VITE_API_TARGET = "http://127.0.0.1:28080"
npm run dev
```

## 构建验证

```powershell
cd frontend
npm run build

cd ..
docker build -t clipline-clipline:latest .
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8080/api/system/status
```

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/system/status` | 系统状态、数据库、数据目录和统计信息 |
| `GET` | `/api/sources` | 录像源列表 |
| `POST` | `/api/sources` | 创建录像源 |
| `PATCH` | `/api/sources/{source_id}` | 更新录像源 |
| `POST` | `/api/sources/{source_id}/scan` | 手动触发扫描 |
| `GET` | `/api/recording-directories` | 浏览容器内录像目录 |
| `GET` | `/api/scan-jobs` | 扫描任务列表 |
| `GET` | `/api/timeline` | 指定源和日期的时间线 |
| `GET` | `/api/segments` | 片段列表 |
| `GET` | `/api/segments/{segment_id}/stream` | 视频流 |
| `GET` | `/api/segments/{segment_id}/thumbnail` | 片段缩略图 |
| `POST` | `/api/exports` | 创建导出任务 |
| `GET` | `/api/exports` | 导出任务列表 |
| `GET` | `/api/exports/{export_id}/download` | 下载导出文件 |

更完整的接口和数据结构说明见 [docs/API_AND_DB.md](docs/API_AND_DB.md)。

## 项目结构

```text
clipline/
├─ backend/                 # FastAPI 后端、扫描、导出、调度、数据库模型
├─ frontend/                # React + Vite 前端
├─ docs/                    # 产品、技术、接口和截图文档
│  ├─ assets/               # README 和品牌素材
│  └─ screenshots/          # README 截图
├─ data/                    # 本地数据库、缩略图、导出文件和日志
├─ Dockerfile               # 前端构建 + 后端运行的一体化镜像
└─ docker-compose.yml       # Docker Compose 示例
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19、Vite、TypeScript、TanStack Query、Radix UI、Lucide Icons |
| 后端 | FastAPI、SQLAlchemy、SQLite、Pydantic Settings |
| 媒体 | FFmpeg、ffprobe |
| 部署 | Docker 单容器，静态前端由 FastAPI 同进程托管 |

## 注意事项

- Docker 中配置的是容器路径，不是 Windows 主机路径。
- 录像目录建议只读挂载，避免服务误改原始文件。
- 扫描会跳过最近写入的文件，避免索引未写完的视频片段。
- 大文件导出会占用 CPU 和磁盘空间，建议根据机器性能调整并发数。
- 如果页面没有加载片段，先确认已经选择录像源，并且该源扫描完成。
