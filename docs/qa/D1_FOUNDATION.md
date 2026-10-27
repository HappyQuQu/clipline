# D1 运行与数据基础验证

> 历史验收记录：版本、测试数量、功能限制与设备状态对应各次验证时间，不代表当前状态。部分 `data/qa` 本地产物已清理；当前功能与操作以 [开发文档](../DEVELOPMENT.md)和 [部署说明](../DEPLOYMENT.md)为准。

日期：2026-10-13（Asia/Shanghai）。范围：D1-01–D1-08；实现提交：`a65f235`；当前后端阶段为 `foundation`。

## 实现范围

- 新建 Python/FastAPI 后端、配置/服务/API/数据库/任务模块，Python 依赖锁定。
- 建立九张核心表及两版 Alembic 迁移，启用 WAL、外键和约束；升级前使用 SQLite backup。
- 提供限定根目录的分页浏览、路径和符号链接边界校验，以及统一错误/requestId。
- 提供设置读取、版本/架构/空间信息、live/ready 和关闭的二期能力。
- 使用 `app.runtime` 管理独立 API/Worker：启动先迁移，子进程异常退出则停止容器，正常退出清理进程组与 Worker 租约。
- 新增双架构 Dockerfile、Compose、本地环境示例、媒体 smoke 脚本和 Python 3.11/3.12 CI 检查。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| Python 3.11 后端测试 | 32 项通过 |
| Python 3.12 隔离环境后端测试 | 32 项通过 |
| Ruff 检查与格式 | 通过，包含本地 smoke 脚本 |
| uv 锁文件检查 | 通过；Docker 安装使用带 hash 的依赖导出 |
| Alembic schema 对比 | `No new upgrade operations detected` |
| 前端领域测试 | 11 项通过 |
| 前端生产构建 | 通过 |
| Compose 配置解析 | 通过 |

后端测试包括：空库/重复迁移、设置保留、旧库拒绝与校验值不变、WAL 数据备份、迁移失败保护、事件 ID 清理后不复用、外键/路径唯一/任务约束、配置边界、目录遍历/符号链接/权限、分页上下文、错误格式、Worker 独占/停止和 ready 状态。

## 本地 Docker 与真实媒体

| 项目 | ARM64 | amd64 |
| --- | --- | --- |
| 执行环境 | ARM 主机的原生 Linux 容器 | 同一主机上的模拟执行 |
| 镜像构建、API/Worker 启动 | 通过 | 通过 |
| ready 与实际目录浏览 | 通过 | 通过 |
| 指定根目录只读、数据目录独立可写 | 通过 | 通过 |
| 真实 HEVC 文件探测与首帧解码 | 通过 | 通过 |
| 样本 SHA-256 处理前后比较 | 一致 | 一致 |
| 模型文件和 ASR/视觉 Python 包 | 未安装 | 未安装 |

Docker Engine 为 29.8.2。宿主机输入固定为 `/Volumes/extended/clipline`，容器中为 `/recordings`；选择 `media` 下的实际录像。验证样本为 HEVC，时长约 903.201438 秒；输出首帧仅写入各自新数据目录的 `tmp/d1-media-probe.jpg`。

原生 ARM 数据目录为项目 `data/local-test`，amd64 smoke 使用项目 `data/d1-amd64`。旧数据库、设置和缓存不导入、不覆盖；smoke 不向原目录写探针文件，而是检查 Docker mount 的 `RW=false` 并验证样本内容不变。

已验证 Worker 退出触发容器 restart，重启计数由 0 变 1，ready 恢复。正常停止容器退出码为 0，协调器租约清零。持久化测试库从 `0001_foundation` 升级到 `0002_event_sequence`，升级前备份保留原版本与四类设置。

## 复现

在仓库根目录：

```bash
mkdir -p data/local-test
docker buildx build --platform linux/amd64,linux/arm64 --tag clipline:d1-local --load .
CLIPLINE_UID=$(id -u) CLIPLINE_GID=$(id -g) \
  docker compose --env-file deploy/local-test.env.example up --no-build -d
python3 deploy/smoke_foundation.py \
  --container clipline-phase-one-clipline-1 --url http://127.0.0.1:8088
npm run test:backend
npm test
npm run build
```

接口文档位于 <http://127.0.0.1:8088/docs>。后端更多说明见 [backend README](../../backend/README.md)。

## 当前边界

Worker 只提供协调器心跳；未实现扫描、重建、播放准备或导出任务执行，capabilities 均为 false。容器页面仍为前端交互原型，尚未接通真实录像源与媒体接口。

本记录仅完成 D1 和媒体工具基础验证，不代替 AC-01–AC-15 的正式流程验收。特别是 amd64 仍需原生 x86 NAS 测试，真实转码、裁剪、队列恢复与完整 UI 接入由 D2–D6 完成；二期继续仅占位。
