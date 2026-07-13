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

### 2026-07-11 14:11 CST

完成事项：

- 完成 UI 优化 P2 回看工作台第一版。
- 新增独立 `PlaybackViewer`，统一播放/暂停、前后 10 秒、进度、倍速、音量、全屏、扫描、识别和导出操作。
- 新增空格播放/暂停、左右方向键快退/快进 10 秒的键盘操作。
- 播放器、左侧时间轴和底部单排片段带重排，播放器成为第一视觉中心。
- 片段区默认高度降为一排缩略图，支持拖拽调整、双击复位和按钮收起/展开。
- 修复片段区标题与滚动内容高度叠加导致的溢出问题。
- 历史录像源在默认最近 7 天没有片段时，首次打开会自动定位到该源最新录像日期范围。
- 移动端新增回看、智能检索、源、导出任务、设置五项底部导航，修复窄屏无主导航的问题。
- 片段右键菜单、识别状态和设置页功能图标全部改为 lucide，删除已退出主流程的旧批量操作和字幕任务组件。
- 修复 Radix SourceSelect 从非受控切换到受控产生的浏览器警告。
- 播放状态与片段自动播放意图分离，避免旧视频暂停事件覆盖新片段状态。
- 同步更新 `docs/UI_FLOW.md` 和 `docs/UI_OPTIMIZATION_PLAN.md`。

验证结果：

- `npm run build` 通过，生成 `/assets/index-BJwS79RR.js` 与 `/assets/index-CRucgiqY.css`。
- 本地 FastAPI 服务启动成功，`GET /api/health` 返回 `{"ok":true}`。
- 使用临时录像源扫描仓库测试视频：3/3 文件入库、0 错误；视频元素达到 `readyState=4`，5 秒 H.264 片段正确加载；测试源随后已删除，测试文件时间戳已恢复。
- 浏览器在 1440x900、1024x768、390x844 三档完成响应式检查，均无横向溢出或工具栏重叠。
- 1024px 下播放器高度 445px、片段区 210px；390px 下底部主导航可见，播放器顶部身份区与操作区无重叠。
- 实际点击验证移动端“源 -> 回放”导航切换，以及播放器 1x -> 1.5x 倍速切换。
- 最终浏览器回归渲染 20 个虚拟化片段卡片，所有可见按钮均有可访问名称，控制台无 warning/error。
- `rg` 检查前端源码和构建产物无日志 UI 引用；前端源码无 emoji 功能图标。
- `git diff --check` 通过。
- `docker compose build` 仍在拉取 `python:3.12-slim` / `node:24-slim` metadata 时失败，本次错误为 `DeadlineExceeded: context deadline exceeded`。

遗留问题：

- Docker 镜像构建仍受 Docker Hub 网络影响，尚未完成容器内回归。
- 浏览器自动化环境未稳定观察到媒体开始播放状态，但真实视频资源、metadata、控制事件和失败反馈链路均已加载；建议在用户浏览器进行一次声音/全屏人工验收。
- P3 智能检索结果定位体验和 P4 录像源表格/抽屉改造尚未开始。

下一步建议：

- 网络恢复后重跑 `docker compose build && docker compose up -d --force-recreate`，再检查容器内 `/api/health` 和真实视频播放。
- 继续执行 P3：整理智能检索结果列表、预览定位和空/错/加载状态。

### 2026-07-11 11:29 CST

完成事项：

- 完成 UI 优化 P1 信息架构清理第一版。
- 前端主导航收敛为：录像回放、智能检索、录像源、导出任务、设置。
- 移除普通 UI 的日志入口、日志视图组件和设置页日志 tab。
- 设置概览页不再展示日志文件路径。
- 顶部常驻搜索输入框改为智能检索按钮，保留 `Ctrl/Cmd + K` 快捷键。
- 智能检索页新增搜索输入框、清除按钮、提交按钮和搜索历史快捷入口。
- 删除前端未使用的日志视图文件。
- 同步更新 `docs/UI_FLOW.md` 和 `docs/UI_OPTIMIZATION_PLAN.md`。

验证结果：

- `npm run build` 通过，生成 `/assets/index-t464MbAd.js` 与 `/assets/index-BqFiC29g.css`。
- `rg "日志|LogsStage|LogsTab|activeView === 'logs'|key: 'logs'" frontend/src frontend/dist` 无匹配结果。
- `rg "片段墙|字幕任务" frontend/src/App.tsx frontend/dist/assets/index-*.js` 无匹配结果。
- `npm ls @tanstack/react-virtual` 确认本地依赖可用。
- `docker compose build` 重试两次均失败在 Docker Hub 基础镜像 metadata 获取阶段：`node:24-slim` 和 `python:3.12-slim` 返回 EOF。
- 当前本机没有 `node:24-slim`、`python:3.12-slim` 基础镜像缓存，且 `docker compose ps` 显示没有运行中的服务。

遗留问题：

- Docker 验证受外部网络影响未完成，本轮只完成前端构建验证。
- P2 回看工作台视觉重做尚未开始。
- 片段卡片右键菜单和部分识别状态仍有 emoji，需要在 P5 视觉 token 和组件整理阶段处理。

下一步建议：

- 等 Docker Hub 网络恢复后重跑 `docker compose build && docker compose up -d --force-recreate`。
- 继续执行 P2：重做回看工作台，优先放大播放器、梳理时间线和片段墙布局。

### 2026-07-11 00:08 CST

完成事项：

- 结合上一轮 UI 分析，新增 `docs/UI_OPTIMIZATION_PLAN.md`。
- 明确不采用完整 Neumorphism，改为 UniFi-inspired Soft Utility UI 方向。
- 梳理目标信息架构：回看、智能检索、录像源、导出、设置。
- 明确普通 UI 不显示日志，日志只保留为后端诊断能力。
- 制定 P0-P5 阶段化落地计划和验收清单。

验证结果：

- 已检查当前前端入口，确认主导航和设置页仍存在日志入口，后续实现阶段需要移除。
- 已检查当前片段卡片存在 emoji 状态/菜单图标，后续实现阶段需要替换为 lucide 图标。
- 本轮仅新增和更新文档，未运行前端构建或 Docker 重建。

遗留问题：

- 方案尚未进入代码实现。
- `docs/UI_FLOW.md` 仍是旧版流程，需要在 UI 实施时同步修订。

下一步建议：

- 先执行 P1 信息架构清理，移除普通 UI 的日志入口并收敛主导航。
- 然后执行 P2 回看工作台重做，优先解决播放器、时间线和片段墙的主体验。

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
