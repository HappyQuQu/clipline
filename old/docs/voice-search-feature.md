# 语音识别与检索功能

## 功能概述

Clipline 新增了语音识别与全文检索功能，用户可以通过搜索对话内容来定位到具体视频时间点。

## 核心功能

### 1. 语音识别（ASR）
- 支持多种 ASR 模型：FunASR、SenseVoice、Whisper
- 自动提取视频音轨并转换为文字
- 带时间戳的识别结果
- 支持中文、英文、中英混合

### 2. 全文检索
- 搜索识别出的文字内容
- 按摄像头、时间范围筛选
- 搜索结果高亮显示
- 点击结果跳转到对应时间点

### 3. 字幕显示
- 实时字幕：视频播放时显示当前对话
- 字幕列表：显示所有识别结果，点击跳转
- 支持导出 SRT/TXT 字幕文件

### 4. 批量操作
- 批量选择视频片段
- 批量触发语音识别

## 使用方法

### 安装依赖

```bash
# 后端 ASR 依赖
cd backend
pip install -e ".[asr]"

# 或者只安装 FunASR
pip install funasr torch torchaudio
```

### 配置 ASR

通过环境变量配置 ASR 参数：

```bash
# ASR 模型选择
CLIPLINE_ASR_MODEL=funasr  # funasr/sensevoice/whisper

# 模型大小
CLIPLINE_ASR_MODEL_SIZE=base  # tiny/base/medium/large

# 模型缓存目录，默认在 CLIPLINE_DATA/models 下
CLIPLINE_MODEL_CACHE_DIR=/app/data/models

# 运行设备
CLIPLINE_ASR_DEVICE=auto  # auto/cpu/cuda/mps

# 识别语言
CLIPLINE_ASR_LANGUAGE=zh  # zh/en/mixed

# 自动识别新视频
CLIPLINE_ASR_AUTO_TRANSCRIBE=false

# 热词（逗号分隔）
CLIPLINE_ASR_HOTWORDS=张三,李四,公司名
```

模型目录统一放在 `CLIPLINE_MODEL_CACHE_DIR`，NAS/Docker 部署时建议直接映射 `/app/data`。下载困难时可以提前放入：

- FunASR / SenseVoice: `/app/data/models/modelscope/hub/models/...`
- Whisper: `/app/data/models/whisper/*.pt`

### 使用步骤

1. **触发识别**
   - 在视频播放器中点击 🔍 按钮
   - 或在片段墙中批量选择后点击"批量识别语音"

2. **等待识别完成**
   - 识别任务在后台运行
   - 可在日志页面查看识别进度

3. **搜索对话**
   - 在顶部搜索框输入关键词
   - 按回车或点击搜索
   - 查看搜索结果列表

4. **查看结果**
   - 点击搜索结果跳转到对应时间点
   - 视频会自动定位到识别出的对话位置
   - 可查看实时字幕或字幕列表

5. **导出字幕**
   - 在搜索结果或字幕列表中点击"导出 SRT/TXT"
   - 下载字幕文件

## API 接口

### 识别任务

```
POST /api/segments/{segment_id}/transcribe
```

触发语音识别任务。

### 获取识别结果

```
GET /api/segments/{segment_id}/transcription
```

获取某个视频的识别结果。

### 搜索

```
GET /api/search?q=关键词&sourceId=xxx&startDate=xxx&endDate=xxx
```

全文检索。

### 导出字幕

```
GET /api/segments/{segment_id}/transcription/export?format=srt
```

导出识别结果为 SRT 或 TXT 格式。

## 数据库表

### transcriptions
- `id`: 主键
- `segment_id`: 关联视频片段
- `start_time`: 开始时间（秒）
- `end_time`: 结束时间（秒）
- `text`: 识别文字
- `confidence`: 置信度
- `created_at`: 创建时间

### transcription_jobs
- `id`: 主键
- `segment_id`: 关联视频片段
- `status`: 任务状态（pending/processing/completed/failed）
- `progress`: 进度（0-1）
- `error_message`: 错误信息
- `created_at`: 创建时间
- `updated_at`: 更新时间

## 注意事项

1. **首次运行**：需要下载 ASR 模型，请确保网络连接正常
2. **资源消耗**：语音识别是 CPU/GPU 密集型任务，建议在空闲时运行
3. **存储空间**：识别结果会占用数据库空间，定期清理不需要的结果
4. **识别准确度**：噪音环境可能影响识别效果，可调整热词提高准确度
