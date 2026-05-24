FROM node:24-slim AS frontend-build

WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim AS backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CLIPLINE_PORT=8080 \
    CLIPLINE_DATA=/app/data \
    CLIPLINE_DB=/app/data/clipline.db \
    CLIPLINE_RECORDINGS_ROOT=/recordings

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend /app/backend
RUN pip install --no-cache-dir /app/backend
RUN cp -R /app/backend/app /app/app
COPY --from=frontend-build /src/frontend/dist /app/static

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
