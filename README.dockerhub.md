# Clipline

你的录像，有迹可循。Clipline 是部署在 NAS 上的本地录像工作台，支持 Linux amd64 和 arm64、目录扫描、竖向时间轴、回看、片段详情，以及最大 7 天的跨片段、跨天裁剪与合并导出。

一期不包含语音转写或画面内容识别，界面仅保留二期占位。镜像不含模型或演示录像。源录像只读，数据库、播放缓存和导出文件写入独立数据目录。

## 界面预览

演示界面中的播放器与所有录像缩略图均已替换为占位图，不展示录像内容。

![Clipline 录像回看界面，录像画面已隐藏](https://raw.githubusercontent.com/HappyQuQu/clipline/main/docs/images/review.jpg)

## 部署

`main` 通过检查后自动生成版本；最终 amd64/arm64 镜像均通过验收后更新 `latest`。同时提供固定 `X.Y.Z`、次版本 `X.Y` 与 `edge` 标签，生产部署推荐固定版本或镜像 digest。可用版本以 GitHub Releases 和 Docker Hub 标签为准。

准备 NAS 上两个独立目录，确认应用 UID/GID 对数据目录有读写权限、对录像目录有读取权限，再运行：

```bash
docker run -d --name clipline --init --restart unless-stopped \
  --user 1000:1000 -p 8088:8080 \
  -v /path/to/clipline-data:/app/data \
  -v /path/to/recordings:/recordings:ro \
  evanqu/clipline:latest
```

请替换目录、用户和版本。应用数据目录与录像目录必须独立，不能互相嵌套；SQLite 数据目录应位于 NAS 本地文件系统。打开 `http://NAS地址:8088/`，添加容器内 `/recordings` 下的实际录像目录；首次扫描在后台运行。

## 回看与导出

- 蓝色主题，竖向时间轴支持滚动、拖动与滑杆缩放，录像最新在前，日期与起止时间清晰显示。
- 浏览器支持时优先直读原片；不支持 H.265 时使用 H.264/AAC 边转边播，无需等待整段转完。
- 默认截取一分钟，可调整起止时间并跨天导出；单次总跨度最大 7 天，包含断档。片段库多选合并要求同源同日，跨天范围从回看界面选取。
- 快速导出保留原视频编码、音轨统一 AAC，已优化长关键帧场景；编码不兼容或边界无法安全处理时使用精准模式，重新编码为 H.264/AAC。
- 任务中心支持进度、取消、重试、重启恢复及下载；处理期间可继续回看。

默认一个媒体任务同时执行、两条处理线程。首次兼容播放和精准导出的耗时取决于录像参数及 NAS 性能。应用面向可信局域网，外部访问应通过带认证的反向代理接入。

扫描策略、连续回看、默认导出模式、最长导出跨度、录像时区、媒体线程、媒体并行上限、转换分辨率、保留期限和缓存容量均可在系统设置中保存，无需配置 Docker 环境变量。新任务使用保存后的参数，已运行的任务保持原参数；清理配置在下一轮维护时生效。

导出默认保留 24 小时，业务日志 30 天，播放缓存上限 2 GiB；正在下载/播放的内容受保护，源录像不参与清理。

[仓库与完整部署说明](https://github.com/HappyQuQu/clipline/blob/main/docs/DEPLOYMENT.md) · [备份与恢复](https://github.com/HappyQuQu/clipline/blob/main/docs/OPERATIONS.md)
