# Clipline

NAS 本地录像工作台，支持 Linux amd64 和 arm64、目录扫描、竖向时间轴、回看、片段详情、区间裁剪、跨片段拼接和导出下载。

一期不包含语音转写或画面内容识别，界面仅保留二期占位。镜像不含模型或演示录像。源录像只读，数据库、播放缓存和导出文件写入独立数据目录。

## 部署

推荐使用固定版本或镜像 digest。`edge` 是主分支开发版本；`latest` 仅随通过检查的版本标签更新。应用候选版本为 0.7.0，镜像是否已发布以仓库 Actions 为准。

准备 NAS 上两个独立目录，确认应用 UID/GID 对数据目录有读写权限、对录像目录有读取权限，再运行：

```bash
docker run -d --name clipline --init --restart unless-stopped \
  --user 1000:1000 -p 8088:8080 \
  -e TZ=Asia/Shanghai -e CLIPLINE_TIMEZONE=Asia/Shanghai \
  --mount type=bind,source=/volume1/docker/clipline/data,target=/app/data \
  --mount type=bind,source=/volume1/recordings,target=/recordings,readonly \
  evanqu/clipline:0.7.0
```

请替换目录、用户和版本。打开 NAS 的 8088 端口，添加 `/recordings` 下的实际录像目录；首次扫描在后台运行。兼容播放使用软件 H.264/AAC，快速导出保留兼容编码，精准导出进行转码。默认一个媒体任务同时执行、两条处理线程。

导出默认保留 24 小时，业务日志 30 天，播放缓存上限 2 GiB；正在下载/播放的内容受保护，源录像不参与清理。

[仓库与完整部署说明](https://github.com/HappyQuQu/clipline/blob/main/docs/DEPLOYMENT.md) · [备份与恢复](https://github.com/HappyQuQu/clipline/blob/main/docs/OPERATIONS.md)
