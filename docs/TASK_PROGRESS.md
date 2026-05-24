# Clipline Task Progress

## 更新规则

- 每次完成开发、修复、验证或文档调整后，必须更新本文档。
- 更新内容至少包含：日期时间、完成事项、验证结果、遗留问题、下一步建议。
- 若本次只做了很小的改动，也需要追加一条简短记录。

## 当前状态

- 项目阶段：MVP 开发中。
- 开发模式：先后端，后前端。
- 当前部署方式：Docker Compose 单容器。
- 当前访问地址：http://127.0.0.1:8080

## 进度记录

### 2026-05-24 21:54 CST

完成事项：

- 修复左侧窄导航栏图标“看起来可点但没有反应”的问题。
- 新增前端导航状态 `activeView`，左侧 Protect、录像回放、片段墙、录像源、设置均可点击切换。
- 给导航按钮补充 `onClick`、选中态、`aria-label` 和 `aria-pressed`。
- 新增录像源页面和设置概览页面，点击对应图标后主区域会切换内容。
- Docker 镜像已重建并重启容器。

验证结果：

- `npm run build` 通过。
- `docker compose build` 通过。
- `docker compose up -d --force-recreate` 已启动成功。
- `GET /api/health` 返回 `{"ok": true}`。
- 首页 HTML 已加载新静态资源：`/assets/index-DtNTtLcN.js` 与 `/assets/index-BUDQBx36.css`。
- 源码确认存在 `setActiveView`、`onClick`、`aria-pressed`、`SourceStage`、`SettingsStage`。

遗留问题：

- 仍未做真实浏览器点击级验收，当前通过源码检查、构建和容器冒烟验证。
- 录像源页和设置页为 MVP 概览版，后续还可以继续精修交互。

下一步建议：

- 接入 Playwright 冒烟测试，覆盖左侧导航点击。
- 继续按 UniFi 风格打磨源控制栏和卡片墙细节。

### 2026-05-24 21:39 CST

完成事项：

- 参考 UniFi Protect 风格重做主界面：左侧窄导航、源控制栏、主播放器、时间轨、底部录像卡片墙。
- 移除前端日志展示区域，前端源码和构建产物不再引用 `system/logs`、日志面板或日志文字。
- 保留源管理、日期选择、扫描、启停、导出、片段选择等 MVP 功能。
- 录像片段卡片改为视频缩略预览样式，主播放器优先展示。
- 补充 `GET /api/segments` 片段列表接口，用于扫描失败文件明细查询。
- API 文档已补充片段列表接口说明。
- UI Flow 文档已同步新的界面结构，并明确 MVP 不在界面展示日志。
- Docker 镜像已重建并重启容器。

验证结果：

- `npm run build` 通过。
- `docker compose build` 通过。
- `docker compose up -d --force-recreate` 已启动成功。
- `GET /api/health` 返回 `{"ok": true}`。
- 首页 HTML 已加载新静态资源：`/assets/index-9F8ID3Gz.js` 与 `/assets/index-BQKg5sFg.css`。
- `rg "system/logs|logPanel|Terminal|日志" frontend/src frontend/dist` 无匹配结果。

遗留问题：

- 由于当前没有可用的 in-app browser 工具，本轮未做截图级视觉验收。
- 片段卡片暂用视频 metadata 预览，正式缩略图生成仍属于 P1 能力。
- 界面仍是单文件 `App.tsx`，后续应拆分组件。

下一步建议：

- 接入真实浏览器截图或 Playwright 冒烟测试。
- 实现后端缩略图生成，提升卡片墙加载性能。
- 将播放器、源控制栏、录像卡片墙拆成独立组件。

### 2026-05-24 20:13 CST

完成事项：

- 后端新增扫描任务并发保护：同一源已有 `queued` 或 `running` 扫描时，手动扫描复用已有任务。
- 后端新增 `GET /api/scan-jobs`，支持按 `sourceId`、`status` 查询最近扫描任务。
- 扫描任务响应补充 `createdAt`、`updatedAt` 字段，便于前端展示最近状态。
- 前端新增“最近扫描”面板，显示任务状态、时间、扫描文件数、新增数和错误数。
- 前端扫描任务列表使用 TanStack Query 定时刷新。
- API/DB、PRD、技术设计文档已同步更新。

验证结果：

- `python3 -m compileall backend/app` 通过。
- `npm run build` 通过。
- `docker compose build` 通过。
- `docker compose up -d --force-recreate` 已启动成功。
- `GET /api/health` 返回 `{"ok": true}`。
- `GET /api/scan-jobs?sourceId=src_eeb8cb21f4994895&limit=3` 返回最近扫描任务。
- 使用临时 queued 扫描任务验证重复扫描复用逻辑，`POST /api/sources/{sourceId}/scan` 返回已有 `scanJobId`。
- 临时测试扫描任务已从 SQLite 中清理。

遗留问题：

- 目前并发保护基于数据库活跃任务查询，尚未加入更强的数据库级唯一约束。
- 扫描任务列表只展示摘要，失败文件明细尚未暴露。
- UI 仍未做真实浏览器截图级验证。

下一步建议：

- 增加扫描失败文件列表接口和前端明细展示。
- 补充后端 API 集成测试，覆盖扫描重复排队逻辑。
- 抽离前端扫描任务面板组件，降低 `App.tsx` 体积。

### 2026-05-24 19:31 CST

完成事项：

- 前端接入 Tailwind CSS 工具链，Vite 已配置 `@tailwindcss/vite`。
- 前端接入 TanStack Query，源列表、目录、时间线、导出任务、日志改为 query 管理。
- 前端接入 Radix UI，源选择使用 Select，源启停使用 Switch，导出模式使用 ToggleGroup，操作反馈使用 Toast。
- 新增源启用/停用的前端开关，并调用已有 `PATCH /api/sources/{sourceId}`。
- 更新技术设计文档，前端技术栈与实际实现重新对齐。
- Docker 镜像已重建并重新启动容器。

验证结果：

- `npm run build` 通过。
- `docker compose build` 通过。
- `docker compose up -d --force-recreate` 已启动成功。
- `GET /api/health` 返回 `{"ok": true}`。
- 首页 HTML 已加载新静态资源：`/assets/index-CTbkc1lD.js` 与 `/assets/index-R-A5xwuZ.css`。
- `GET /api/system/status` 显示 ffmpeg、ffprobe、SQLite、日志文件和测试源可用。

遗留问题：

- UI 仍未做真实浏览器截图级验证，当前通过构建、容器启动和接口验证确认可运行。
- TanStack Query 已覆盖主要数据流，但扫描任务详情页和更细粒度轮询尚未独立抽象。
- Radix 目前只接入核心控件，后续弹窗、菜单、Tabs、日期时间选择器可继续统一迁移。

下一步建议：

- 增加前端基础测试或 Playwright 冒烟测试。
- 抽离前端组件目录，减少 `App.tsx` 体积。
- 增加扫描任务状态面板，展示最近一次扫描进度和失败文件。

### 2026-05-24 18:51 CST

完成事项：

- 完成 PRD、MVP 范围、UI Flow、技术设计、API/DB 文档的初版与修订。
- 后端完成 FastAPI 项目骨架、SQLite 初始化、源管理、目录浏览、手动扫描、时间线、片段详情、Range 视频流、导出任务、系统状态接口。
- 接入日志系统：控制台日志、轮转文件日志、`X-Request-ID`、请求耗时、扫描/导出业务日志、`GET /api/system/logs`。
- 前端完成源管理、目录选择、扫描触发、时间线、播放器、导出任务、日志面板。
- 完成 Dockerfile、docker-compose.yml、.dockerignore。
- 修复扫描重跑时旧路径片段未清理导致时间线重复的问题。
- 补充后端 README 中的 Docker 启动说明。
- 建立任务进度文档，并明确后续每次完成工作后必须更新。

验证结果：

- `python3 -m compileall backend/app` 通过。
- `npm run build` 通过。
- `docker compose build` 通过。
- `docker compose up -d --force-recreate` 已启动成功。
- `GET /api/health` 返回 `{"ok": true}`。
- `GET /api/system/status` 显示 ffmpeg、ffprobe、SQLite、日志文件可用。
- `GET /api/system/logs` 可读取 `/app/data/logs/clipline.log`。
- 手动扫描测试源完成，时间线保持 2 个片段，重复片段问题已验证修复。

遗留问题：

- 当前没有正式自动化测试用例，主要依赖编译、构建和接口冒烟验证。
- SQLite schema 目前由 SQLAlchemy 初始化，Alembic 迁移暂未接入。
- 缩略图能力仍为 P1，MVP 暂未实现。
- UI 未做真实浏览器截图级验证，当前通过构建和接口验证确认可运行。

下一步建议：

- 补充后端单元测试和 API 集成测试。
- 增加扫描任务并发保护，避免同一源重复扫描。
- 完善导出任务清理和失败重试策略。
- 做一次真实录像目录的大文件扫描验证。
