# Clipline

<p align="center">
  <strong><a href="#english">English</a></strong> · <a href="#简体中文">简体中文</a>
</p>

<a id="english"></a>

<p align="center">
  <img src="https://raw.githubusercontent.com/HappyQuQu/clipline/main/docs/assets/clipline-logo.svg" width="112" alt="Clipline logo">
</p>

<p align="center">
  <strong>A timeline workspace for scanning, replaying, searching, and exporting video segments backed up to a Xiaomi NAS</strong>
</p>

<p align="center">
  <a href="https://github.com/HappyQuQu/clipline"><img alt="Source code" src="https://img.shields.io/badge/source-GitHub-181717?logo=github"></a>
  <a href="https://github.com/HappyQuQu/clipline/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platforms: Linux amd64 and arm64" src="https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-lightgrey.svg">
</p>

Clipline organizes continuously growing video segments stored on a Xiaomi NAS, home NAS, or local disk. It is designed for dashcams, surveillance cameras, parking monitors, body cameras, and other devices that save recordings as short time-based files.

![Clipline playback](https://raw.githubusercontent.com/HappyQuQu/clipline/main/docs/screenshots/playback.png)

## Highlights

- Scan multiple NAS or local recording directories and extract video timestamps and metadata.
- Replay segmented recordings through a synchronized player and timeline.
- Generate thumbnails for quick browsing in the segment library.
- Export selected ranges in fast or precise mode through background jobs.
- Transcribe speech, search conversations, jump to matching timestamps, and export SRT or TXT subtitles.
- Track export, transcription, vision, and model-download progress from one task center.
- Run the frontend, backend, SQLite, FFmpeg, and media tooling in one container.

## Quick Start

Prepare one writable data directory and one recording directory mounted read-only:

```bash
docker run -d \
  --name clipline \
  --restart unless-stopped \
  -p 8080:8080 \
  -v /path/to/clipline-data:/app/data \
  -v /path/to/recordings:/recordings/xiaomi-nas:ro \
  -e TZ=Asia/Shanghai \
  evanqu/clipline:latest
```

Open `http://<server-address>:8080`, go to **Recording Sources**, add `/recordings/xiaomi-nas`, and start a scan.

## Docker Compose

```yaml
services:
  clipline:
    image: evanqu/clipline:latest
    container_name: clipline
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      TZ: Asia/Shanghai
      CLIPLINE_RECORDINGS_ROOT: /recordings
    volumes:
      - ./data:/app/data
      - /path/to/recordings:/recordings/xiaomi-nas:ro
```

```bash
docker compose up -d
```

Paths configured in the UI are container paths. Keep original recordings mounted read-only; Clipline stores its SQLite database, thumbnails, exports, playback proxies, and model cache under `/app/data`.

Images are published for Linux `amd64` and `arm64`. Use an explicit version tag or immutable digest for controlled production upgrades.

## Documentation and Support

- [English project documentation](https://github.com/HappyQuQu/clipline/blob/main/README.md)
- [简体中文项目说明](https://github.com/HappyQuQu/clipline/blob/main/README.zh-CN.md)
- [Docker Compose configuration](https://github.com/HappyQuQu/clipline/blob/main/docker-compose.yml)
- [Issue tracker](https://github.com/HappyQuQu/clipline/issues)
- [MIT license](https://github.com/HappyQuQu/clipline/blob/main/LICENSE)

---

<p align="center"><strong>Turn scattered recording segments into a searchable, navigable, and exportable timeline.</strong></p>

---

<a id="简体中文"></a>

## 简体中文

<p align="center">
  <a href="#english">English</a> · <strong><a href="#简体中文">简体中文</a></strong>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/HappyQuQu/clipline/main/docs/assets/clipline-logo.svg" width="112" alt="Clipline logo">
</p>

<p align="center">
  <strong>小米 NAS 备份视频片段的扫描、回放、时间线定位和区间导出工作台</strong>
</p>

<p align="center">
  <a href="https://github.com/HappyQuQu/clipline"><img alt="Source code" src="https://img.shields.io/badge/source-GitHub-181717?logo=github"></a>
  <img alt="Platforms: Linux amd64 and arm64" src="https://img.shields.io/badge/platform-linux%2Famd64%20%7C%20linux%2Farm64-lightgrey.svg">
</p>

Clipline 面向小米 NAS、家庭 NAS 或本地硬盘中持续增长的视频备份目录。它适合行车记录仪、监控摄像头、停车监控和执法记录仪等按时间切片保存的视频：挂载目录后即可扫描片段、建立索引、生成缩略图，并统一完成录像回放、时间线定位、全文检索和区间导出。

![Clipline 录像回放](https://raw.githubusercontent.com/HappyQuQu/clipline/main/docs/screenshots/playback.png)

## 主要功能

- 扫描多个 NAS 或本地录像目录，自动提取视频时间和元数据。
- 在统一时间线上连续查看切片录像并快速定位片段。
- 生成缩略图，通过片段库浏览和筛选内容。
- 选择时间区间，以快速或精准模式在后台导出视频。
- 识别视频对话，支持全文检索以及 SRT、TXT 字幕导出。
- 在任务中心统一查看导出、字幕、视觉识别和模型下载进度。
- 前后端、FFmpeg 和运行依赖打包为单个容器。

## 快速启动

准备一个可写数据目录和一个只读录像目录，然后运行：

```bash
docker run -d \
  --name clipline \
  --restart unless-stopped \
  -p 8080:8080 \
  -v /path/to/clipline-data:/app/data \
  -v /path/to/recordings:/recordings/xiaomi-nas:ro \
  -e TZ=Asia/Shanghai \
  evanqu/clipline:latest
```

打开 `http://<服务器地址>:8080`，进入“录像源”，添加容器内路径 `/recordings/xiaomi-nas`，然后开始扫描。

Windows Docker Desktop 用户可以把宿主机路径替换为 `D:\clipline\data` 和 `Z:\XiaomiNAS\CameraBackup` 等实际路径。

## Docker Compose

```yaml
services:
  clipline:
    image: evanqu/clipline:latest
    container_name: clipline
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      TZ: Asia/Shanghai
      CLIPLINE_RECORDINGS_ROOT: /recordings
    volumes:
      - ./data:/app/data
      - /path/to/recordings:/recordings/xiaomi-nas:ro
```

启动服务：

```bash
docker compose up -d
```

## 存储与挂载

| 容器路径 | 权限 | 用途 |
| --- | --- | --- |
| `/app/data` | 读写 | SQLite 数据库、缩略图、导出文件和模型缓存 |
| `/recordings/...` | 建议只读 | NAS 或本地视频片段目录 |

页面中配置的是容器路径，不是宿主机路径。录像原文件建议始终以只读方式挂载；Clipline 的数据库和生成内容放在 `/app/data`。

## 镜像标签

- `latest`：`main` 分支或版本发布的最新镜像。
- `<version>`、`<major>.<minor>`：由 `v*.*.*` Git 标签生成的版本镜像。
- `sha-<commit>`：对应 Git 提交的可追溯镜像。
- `edge`：手动运行发布流程时的默认标签。

镜像支持 Linux `amd64` 和 `arm64`。生产环境建议使用明确版本标签或不可变 digest。

## 配置与支持

- [简体中文项目说明](https://github.com/HappyQuQu/clipline/blob/main/README.zh-CN.md)
- [English project documentation](https://github.com/HappyQuQu/clipline/blob/main/README.md)
- [Docker Compose 配置](https://github.com/HappyQuQu/clipline/blob/main/docker-compose.yml)
- [问题反馈](https://github.com/HappyQuQu/clipline/issues)
- [MIT 许可证](https://github.com/HappyQuQu/clipline/blob/main/LICENSE)

---

<p align="center"><strong>把零散录像片段，变成可检索、可定位、可导出的时间线。</strong></p>
