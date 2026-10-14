import {
  CaretRight,
  CheckCircle,
  DownloadSimple,
  FilmStrip,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { api } from "../../api";
import {
  type DisplaySegment,
  formatDuration,
  formatTime,
  queryMessage,
} from "../../utils";
import { useDialogFocus } from "../shared/useDialogFocus";
import { rangeCoverage } from "./PlaybackTimeline";

export type ExportSelection = {
  sourceId: string;
  startMs: number;
  endMs: number;
  segmentIds?: string[];
};
type ExportPayload = Parameters<typeof api.createExport>[0];
export function RecordingExportDialog({
  selection,
  segments,
  sourceName,
  onClose,
  onCreate,
  onTasks,
}: {
  selection: ExportSelection;
  segments: DisplaySegment[];
  sourceName: string;
  onClose: () => void;
  onCreate: (payload: ExportPayload) => Promise<void>;
  onTasks: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, true, onClose);
  const [mode, setMode] = useState<"fast" | "accurate">("fast");
  const [filename, setFilename] = useState(
    () =>
      `${sourceName}_${new Date(selection.startMs).toLocaleDateString("sv-SE").replaceAll("-", "")}_${formatTime(new Date(selection.startMs).toISOString()).replaceAll(":", "")}-${formatTime(new Date(selection.endMs).toISOString()).replaceAll(":", "")}`,
  );
  const [state, setState] = useState<"idle" | "creating" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const available = useMemo(
    () => segments.filter((item) => item.sourceId === selection.sourceId),
    [segments, selection.sourceId],
  );
  const selected = useMemo(
    () =>
      available.filter(
        (item) =>
          !selection.segmentIds || selection.segmentIds.includes(item.id),
      ),
    [available, selection.segmentIds],
  );
  const actual = rangeCoverage(selected, selection.startMs, selection.endMs);
  const indexed = rangeCoverage(available, selection.startMs, selection.endMs);
  const missing = Math.max(
    0,
    (selection.endMs - selection.startMs) / 1000 - indexed.seconds,
  );
  const omitted = Math.max(0, indexed.seconds - actual.seconds);
  const preview = selected.find(
    (item) =>
      new Date(item.endTime).getTime() > selection.startMs &&
      new Date(item.startTime).getTime() < selection.endMs,
  );
  useEffect(() => {
    if (state === "done") ref.current?.querySelector("button")?.focus();
  }, [state]);
  async function create() {
    if (!filename.trim()) {
      setError("请输入文件名称");
      setState("error");
      return;
    }
    if (/[\\/<>:"|?*\u0000-\u001f]/.test(filename)) {
      setError("文件名称不能包含路径或特殊字符");
      setState("error");
      return;
    }
    setState("creating");
    setError("");
    try {
      await onCreate({
        sourceId: selection.sourceId,
        startTime: new Date(selection.startMs).toISOString(),
        endTime: new Date(selection.endMs).toISOString(),
        mode,
        fileName: `${filename.replace(/\.mp4$/i, "").trim()}.mp4`,
        segmentIds: selection.segmentIds,
      });
      setState("done");
    } catch (reason) {
      setError(queryMessage(reason, "创建导出任务失败"));
      setState("error");
    }
  }
  return (
    <div
      className="workModalBackdrop"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        ref={ref}
        className="workExportDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workExportTitle"
        tabIndex={-1}
      >
        {state === "done" ? (
          <div className="workExportSuccess">
            <CheckCircle size={54} weight="fill" />
            <h2 id="workExportTitle">导出任务已创建</h2>
            <p>继续整理你的录像，任务会在后台处理。</p>
            <button className="workButton primary" onClick={onTasks}>
              查看任务
              <CaretRight size={16} />
            </button>
            <button className="workButton" onClick={onClose}>
              继续浏览
            </button>
          </div>
        ) : (
          <>
            <header>
              <div>
                <small>导出片段</small>
                <h2 id="workExportTitle">留住这段录像</h2>
                <p>将选中的内容导出为一个视频文件。</p>
              </div>
              <button
                className="workIconButton"
                aria-label="关闭导出"
                onClick={onClose}
              >
                <X size={20} />
              </button>
            </header>
            <div className="workExportPreview">
              {preview?.thumbnailUrl ? (
                <img src={preview.thumbnailUrl} alt="所选录像画面" />
              ) : (
                <FilmStrip size={30} />
              )}
              <div>
                <span>
                  {sourceName} ·{" "}
                  {new Date(selection.startMs).toLocaleDateString("sv-SE")}
                </span>
                <strong>
                  {formatTime(new Date(selection.startMs).toISOString())} –{" "}
                  {formatTime(new Date(selection.endMs).toISOString())}
                </strong>
                <small>
                  {actual.count} 个片段 · 实际录像{" "}
                  {formatDuration(actual.seconds)}
                </small>
              </div>
            </div>
            <label className="workExportName">
              文件名称
              <div>
                <input
                  aria-label="导出文件名称"
                  value={filename}
                  maxLength={170}
                  onChange={(event) => setFilename(event.target.value)}
                />
                <span>.mp4</span>
              </div>
            </label>
            <fieldset className="workExportModes">
              <legend>导出方式</legend>
              <button
                aria-pressed={mode === "fast"}
                className={mode === "fast" ? "active" : ""}
                onClick={() => setMode("fast")}
              >
                <i />
                <div>
                  <strong>快速导出</strong>
                  <span>保留原画质，起止时间贴近关键帧</span>
                </div>
                <em>推荐</em>
              </button>
              <button
                aria-pressed={mode === "accurate"}
                className={mode === "accurate" ? "active" : ""}
                onClick={() => setMode("accurate")}
              >
                <i />
                <div>
                  <strong>精准导出</strong>
                  <span>精确到所选时间，需要重新编码</span>
                </div>
              </button>
            </fieldset>
            {missing + omitted > 0.01 && (
              <p className="workExportNotice">
                <WarningCircle size={17} />
                <span>
                  {missing > 0.01 &&
                    `范围内有 ${formatDuration(missing)} 无录像断档。`}
                  {omitted > 0.01 &&
                    `有 ${formatDuration(omitted)} 录像未被选中。`}
                  导出会跳过这些区间，仅保留所选的实际录像。
                </span>
              </p>
            )}
            {error && (
              <p className="workInlineError" role="alert">
                {error}
              </p>
            )}
            <footer>
              <span>
                <CheckCircle size={14} />
                原始录像保持不变
              </span>
              <button
                className="workButton primary"
                disabled={state === "creating" || !actual.count}
                onClick={() => void create()}
              >
                {state === "creating" ? (
                  <SpinnerGap size={17} className="spinning" />
                ) : (
                  <DownloadSimple size={17} />
                )}
                {state === "creating" ? "正在创建…" : "创建导出任务"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
