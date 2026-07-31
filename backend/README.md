# Clipline Backend

## Run Locally

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
CLIPLINE_DATA=../data \
CLIPLINE_DB=../data/clipline.db \
CLIPLINE_RECORDINGS_ROOT=../recordings \
uvicorn app.main:app --reload --port 8080
```

## Logging

Default logs:

- Console output.
- File: `/app/data/logs/clipline.log` in Docker.

Local development can override:

```bash
CLIPLINE_LOG_LEVEL=DEBUG
CLIPLINE_LOG_FORMAT=json
CLIPLINE_LOG_FILE=../data/logs/clipline.log
```

Useful endpoints:

- `GET /api/system/status`
- `GET /api/system/logs?lines=200`

## Isolated mutation smoke test

The mutation smoke test creates its own temporary database, recording directory and
H.264/AAC plus HEVC/Opus fixtures. It does not read or change the configured Clipline data directory.

```bash
backend/.venv/bin/python backend/tests/mutation_smoke.py
```

It verifies source creation/update/scan/delete, settings persistence, fast and accurate
export/download, HEVC/Opus to H.264/AAC playback proxy generation and cleanup,
recognition job creation/error surfacing, active-model protection, isolated cache deletion,
and runtime model-session reload.

Release-only runtime checks are separate because they download or require real model files:

```bash
backend/.venv/bin/python backend/tests/model_runtime_smoke.py
CLIPLINE_TEST_VISION_MODEL=/path/to/yolov8n.onnx \
  backend/.venv/bin/python backend/tests/vision_runtime_smoke.py
```

The ASR check downloads Whisper Tiny into a temporary cache, recognizes a synthesized spoken
fixture through the real API, reloads the runtime and deletes the cache. The vision check copies
the supplied ONNX model into a temporary cache and detects a person in the prototype asset.

## Browser playback proxies

Segments already encoded as H.264/AAC are streamed from the source file. Segments marked
`needsTranscode` are converted on first playback to an H.264/AAC MP4 under
`CLIPLINE_DATA/playback-proxies`; the source recording is never modified. Tune the
maximum proxy width and first-play timeout with `CLIPLINE_PLAYBACK_PROXY_MAX_WIDTH`
(default `1920`) and `CLIPLINE_PLAYBACK_PROXY_TIMEOUT_SECONDS` (default `1800`).

## Docker

From the repository root:

```bash
docker compose up -d --build
```

The app is served at `http://127.0.0.1:8080`. The compose file mounts `./recordings` read-only as `/recordings`, so sources created in the UI should use paths under `/recordings`.
