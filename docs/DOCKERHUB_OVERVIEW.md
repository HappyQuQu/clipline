# Clipline

Clipline is a local video segment workbench for scanning, indexing, replaying, browsing, and exporting recording files from mounted folders.

It is designed for dashcam, surveillance, bodycam, and other file-based recording workflows where videos are saved as many short clips.

## Features

- Manage one or more mounted recording sources.
- Scan videos with FFmpeg / ffprobe and store segment metadata.
- Generate thumbnails for fast browsing.
- Replay clips with a synchronized timeline.
- Select export ranges directly on the timeline.
- Create background export jobs and download results when finished.
- Run as a single Docker container with the frontend and backend bundled together.

## Quick start

Create local folders for Clipline data and your recordings:

```powershell
mkdir data
```

Run the container:

```powershell
docker run -d --name clipline --restart unless-stopped `
  -p 8080:8080 `
  -v "${PWD}\data:/app/data" `
  -v "C:\path\to\your\videos:/recordings/video1:ro" `
  -e TZ=Asia/Shanghai `
  evanqu/clipline:latest
```

Open:

```text
http://127.0.0.1:8080
```

Then add a recording source in the UI:

```text
Name: video1
Path: /recordings/video1
```

## Docker Compose

```yaml
services:
  clipline:
    image: evanqu/clipline:latest
    container_name: clipline
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - C:/path/to/your/videos:/recordings/video1:ro
    environment:
      - TZ=Asia/Shanghai
    restart: unless-stopped
```

Start it:

```powershell
docker compose up -d
```

## Tags

| Tag | Description |
| --- | --- |
| `latest` | Latest published build from the main branch |
| `0.1.0` | Initial public Docker Hub release |

## Volumes

| Container path | Required | Description |
| --- | --- | --- |
| `/app/data` | Yes | SQLite database, thumbnails, exports, temporary files, and logs |
| `/recordings/...` | Yes | Read-only mounted recording folders |

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `CLIPLINE_PORT` | `8080` | Backend listen port inside the container |
| `CLIPLINE_DATA` | `/app/data` | Data directory |
| `CLIPLINE_DB` | `/app/data/clipline.db` | SQLite database path |
| `CLIPLINE_RECORDINGS_ROOT` | `/recordings` | Root directory for recording source browsing |
| `CLIPLINE_RECORDINGS_ROOTS` | empty | Comma-separated recording roots |
| `CLIPLINE_SCAN_INTERVAL_SECONDS` | `300` | Scheduler interval |
| `CLIPLINE_EXPORT_TTL_HOURS` | `24` | Export file retention time |
| `CLIPLINE_MAX_EXPORT_MINUTES` | `30` | Max export duration per job |
| `CLIPLINE_MAX_CONCURRENT_EXPORTS` | `1` | Max concurrent export jobs |
| `CLIPLINE_TIMEZONE` | `Asia/Shanghai` | Timezone for display and scanning |
| `CLIPLINE_SKIP_RECENT_SECONDS` | `30` | Skip files that may still be written |

## Notes

- Mount host video folders into the container and add the container path in the UI.
- Recording folders should normally be mounted read-only.
- The image does not include your videos or local database.
- Export jobs use CPU and disk space. Adjust limits based on your machine.

## Source

GitHub: https://github.com/HappyQuQu/clipline

