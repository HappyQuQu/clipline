# Clipline 一期部署与发布检查

应用版本见仓库 `version.txt`；已发布版本见 GitHub Releases 与 Docker Hub。支持 Linux amd64 / arm64，使用 FFmpeg 软件处理；二期识别保持占位。指定目录的开发验证与 NAS 设备性能验证分别记录。

前端开发、CI 与 Docker 构建统一使用 Node.js 24 LTS，当前固定版本为 24.22.1。`.nvmrc` 提供本地与 CI 版本，Docker 构建阶段使用 `node:24.22.1-bookworm-slim`；更新 Node 24 补丁时同步修改两处，并同步 `package.json` 的最低版本。最终运行阶段使用 Python，NAS 无需安装 Node.js。

## NAS Docker Compose

1. 安装支持 Compose V2 的 Docker。下载仓库的 `compose.yaml` 与 `deploy/nas.env.example`；复制配置为 `.env.nas`，替换宿主机路径、UID/GID、端口和已通过发布检查的固定镜像版本。
2. 在 NAS 创建应用数据目录，赋予配置的 UID/GID 读写权限；该目录必须与原录像目录独立，不能互相嵌套；SQLite 数据目录应位于 NAS 本地文件系统，不放在 SMB/NFS 共享目录。确认同一用户可读取录像目录。
3. 预检通过后只拉取镜像启动，无需在 NAS 构建源码。

```bash
# 仓库根目录，已按实际 NAS 用户创建并授权 data 目录
python3 deploy/check_deployment.py --env-file .env.nas
docker compose --env-file .env.nas pull
docker compose --env-file .env.nas up -d --no-build
docker compose --env-file .env.nas ps
curl -fsS http://127.0.0.1:8088/api/health/ready
```

打开 `http://NAS地址:8088/`，在 Logo 下添加录像源，选择 `/recordings` 下实际录像文件夹。首次扫描立即进入后台队列；目录中旧数据库、模型、缓存与导出文件夹不作为源导入。应用面向可信局域网，外部访问通过已有认证反向代理提供。

镜像按主机架构自动选择，无需修改代码。默认一个媒体任务同时执行、每任务 2 线程；在系统设置中调整播放宽度、线程数与媒体并行上限；Docker 可选设置 CPU/内存硬上限。队列并行数与媒体槽上限共同约束任务，不中断已运行任务。权限错误、离线、不可播放、快速模式不兼容和导出到期均给出明确状态。

容器内 `/recordings` 只读，`/app/data` 可写。后者保存新 SQLite、生成媒体、临时文件和备份，停止/重启容器不会丢失持久化任务。不要使用 `down -v` 清理应用数据；备份与升级步骤见 [运维说明](OPERATIONS.md)。

## 指定本地目录

复制本地配置示例，将自己的录像目录只读映射到 `/recordings`；新应用数据在项目 `data/local-test`。实际设备路径仅保存在忽略的本地环境文件中。不覆盖原目录的旧库与模型。

```bash
mkdir -p data/local-test
cp deploy/local-test.env.example data/local-test.env
# 编辑 data/local-test.env，替换录像目录
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) \
  python3 deploy/check_deployment.py --env-file data/local-test.env
docker buildx build --platform linux/amd64,linux/arm64 --load -t clipline:d6-local .
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) \
  docker compose --env-file data/local-test.env up -d --no-build
```

本地正式界面 `http://127.0.0.1:8088/`；Vite 开发界面 5173 转发同一 API。正式镜像关闭 `?mode=demo`，不包含演示录像或旧图片；开发服务器仍可显式打开演示原型。镜像不含 old、识别模型、测试数据库、私有媒体或测试依赖。

## 可重复验收

```bash
uv run --directory backend --frozen pytest -q
npm test
npm run build
python3 deploy/check_image.py --image clipline:d6-local --platform linux/arm64 --version "$(cat version.txt)"
python3 deploy/smoke_release.py --image clipline:d6-local --platform linux/arm64 --require-native
# ARM 本机的 amd64 运行是仿真，不传 --require-native
python3 deploy/smoke_release.py --image clipline:d6-local --platform linux/amd64 --output data/qa/d6-amd64-emulated
```

`smoke_release.py` 自动创建独立合成录像和应用目录，以只读挂载执行扫描、时间轴、搜索、原文件 Range、兼容准备、快速/精准跨片段导出、实际取消与新 ID 重试、Worker 异常重启恢复、保存设置后重启、日志全量导出、备份与到期清理。结果包含主机/镜像架构、CPU、内存、FFmpeg、媒体结果和时间戳；退出时仅移除自己创建的 UUID 容器，输出保留在忽略的 `data/qa`。不挂载或写入 NAS 原录像。

真实录像另执行 `smoke_indexing.py --restart`、`smoke_playback.py`、`smoke_exports.py --controls`、`smoke_operations.py`，仅针对 8088 的独立本地测试容器。故障注入会重启该测试容器，浏览器短暂断线后自动重连。

## 发布门禁

开发分支 push、PR 与手动检查执行 Python 3.11/3.12 测试、lint/format/锁文件检查、前端测试与构建，以及 Ubuntu amd64、Ubuntu ARM64 **原生**镜像验收。原生 runner 构建各自架构，不安装 QEMU；脚本要求主机/镜像架构相同。[GitHub runner 规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)提供 `ubuntu-24.04` 与 `ubuntu-24.04-arm`。

`main` 通过源码检查后，Release Please 根据 Conventional Commits 生成版本 PR 与变更记录。仅自动合并来自本仓库 Actions bot、基于当前 main、且只修改版本和变更记录的 PR；依赖或业务代码改动会使门禁失败。版本提交同步 `version.txt`、前后端版本、npm/uv 锁文件及发布 manifest，再显式重新运行源码检查。使用 `feat:`、`fix:` 等提交前缀产生版本；只有文档或 CI 改动时可能不升版。[Release Please 配置说明](https://github.com/googleapis/release-please-action)。

对最终提交分别构建 amd64/arm64 镜像，以 digest 暂存并拉取验收。两份验收都成功后，直接用已验证的 digest 组合双架构 manifest，核对运行镜像与验收记录一致，再发布标签。SBOM 与来源证明保留在镜像中；不传递大体积 image.tar，也不在发布阶段重新构建。[Docker 双架构发布说明](https://docs.docker.com/build/ci/github-actions/multi-platform/)。

| 触发方式 | 发布标签 |
| --- | --- |
| main 自动生成新版本 | `X.Y.Z`、`X.Y`、`edge`、`latest`、`sha-完整提交SHA` |
| main 没有需要升版的提交 | `edge`、`latest`、`sha-完整提交SHA` |
| 已存在的 `vX.Y.Z` 标签 | `X.Y.Z`、`X.Y`、`latest`、`sha-完整提交SHA` |
| 手动输入 `edge` 或自定义预览标签 | 指定预览标签、`sha-完整提交SHA` |

`latest` 最后更新。发布工作流串行执行；过时的 main/版本发布不会覆盖当前 `edge`、`latest` 或次版本指针。同一固定版本与 SHA 标签拒绝覆盖不同镜像内容。开发分支 push/PR 不推送 Docker Hub。

仓库配置要求：

- Settings → Actions → General → Workflow permissions 启用 **Allow GitHub Actions to create and approve pull requests**，用于创建版本 PR；默认 workflow 权限仍可保留只读，仅版本 job 请求写权限。已有分支保护继续生效，自动合并不使用管理员绕过。
- Secrets 配置 `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`；可选 `DOCKERHUB_DESCRIPTION_TOKEN` 同步仓库说明。说明同步失败不阻止已验收的镜像发布。
- 可选 variable `DOCKERHUB_NAMESPACE`，默认 `evanqu`。更换命名空间前先确认账号有推送权限。

若检查失败，`latest` 不更新；保留 Actions 日志修复后重跑。若 GitHub 版本已经生成而镜像发布失败，在 **Publish Docker image → Run workflow** 选择对应 `vX.Y.Z` 标签，输入 `release` 重试；不要重新生成版本。已有固定标签若与重建内容不同，会拒绝覆盖，应使用新版本。手动预览禁止输入 `latest`、版本号、`sha-*` 或 `candidate-*`。

验收证据 `native-evidence-amd64/arm64` 保留 7 天；元数据与已验证 digest 小文件保留 3 天，主要用于同次工作流的发布组合。首次自动发布需要合并该配置到 main；开发分支 CI 成功不表示稳定镜像已经发布。

Actions 中两份 native-evidence 记录证明原生 Linux 软件流程；本机 ARM64 Docker 实测/amd64 仿真与 NAS 实机性能不是同一证据。实际 NAS CPU/内存、挂载权限、长任务耗时和设备故障应在部署后按同一场景记录，不用仿真结果替代设备指标。

## 2 GiB、共存其他服务的实测档位

用户提供的 x86 NAS 主机已验证 1 CPU / 768 MiB 硬上限、1 媒体线程、1280 兼容播放和精准输出，HA 容器前后保持同一启动实例。环境文件可设置：

```dotenv
CLIPLINE_CPU_LIMIT=1
CLIPLINE_MEMORY_LIMIT=768m
```

在系统后台任务设置中保存队列并行 1、媒体并行 1、媒体线程 1；在回看和导出设置中分别保存最大宽度 1280。`0` 表示不额外设置 Docker CPU/内存限制；镜像内部媒体槽与线程限制仍然生效。该档位支持 4K 原始输入后缩放输出，短真实 HEVC/Opus 与 60 秒控制样本通过，完整长 4K 输出的性能另行记录。

设备验收可从已测试镜像运行以下脚本，root 驱动仅对新建测试目录设置 UID/GID，不修改系统用户。`--real-sample` 应指向用户授权的短 HEVC/Opus 4K 样本；输入复制到独立目录并只读挂载。资源限制同时覆盖样本生成与应用容器。

```bash
python3 deploy/smoke_release.py --image clipline:tested-candidate --require-native \
  --uid 1000 --gid 1000 --cpus 1 --memory 768m --playback-width 1280 \
  --real-sample short-hevc-opus.mp4 --output ~/clipline/qa
```

测试结束保留结果，移除自身创建的容器。若宿主机已有 HA 等服务，先后只读核对其容器 ID、启动时间、重启次数与运行状态；不对其执行重启、更新或配置操作。
