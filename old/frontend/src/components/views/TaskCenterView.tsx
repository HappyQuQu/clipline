import {
  ArrowClockwise,
  CheckCircle,
  DownloadSimple,
  Eye,
  FileText,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../../api";
import type { ExportJob, TranscriptionJob, VisionJob } from "../../types";
import type { DisplaySegment } from "../../utils";
import {
  exportProgressPercent,
  formatBytes,
  formatClipDateTime,
  formatDuration,
  queryMessage,
  toDisplaySegment,
} from "../../utils";

type TaskKind = "export" | "transcription" | "vision" | "model";
type TaskStatus = "all" | "active" | "waiting" | "completed" | "failed";

type UnifiedTask = {
  id: string;
  kind: TaskKind;
  title: string;
  subtitle: string;
  source: string;
  status: string;
  statusGroup: Exclude<TaskStatus, "all">;
  statusLabel: string;
  progress: number;
  progressIndeterminate?: boolean;
  result: string;
  createdAt: string;
  segment?: DisplaySegment;
  downloadUrl?: string | null;
  outputSize?: number | null;
  error?: string | null;
  exportJob?: ExportJob;
  transcriptionJob?: TranscriptionJob;
  visionJob?: VisionJob;
  modelId?: string;
};

function normalizeStatus(status: string): UnifiedTask["statusGroup"] {
  if (
    status === "running" ||
    status === "processing" ||
    status === "downloading"
  )
    return "active";
  if (status === "queued" || status === "pending") return "waiting";
  if (status === "completed") return "completed";
  return "failed";
}

function statusLabel(status: string) {
  if (status === "running" || status === "processing") return "进行中";
  if (status === "downloading") return "下载中";
  if (status === "queued" || status === "pending") return "待处理";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已取消";
  if (status === "expired") return "已过期";
  return status;
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    queued: "等待调度",
    preparing: "准备文件",
    extracting_audio: "提取音频",
    loading_model: "加载模型",
    transcribing: "识别语音",
    finalizing: "整理识别结果",
    extracting_frames: "提取视频帧",
    detecting: "分析视频帧",
    saving: "保存结果",
    downloading: "下载模型文件",
    downloading_modelscope: "从 ModelScope 下载",
    verifying: "校验模型文件",
    loading: "验证模型可用性",
    completed: "下载完成",
  };
  return labels[stage] ?? stage;
}

export function TaskCenterView({
  exports,
  exportError,
  segments,
  sourceNames,
  onSelectSegment,
  onNotify,
}: {
  exports: ExportJob[];
  exportError: unknown;
  segments: DisplaySegment[];
  sourceNames: Map<string, string>;
  onSelectSegment: (segment: DisplaySegment, kind?: TaskKind) => void;
  onNotify: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TaskStatus>("all");
  const [retryingId, setRetryingId] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");

  const transcriptionJobsQuery = useQuery({
    queryKey: ["taskCenter", "transcriptionJobs"],
    queryFn: () => api.getTranscriptionJobs(),
    refetchInterval: 2500,
  });
  const visionJobsQuery = useQuery({
    queryKey: ["taskCenter", "visionJobs"],
    queryFn: () => api.getVisionJobs(),
    refetchInterval: 2500,
  });
  const modelCatalogQuery = useQuery({
    queryKey: ["taskCenter", "modelCatalog"],
    queryFn: () => api.getASRModels(),
    staleTime: 60000,
  });
  const modelJobsQuery = useQuery({
    queryKey: ["taskCenter", "modelDownloads"],
    queryFn: () => api.getASRModelDownloads(),
    refetchInterval: 2500,
  });

  const segmentById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  );

  const tasks = useMemo<UnifiedTask[]>(() => {
    const exportRows: UnifiedTask[] = exports.map((job) => ({
      id: `export:${job.id}`,
      kind: "export",
      title:
        job.fileName ??
        `${job.mode === "accurate" ? "精准" : "快速"}导出 · ${job.sourceName ?? sourceNames.get(job.sourceId) ?? job.sourceId}`,
      subtitle: `${formatClipDateTime(job.startTime)} – ${formatClipDateTime(job.endTime)}`,
      source: job.sourceName ?? sourceNames.get(job.sourceId) ?? job.sourceId,
      status: job.status,
      statusGroup: normalizeStatus(job.status),
      statusLabel: statusLabel(job.status),
      progress: exportProgressPercent(job),
      result: job.hasGaps
        ? `包含 ${formatDuration(job.gapDurationSeconds)} 断档`
        : "视频导出",
      createdAt: job.createdAt,
      downloadUrl: job.downloadUrl,
      outputSize: job.outputSizeBytes,
      error: job.errorMessage,
      exportJob: job,
    }));

    const transcriptionRows: UnifiedTask[] = (
      transcriptionJobsQuery.data?.items ?? []
    ).map((job) => {
      const segment = segmentById.get(job.segmentId);
      return {
        id: `transcription:${job.id}`,
        kind: "transcription",
        title: `语音识别 · ${segment ? (sourceNames.get(segment.sourceId) ?? segment.filename) : job.segmentId}`,
        subtitle: segment
          ? `${formatClipDateTime(segment.startTime)} · ${formatDuration(segment.durationSeconds)}`
          : job.id,
        source: segment
          ? (sourceNames.get(segment.sourceId) ?? segment.sourceId)
          : "未知录像源",
        status: job.status,
        statusGroup: normalizeStatus(job.status),
        statusLabel: statusLabel(job.status),
        progress:
          job.status === "completed"
            ? 100
            : Math.round((job.progress ?? 0) * 100),
        progressIndeterminate:
          job.status === "processing" &&
          ["loading_model", "transcribing"].includes(job.stage),
        result:
          job.status === "completed"
            ? "字幕已生成"
            : stageLabel(job.stage) || "等待处理",
        createdAt: job.createdAt,
        segment,
        error: job.errorMessage,
        transcriptionJob: job,
      };
    });

    const visionRows: UnifiedTask[] = (visionJobsQuery.data?.items ?? []).map(
      (job) => {
        const segment = segmentById.get(job.segmentId);
        return {
          id: `vision:${job.id}`,
          kind: "vision",
          title: `视觉识别 · ${segment ? (sourceNames.get(segment.sourceId) ?? segment.filename) : job.segmentId}`,
          subtitle: segment
            ? `${formatClipDateTime(segment.startTime)} · ${formatDuration(segment.durationSeconds)}`
            : job.id,
          source: segment
            ? (sourceNames.get(segment.sourceId) ?? segment.sourceId)
            : "未知录像源",
          status: job.status,
          statusGroup: normalizeStatus(job.status),
          statusLabel: statusLabel(job.status),
          progress:
            job.status === "completed"
              ? 100
              : Math.round((job.progress ?? 0) * 100),
          progressIndeterminate:
            job.status === "processing" && job.stage === "extracting_frames",
          result:
            job.status === "completed"
              ? `${job.detectionsCount ?? 0} 个标注`
              : stageLabel(job.stage) || "等待处理",
          createdAt: job.createdAt,
          segment,
          error: job.errorMessage,
          visionJob: job,
        };
      },
    );

    const modelById = new Map(
      (modelCatalogQuery.data?.models ?? []).map((model) => [model.id, model]),
    );
    const modelRows: UnifiedTask[] = (modelJobsQuery.data?.items ?? []).map(
      (download) => {
        const model = modelById.get(download.modelId);
        const [engineId, size = ""] = download.modelId.split(":", 2);
        const engine =
          engineId === "funasr"
            ? "FunASR"
            : engineId === "sensevoice"
              ? "SenseVoice"
              : "Whisper";
        const progress =
          download.progress == null ? 0 : Math.round(download.progress * 100);
        const transferred = download.bytesDownloaded
          ? `${formatBytes(download.bytesDownloaded)}${download.totalBytes ? ` / ${formatBytes(download.totalBytes)}` : ""}`
          : "";
        return {
          id: `model:${download.modelId}`,
          kind: "model" as const,
          title: `${engine} · ${model?.name ?? size}`,
          subtitle: `${model?.size_label ?? size} 模型`,
          source: "模型缓存",
          status: download.status,
          statusGroup: normalizeStatus(download.status),
          statusLabel: statusLabel(download.status),
          progress: download.status === "completed" ? 100 : progress,
          progressIndeterminate:
            download.status === "downloading" && download.progress == null,
          result:
            download.status === "completed"
              ? `${formatBytes(model?.size_bytes || download.bytesDownloaded)} 已缓存`
              : transferred || stageLabel(download.stage) || "准备下载",
          createdAt:
            download.startedAt ??
            download.updatedAt ??
            new Date().toISOString(),
          error: download.error,
          modelId: download.modelId,
        };
      },
    );

    return [
      ...exportRows,
      ...transcriptionRows,
      ...visionRows,
      ...modelRows,
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [
    exports,
    modelCatalogQuery.data?.models,
    modelJobsQuery.data?.items,
    segmentById,
    sourceNames,
    transcriptionJobsQuery.data?.items,
    visionJobsQuery.data?.items,
  ]);

  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((task) => task.statusGroup === "active").length,
      waiting: tasks.filter((task) => task.statusGroup === "waiting").length,
      completed: tasks.filter((task) => task.statusGroup === "completed")
        .length,
      failed: tasks.filter((task) => task.statusGroup === "failed").length,
    }),
    [tasks],
  );

  const filtered = tasks.filter(
    (task) =>
      (statusFilter === "all" || task.statusGroup === statusFilter) &&
      (kindFilter === "all" || task.kind === kindFilter) &&
      `${task.title} ${task.source} ${task.subtitle}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const recognitionCompleted = tasks.filter(
    (task) =>
      (task.kind === "transcription" || task.kind === "vision") &&
      task.statusGroup === "completed",
  ).length;

  async function retryTask(task: UnifiedTask) {
    if (task.kind === "export") {
      onNotify("该任务类型暂不支持重试");
      return;
    }
    setRetryingId(task.id);
    try {
      const segmentId =
        task.segment?.id ??
        task.transcriptionJob?.segmentId ??
        task.visionJob?.segmentId;
      if (task.kind === "transcription" && segmentId)
        await api.triggerTranscription(segmentId);
      if (task.kind === "vision" && segmentId)
        await api.triggerVision(segmentId, true);
      if (task.kind === "model" && task.modelId)
        await api.downloadASRModel(task.modelId);
      onNotify("重试任务已创建");
      await queryClient.invalidateQueries({ queryKey: ["taskCenter"] });
    } catch (error) {
      onNotify(queryMessage(error, "创建重试任务失败"));
    } finally {
      setRetryingId("");
    }
  }

  async function openResult(task: UnifiedTask) {
    try {
      const id = task.transcriptionJob?.segmentId ?? task.visionJob?.segmentId;
      const segment =
        task.segment ?? (id ? toDisplaySegment(await api.segment(id)) : null);
      if (!segment) {
        onNotify("关联录像已不可用");
        return;
      }
      onSelectSegment(segment, task.kind);
    } catch (error) {
      onNotify(queryMessage(error, "无法打开录像"));
    }
  }

  return (
    <div className="redesignTaskPage">
      <header className="redesignTaskHeader">
        <div>
          <small>处理</small>
          <h1>任务</h1>
          <p>集中查看导出、语音识别、视觉识别与模型下载任务</p>
        </div>
        <div>
          <button
            type="button"
            className="taskPageSecondary"
            onClick={() =>
              void Promise.all(
                ["taskCenter", "exports"].map((key) =>
                  queryClient.invalidateQueries({ queryKey: [key] }),
                ),
              )
            }
          >
            <ArrowClockwise size={17} />
            刷新
          </button>
        </div>
      </header>

      <div className="redesignTaskTabs">
        {(
          [
            ["all", "全部"],
            ["active", "进行中"],
            ["waiting", "待处理"],
            ["completed", "已完成"],
            ["failed", "失败"],
          ] as Array<[TaskStatus, string]>
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={statusFilter === key}
            className={statusFilter === key ? "active" : ""}
            onClick={() => setStatusFilter(key)}
          >
            {label}
            <span>{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="workspaceTaskFilters">
        <input
          aria-label="搜索任务"
          placeholder="搜索任务名称或录像源…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="任务类型"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
        >
          <option value="all">全部类型</option>
          <option value="export">视频导出</option>
          <option value="transcription">语音识别</option>
          <option value="vision">视觉识别</option>
          <option value="model">模型下载</option>
        </select>
      </div>

      {(exportError ||
        transcriptionJobsQuery.error ||
        visionJobsQuery.error ||
        modelCatalogQuery.error ||
        modelJobsQuery.error) && (
        <div className="taskPageAlert" role="alert">
          <WarningCircle size={17} weight="fill" />
          <span>
            部分任务读取失败：
            {queryMessage(
              exportError ||
                transcriptionJobsQuery.error ||
                visionJobsQuery.error ||
                modelCatalogQuery.error ||
                modelJobsQuery.error,
              "请检查后端连接",
            )}
          </span>
        </div>
      )}

      <section className="redesignTaskTable" role="table" aria-label="任务列表">
        <div className="redesignTaskTableHead" role="row">
          <span role="columnheader">任务</span>
          <span role="columnheader">类型</span>
          <span role="columnheader">来源</span>
          <span role="columnheader">状态</span>
          <span role="columnheader">结果 / 进度</span>
          <span role="columnheader">操作</span>
        </div>
        {filtered.map((task) => {
          const Icon =
            task.kind === "export" || task.kind === "model"
              ? DownloadSimple
              : task.kind === "vision"
                ? Eye
                : FileText;
          return (
            <div
              className="redesignTaskRow"
              role="row"
              key={task.id}
              tabIndex={task.segment ? 0 : undefined}
              aria-label={`${task.title}，${task.statusLabel}`}
              onDoubleClick={() =>
                task.segment && onSelectSegment(task.segment)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && task.segment)
                  onSelectSegment(task.segment);
              }}
            >
              <div className="redesignTaskName" role="cell">
                <span className={`redesignTaskIcon ${task.statusGroup}`}>
                  <Icon
                    size={18}
                    weight={
                      task.statusGroup === "completed" ? "fill" : "regular"
                    }
                  />
                </span>
                <span>
                  <strong title={task.title}>{task.title}</strong>
                  <small>
                    {formatClipDateTime(task.createdAt)} · {task.subtitle}
                  </small>
                </span>
              </div>
              <span className="redesignTaskKind" role="cell">
                {task.kind === "export"
                  ? "视频导出"
                  : task.kind === "vision"
                    ? "视觉识别"
                    : task.kind === "model"
                      ? "模型下载"
                      : "语音识别"}
              </span>
              <span className="redesignTaskSource" role="cell">
                {task.source}
              </span>
              <span
                className={`redesignTaskStatus ${task.statusGroup}`}
                role="cell"
              >
                {task.statusLabel}
              </span>
              <div className="redesignTaskProgress" role="cell">
                {task.statusGroup === "failed" ? (
                  <strong
                    className="failed"
                    title={
                      task.error ??
                      (task.status === "expired"
                        ? "导出文件已过期"
                        : "任务失败")
                    }
                  >
                    {task.error ??
                      (task.status === "expired"
                        ? "导出文件已过期"
                        : "任务失败")}
                  </strong>
                ) : task.downloadUrl ? (
                  <a href={task.downloadUrl}>
                    <DownloadSimple size={14} />
                    下载
                    {task.outputSize
                      ? ` · ${formatBytes(task.outputSize)}`
                      : ""}
                  </a>
                ) : task.kind === "export" &&
                  task.statusGroup === "completed" ? (
                  <strong className="failed">
                    下载不可用，服务端暂存文件可能已清理
                  </strong>
                ) : task.statusGroup === "completed" ? (
                  <span className="workspaceTaskDone">
                    <CheckCircle size={14} />
                    {task.result}
                  </span>
                ) : (
                  <>
                    <div
                      className={
                        task.progressIndeterminate ? "indeterminate" : ""
                      }
                      role="progressbar"
                      aria-label={`${task.title}进度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={
                        task.progressIndeterminate ? undefined : task.progress
                      }
                    >
                      <span
                        style={{
                          width: task.progressIndeterminate
                            ? "35%"
                            : `${task.progress}%`,
                        }}
                      />
                    </div>
                    <em>
                      {task.result}
                      {!task.progressIndeterminate
                        ? ` · ${task.progress}%`
                        : ""}
                    </em>
                  </>
                )}
              </div>
              <div className="redesignTaskActions" role="cell">
                {task.statusGroup === "failed" && task.kind !== "export" ? (
                  <button
                    type="button"
                    title="重试任务"
                    disabled={retryingId === task.id}
                    onClick={() => void retryTask(task)}
                  >
                    <ArrowClockwise size={14} />
                    重试
                  </button>
                ) : (task.kind === "transcription" || task.kind === "vision") &&
                  task.statusGroup === "completed" ? (
                  <button type="button" onClick={() => void openResult(task)}>
                    查看结果
                  </button>
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
          );
        })}
        {!filtered.length && (
          <div className="redesignTaskEmpty">
            <SpinnerGap size={31} />
            <strong>没有匹配的任务</strong>
            <span>切换筛选条件或在回看、片段库中创建新任务。</span>
          </div>
        )}
      </section>

      <div className="redesignTaskSummary">
        <section>
          <span className="blue">
            <SpinnerGap size={22} />
          </span>
          <div>
            <small>处理中</small>
            <strong>{counts.active} 个任务</strong>
            <p>{counts.waiting} 个任务正在等待调度</p>
          </div>
        </section>
        <section>
          <span className="green">
            <CheckCircle size={22} />
          </span>
          <div>
            <small>识别完成</small>
            <strong>{recognitionCompleted} 个任务</strong>
            <p>语音与视觉结果可在片段详情查看</p>
          </div>
        </section>
        <section>
          <span className="purple">
            <WarningCircle size={22} />
          </span>
          <div>
            <small>需要处理</small>
            <strong>{counts.failed} 个失败</strong>
            <p>可重试识别任务，导出失败请重新创建</p>
          </div>
        </section>
      </div>
    </div>
  );
}
