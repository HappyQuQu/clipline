FROM node:24-slim AS frontend-build

WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim AS backend

ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
ARG TORCH_VERSION=2.8.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CLIPLINE_PORT=8080 \
    CLIPLINE_DATA=/app/data \
    CLIPLINE_DB=/app/data/clipline.db \
    CLIPLINE_MODEL_CACHE_DIR=/app/data/models \
    CLIPLINE_RECORDINGS_ROOT=/recordings

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir --index-url ${TORCH_INDEX_URL} \
    "torch==${TORCH_VERSION}" "torchaudio==${TORCH_VERSION}"
COPY backend/pyproject.toml backend/README.md /tmp/clipline-backend/
COPY docker/backend-package-stub/app /tmp/clipline-backend/app
RUN set -eu; \
    pip_args="--no-cache-dir --index-url ${PIP_INDEX_URL}"; \
    if [ -n "${PIP_TRUSTED_HOST}" ]; then \
        pip_args="${pip_args} --trusted-host ${PIP_TRUSTED_HOST}"; \
    fi; \
    pip install ${pip_args} '/tmp/clipline-backend[asr,vision]'; \
    rm -rf /tmp/clipline-backend
COPY backend /app/backend
RUN cp -R /app/backend/app /app/app
COPY --from=frontend-build /src/frontend/dist /app/static

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
