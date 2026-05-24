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

## Docker

From the repository root:

```bash
docker compose up -d --build
```

The app is served at `http://127.0.0.1:8080`. The compose file mounts `./recordings` read-only as `/recordings`, so sources created in the UI should use paths under `/recordings`.
