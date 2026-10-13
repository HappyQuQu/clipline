# Clipline 一期后端

当前实现 D1 运行基础：版本化 SQLite、目录边界与分页浏览、统一 API 错误、配置读取、健康/架构信息、独立 Worker 心跳和容器进程管理。

扫描、索引重建、播放准备和导出尚待 D2–D4；`/api/capabilities` 明确将它们标为 false。Worker 当前只管理心跳，不领取业务任务。容器内页面仍是交互原型，页面操作尚未接真实后端。

## 本机开发

在仓库根目录创建独立数据目录，再进入 backend：

```bash
mkdir -p data/local-test
cd backend
uv sync --locked
export CLIPLINE_DATA=/Users/qu/Documents/GitHub/clipline/data/local-test
export CLIPLINE_RECORDINGS_ROOT=/Volumes/extended/clipline
export CLIPLINE_PORT=8088
uv run --frozen python -m app.runtime
```

直接在宿主机运行时录影输入受应用路径约束，Docker 的只读挂载提供更明确的写保护，真实录像验证优先使用下方容器方式。

打开 <http://127.0.0.1:8088/docs> 查看接口。API 单独启动需要先 `uv run python -m app.bootstrap`，之后运行 uvicorn；未启动 Worker 时 live 为正常、ready 为 503，这是预期行为。

## Docker 本地测试

以下命令在仓库根目录执行；项目名为 `clipline-phase-one`，端口为 8088，与旧 `clipline` 容器分开：

```bash
mkdir -p data/local-test
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) \
  docker compose --env-file deploy/local-test.env.example up --build -d
```

映射 `/Volumes/extended/clipline` 到 `/recordings` 并只读，新数据目录到 `/app/data` 并可写。使用 `GET /api/recording-directories?relativePath=media` 浏览真实录像目录；旧 DB、模型、代理及导出不作为输入源。

UID/GID 应与可写数据目录权限匹配；NAS 部署使用实际 NAS 用户和目录。不要把新数据目录指向旧映射目录。

## 验证

在 backend 内：

```bash
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest -q
```

测试覆盖空库迁移、升级前备份和失败保护、WAL/外键/约束、旧库拒绝、目录穿越/符号链接、分页与错误、Worker 独占及健康状态。CI 使用 Python 3.11/3.12；Docker 运行层锁定 Python 3.11，Python 依赖由 `uv.lock` 和带 hash 的 `requirements.lock` 锁定。

已实现边界和验证结果见 [D1 记录](../docs/qa/D1_FOUNDATION.md)，后续任务见 [开发清单](../docs/TASKS.md)。
