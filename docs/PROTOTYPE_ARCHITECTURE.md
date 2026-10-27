# Clipline 演示模式与扩展边界

更新：2026-10-27。

默认页面由 `frontend/src/App.jsx` 提供，接入真实 API。开发服务器可通过 `http://127.0.0.1:5173/?mode=demo` 打开独立演示模式；它用于检查交互和布局。正式功能、接口和运行约束见 [开发文档](DEVELOPMENT.md)与 [后端说明](../backend/README.md)。

## 入口与数据

`frontend/src/main.jsx` 仅在构建变量 `VITE_ENABLE_DEMO` 不为 `false` 且 URL 带 `mode=demo` 时加载 `DemoApp.jsx`，其他情况加载 `App.jsx`。Docker 构建设置 `VITE_ENABLE_DEMO=false`，并移除示例录像和图片。

| 位置 | 演示职责 |
| --- | --- |
| `frontend/src/DemoApp.jsx` | 演示导航、源选择、浏览器任务队列、设置和日志 |
| `frontend/src/domain.js` | 示例录像、源、任务与日志，以及演示时间和区间计算 |
| `frontend/src/pages/`、`frontend/src/components/` | 与正式模式共享的界面组件；实际数据和操作由调用方提供 |
| `frontend/public/assets/` | 开发演示使用的示例媒体及正式页面使用的图标、占位图 |

演示源、任务、日志与设置保存在浏览器 localStorage，使用 `clipline-v1-` 前缀。演示任务进度由页面驱动，关闭页面后不会继续处理；示例下载使用固定媒体，不执行真实裁剪或拼接。演示结果不能作为扫描、导出或部署验收证据。

正式模式使用服务端索引、持久化任务、日志和设置；扫描、播放准备、导出及恢复由 API 与 Worker 完成。演示模式的本地数据不导入正式数据库。

## 二期扩展

`frontend/src/capabilities.js` 中的 `transcription`、`visualRecognition` 和 `semanticSearch` 当前均关闭。`extensionRegistry` 仅接受已启用能力的组件注册，一期不加载识别 provider 或模型。

| 插槽 | 用途 |
| --- | --- |
| `clip-detail` | 片段详情中的字幕、画面识别结果及操作 |
| `timeline-track` | 有真实事件数据时的时间点标记 |
| `task-type` | 识别任务详情与类型专用动作 |
| `settings-section` | 模型、默认策略与资源配置 |
| `search-provider` | 内容搜索结果 |
| `library-filters` | 字幕、画面标签及识别状态筛选 |
| `source-settings` | 按源配置识别触发策略 |

插槽及静态二期占位用于保留接入位置。实现二期时需要同时补充后端能力、数据契约、任务处理和界面组件；仅打开前端开关不会产生识别功能。具体范围见 [需求文档](REQUIREMENTS.md)。
