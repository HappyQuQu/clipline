# Clipline 项目规则

- 产品边界和开发顺序见 [需求](docs/REQUIREMENTS.md)、[开发文档](docs/DEVELOPMENT.md) 与 [任务清单](docs/TASKS.md)。正式实现位于 `backend/` 和 `frontend/`，`old/` 是历史参考。
- 录像源默认只读。回看准备、导出和缓存沿用后端的任务与持久化目录；界面用真实的能力和状态区分快速与精准导出。
- 前端沿用 `frontend/src/styles.css` 和现有播放器、时间轴交互。检查改动时用本地演示素材走受影响的回看或导出流程。
- 前端用 `npm ci --prefix frontend` 安装，根目录用 `npm run dev` 或 `npm run build`。后端在 `backend/` 按 [CI](.github/workflows/phase-one-checks.yml) 使用 `uv sync --locked`、`uv run --frozen ruff check . ../deploy` 和相关检查。
