import {
  CheckCircle,
  DownloadSimple,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import {
  type DisplaySegment,
  formatDuration,
  formatTime,
  queryMessage,
} from "../../utils";
import { rangeCoverage, TimeEditor } from "./PlaybackTimeline";
import type { RecordingRange } from "./VerticalPlaybackTimeline";

export function RecordingRangePanel({
  sourceId,
  sourceName,
  date,
  range,
  segments,
  currentTimeMs,
  onChange,
  onBusyChange,
  onClose,
  onNotify,
}: {
  sourceId: string;
  sourceName: string;
  date: string;
  range: RecordingRange;
  segments: DisplaySegment[];
  currentTimeMs: number | null;
  onChange: (range: RecordingRange) => void;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onNotify: (text: string) => void;
}) {
  const client = useQueryClient();
  const [mode, setMode] = useState<"fast" | "accurate">("accurate");
  const [filename, setFilename] = useState("");
  const [jobId, setJobId] = useState("");
  const coverage = rangeCoverage(segments, range.startMs, range.endMs);
  const gap = Math.max(
    0,
    (range.endMs - range.startMs) / 1000 - coverage.seconds,
  );
  const job = useQuery({
    queryKey: ["rangeExport", jobId],
    queryFn: () => api.exportJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (q) =>
      ["completed", "failed"].includes(q.state.data?.status ?? "")
        ? false
        : 1000,
  });
  const create = useMutation({
    mutationFn: () =>
      api.createExport({
        sourceId,
        startTime: new Date(range.startMs).toISOString(),
        endTime: new Date(range.endMs).toISOString(),
        mode,
        fileName:
          filename.trim() ||
          `${sourceName}_${date}_${formatTime(new Date(range.startMs).toISOString()).replaceAll(":", "")}`,
      }),
    onSuccess: (result) => {
      setJobId(result.exportId);
      void client.invalidateQueries({ queryKey: ["exports"] });
    },
    onError: (error) => onNotify(queryMessage(error, "创建下载任务失败")),
  });
  const busy =
    create.isPending ||
    Boolean(
      jobId &&
      !["completed", "failed"].includes(job.data?.status ?? "") &&
      !job.isError,
    );
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const previousRange = useRef(`${range.startMs}:${range.endMs}`);
  useEffect(() => {
    const key = `${range.startMs}:${range.endMs}`;
    if (previousRange.current !== key) {
      previousRange.current = key;
      setJobId("");
    }
  }, [range.startMs, range.endMs]);
  function change(key: "startMs" | "endMs", value: number) {
    if (
      (key === "startMs" && value >= range.endMs) ||
      (key === "endMs" && value <= range.startMs)
    ) {
      onNotify("开始时间必须早于结束时间");
      return false;
    }
    onChange({ ...range, [key]: value });
    return true;
  }
  return (
    <aside className="monitorRangePanel" aria-label="管理片段">
      <header>
        <h2>管理片段</h2>
        <button
          className="workIconButton"
          aria-label="关闭区间管理"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <p className="monitorPanelHint">拖动时间轴的边界，或输入起止时间。</p>
      <div className="monitorRangeTimes">
        <label>
          开始
          <TimeEditor
            label="截取起点"
            disabled={busy}
            date={date}
            value={range.startMs}
            onCommit={(value) => change("startMs", value)}
            onNotify={onNotify}
          />
          <button
            disabled={busy || currentTimeMs === null}
            onClick={() =>
              currentTimeMs !== null && change("startMs", currentTimeMs)
            }
          >
            设为当前播放时间
          </button>
        </label>
        <label>
          结束
          <TimeEditor
            label="截取终点"
            disabled={busy}
            date={date}
            value={range.endMs}
            onCommit={(value) => change("endMs", value)}
            onNotify={onNotify}
          />
          <button
            disabled={busy || currentTimeMs === null}
            onClick={() =>
              currentTimeMs !== null && change("endMs", currentTimeMs)
            }
          >
            设为当前播放时间
          </button>
        </label>
      </div>
      <dl>
        <div>
          <dt>录像源</dt>
          <dd>{sourceName}</dd>
        </div>
        <div>
          <dt>日期</dt>
          <dd>{date}</dd>
        </div>
        <div>
          <dt>选取时长</dt>
          <dd>{formatDuration((range.endMs - range.startMs) / 1000)}</dd>
        </div>
        <div>
          <dt>实际录像</dt>
          <dd>
            {formatDuration(coverage.seconds)} · {coverage.count} 段
          </dd>
        </div>
      </dl>
      {(!coverage.count || gap > 1) && (
        <p className="monitorRangeWarning">
          <WarningCircle size={16} />
          {coverage.count
            ? `包含 ${formatDuration(gap)} 断档，下载将跳过。`
            : "所选范围内没有可用录像。"}
        </p>
      )}
      <fieldset disabled={busy || job.data?.status === 'completed'} className="monitorDownloadOptions">
        <legend>下载方式</legend>
        <label>
          <input
            type="radio"
            name="rangeMode"
            checked={mode === "accurate"}
            onChange={() => setMode("accurate")}
          />
          <span>
            精准下载<small>按所选时间裁剪，兼容浏览器播放</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="rangeMode"
            checked={mode === "fast"}
            onChange={() => setMode("fast")}
          />
          <span>
            快速下载<small>保留原编码，边界贴近关键帧</small>
          </span>
        </label>
        <label className="monitorFilename">
          文件名称
          <input
            aria-label="下载文件名称"
            maxLength={170}
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="自动生成名称"
          />
        </label>
      </fieldset>
      <p className="monitorOriginalNote">只生成副本，不修改原始录像。</p>
      {(create.isError || job.isError || job.data?.status === "failed") && (
        <p role="alert" className="workInlineError">
          {job.data?.errorMessage ||
            queryMessage(create.error || job.error, "下载处理失败，请重试")}
        </p>
      )}
      <div className="monitorDownloadActions">
        {job.data?.status === "completed" && job.data.downloadUrl ? (
          <>
            <p role="status">
              <CheckCircle size={17} />
              文件已就绪
            </p>
            <a
              className="workButton primary"
              href={job.data.downloadUrl}
              download
            >
              <DownloadSimple size={16} />
              下载文件
            </a>
            <button className="workButton" onClick={() => setJobId("")}>
              重新选取
            </button>
          </>
        ) : (
          <button
            className="workButton primary"
            disabled={busy || !coverage.count}
            onClick={() => create.mutate()}
          >
            {busy ? (
              <SpinnerGap className="spinning" size={16} />
            ) : (
              <DownloadSimple size={16} />
            )}{" "}
            {busy
              ? `正在处理 ${Math.round((job.data?.progress ?? 0) * 100)}%`
              : "下载"}
          </button>
        )}
        <button disabled={busy} className="workButton" onClick={onClose}>
          取消
        </button>
      </div>
    </aside>
  );
}
