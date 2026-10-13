# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11.14-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    CLIPLINE_PORT=8080 \
    CLIPLINE_DATA=/app/data \
    CLIPLINE_DB=/app/data/clipline.db \
    CLIPLINE_RECORDINGS_ROOT=/recordings \
    CLIPLINE_STATIC_DIR=/app/static
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 clipline \
    && useradd --uid 1000 --gid 1000 --create-home clipline \
    && mkdir -p /app/data \
    && chown clipline:clipline /app/data
WORKDIR /app/backend
COPY backend/requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY backend/app/ ./app/
COPY backend/alembic.ini ./
COPY backend/migrations/ ./migrations/
COPY --from=frontend-build /src/frontend/dist/ /app/static/
USER clipline
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -m app.healthcheck
CMD ["python", "-m", "app.runtime"]
