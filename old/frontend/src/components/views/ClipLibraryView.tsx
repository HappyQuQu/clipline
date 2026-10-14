import {
  CalendarBlank,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  DownloadSimple,
  Eye,
  FileText,
  FilmStrip,
  HashStraight,
  ListBullets,
  MagnifyingGlass,
  Microphone,
  Play,
  SquaresFour,
  Tag,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../../api";
import type { SearchResult, VisionDetection } from "../../types";
import type { DisplaySegment } from "../../utils";
import { formatTime } from "../../utils";

function formatOffset(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatHourMinute(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatFullDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function ClipLibraryView({
  segments,
  sourceNames,
  selectedId,
  onOpenPlayback,
  onExportSegments,
  onNotify,
}: {
  segments: DisplaySegment[];
  sourceNames: Map<string, string>;
  selectedId?: string;
  onOpenPlayback: (segment: DisplaySegment) => void;
  onExportSegments: (segments: DisplaySegment[]) => void;
  onNotify: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const sortedSegments = useMemo(
    () =>
      [...segments].sort(
        (left, right) =>
          new Date(right.startTime).getTime() -
          new Date(left.startTime).getTime(),
      ),
    [segments],
  );
  const [selectedClipId, setSelectedClipId] = useState(selectedId ?? "");
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [overlays, setOverlays] = useState({ camera: true, time: true, status: true, duration: true });
  const [sourceFilter, setSourceFilter] = useState("");
  const [recognitionFilter, setRecognitionFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [inspectorHidden, setInspectorHidden] = useState(true);
  const inspectorTrigger = useRef<HTMLButtonElement | null>(null);
  function closeInspector() {
    setInspectorHidden(true);
    inspectorTrigger.current?.focus();
  }
  const [speechQuery, setSpeechQuery] = useState("");
  const sourceId = sourceFilter || undefined;

  const speech = speechQuery.trim();
  const transcriptionJobsQuery = useQuery({
    queryKey: ["clipLibraryTranscriptionJobs"],
    queryFn: () => api.getTranscriptionJobs(),
    refetchInterval: 3000,
  });
  const transcriptionStatusBySegment = useMemo(() => {
    const result = new Map<string, string>();
    for (const job of transcriptionJobsQuery.data?.items ?? []) {
      if (!result.has(job.segmentId)) result.set(job.segmentId, job.status);
    }
    return result;
  }, [transcriptionJobsQuery.data?.items]);
  const speechSearchQuery = useQuery({
    queryKey: ["clipLibrarySpeechSearch", speech, startDate, endDate],
    queryFn: () =>
      api.search({
        q: speech,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit: 200,
      }),
    enabled: speech.length > 0,
  });

  const speechMatches = useMemo(() => {
    const matches = new Map<string, SearchResult>();
    for (const item of speechSearchQuery.data?.items ?? []) {
      if (!matches.has(item.segmentId)) matches.set(item.segmentId, item);
    }
    return matches;
  }, [speechSearchQuery.data?.items]);

  const visionDetectionsQuery = useQuery({
    queryKey: ["clipLibraryVisionDetections", sourceId, startDate, endDate],
    queryFn: () =>
      api.listVisionDetections({
        sourceId,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit: 5000,
      }),
    enabled: segments.length > 0,
    refetchInterval: 5000,
  });

  const detectionsBySegment = useMemo(() => {
    const grouped = new Map<string, VisionDetection[]>();
    for (const item of visionDetectionsQuery.data?.items ?? []) {
      grouped.set(item.segmentId, [
        ...(grouped.get(item.segmentId) ?? []),
        item,
      ]);
    }
    return grouped;
  }, [visionDetectionsQuery.data?.items]);

  const filtered = useMemo(() => {
    const startMs = startDate
      ? new Date(`${startDate}T00:00:00`).getTime()
      : Number.NEGATIVE_INFINITY;
    const endMs = endDate
      ? new Date(`${endDate}T23:59:59`).getTime()
      : Number.POSITIVE_INFINITY;
    return sortedSegments.filter((segment) => {
      const clipMs = new Date(segment.startTime).getTime();
      if (clipMs < startMs || clipMs > endMs) return false;
      if (sourceFilter && segment.sourceId !== sourceFilter) return false;
      if (speech) {
        const query = speech.toLocaleLowerCase();
        const localText = [
          segment.filename,
          formatTime(segment.startTime),
          formatTime(segment.endTime),
          sourceNames.get(segment.sourceId),
          ...(detectionsBySegment.get(segment.id) ?? []).flatMap((item) => [
            item.label,
            item.labelName,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!speechMatches.has(segment.id) && !localText.includes(query))
          return false;
      }
      const recognitionStatus = transcriptionStatusBySegment.get(segment.id);
      if (
        tagFilter &&
        !(detectionsBySegment.get(segment.id) ?? []).some(
          (item) => item.labelName === tagFilter,
        )
      )
        return false;
      if (
        recognitionFilter === "completed" &&
        recognitionStatus !== "completed" &&
        !detectionsBySegment.get(segment.id)?.length
      )
        return false;
      if (
        recognitionFilter === "processing" &&
        recognitionStatus !== "pending" &&
        recognitionStatus !== "processing"
      )
        return false;
      if (
        recognitionFilter === "none" &&
        (recognitionStatus || detectionsBySegment.get(segment.id)?.length)
      )
        return false;
      if (recognitionFilter === "failed" && recognitionStatus !== "failed")
        return false;
      return true;
    });
  }, [
    detectionsBySegment,
    endDate,
    recognitionFilter,
    sortedSegments,
    sourceFilter,
    sourceNames,
    speech,
    speechMatches,
    startDate,
    tagFilter,
    transcriptionStatusBySegment,
  ]);

  const selectedSegment = inspectorHidden
    ? undefined
    : (filtered.find((segment) => segment.id === selectedClipId) ??
      filtered[0]);
  const selectedTranscriptionQuery = useQuery({
    queryKey: ["clipLibraryTranscription", selectedSegment?.id],
    queryFn: () => api.getTranscription(selectedSegment!.id),
    enabled: Boolean(selectedSegment),
    refetchInterval:
      selectedSegment &&
      ["pending", "processing"].includes(
        transcriptionStatusBySegment.get(selectedSegment.id) ?? "",
      )
        ? 2500
        : false,
  });
  const selectedTranscriptions = selectedTranscriptionQuery.data?.items ?? [];
  const selectedDetectionsQuery = useQuery({
    queryKey: ["clipLibrarySegmentVision", selectedSegment?.id],
    queryFn: () => api.getVisionDetections(selectedSegment!.id),
    enabled: Boolean(selectedSegment),
    refetchInterval: selectedSegment ? 3000 : false,
  });
  const selectedVisionStatusQuery = useQuery({
    queryKey: ["clipLibrarySegmentVisionStatus", selectedSegment?.id],
    queryFn: () => api.getVisionStatus(selectedSegment!.id),
    enabled: Boolean(selectedSegment),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 2500 : false;
    },
  });
  const selectedDetections = selectedDetectionsQuery.data?.items ?? [];
  const selectedDetectionSummary = useMemo(() => {
    const grouped = new Map<
      string,
      { label: string; labelName: string; count: number; confidence: number }
    >();
    for (const item of selectedDetections) {
      const current = grouped.get(item.label);
      if (!current) {
        grouped.set(item.label, {
          label: item.label,
          labelName: item.labelName,
          count: 1,
          confidence: item.confidence,
        });
        continue;
      }
      current.count += 1;
      current.confidence = Math.max(current.confidence, item.confidence);
    }
    return Array.from(grouped.values()).sort(
      (left, right) => right.confidence - left.confidence,
    );
  }, [selectedDetections]);
  const triggerVisionMutation = useMutation({
    mutationFn: ({ segmentId, force }: { segmentId: string; force: boolean }) =>
      api.triggerVision(segmentId, force),
    onSuccess: async (_job, variables) => {
      onNotify(
        variables.force
          ? "视觉重新识别任务已创建，将覆盖旧结果"
          : "视觉识别任务已创建",
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["clipLibrarySegmentVisionStatus"],
        }),
        queryClient.invalidateQueries({ queryKey: ["visionLabels"] }),
        queryClient.invalidateQueries({
          queryKey: ["clipLibraryVisionDetections"],
        }),
      ]);
    },
    onError: (error) =>
      onNotify(error instanceof Error ? error.message : "创建视觉识别任务失败"),
  });
  const triggerTranscriptionMutation = useMutation({
    mutationFn: async ({
      segmentId,
      reset,
    }: {
      segmentId: string;
      reset: boolean;
    }) => {
      if (reset) await api.deleteTranscription(segmentId);
      return api.triggerTranscription(segmentId);
    },
    onSuccess: async (_job, variables) => {
      onNotify(
        variables.reset
          ? "语音重新识别任务已创建，将覆盖旧字幕"
          : "语音识别任务已创建",
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["clipLibraryTranscription"],
        }),
        queryClient.invalidateQueries({ queryKey: ["transcription"] }),
      ]);
    },
    onError: (error) =>
      onNotify(error instanceof Error ? error.message : "创建语音识别任务失败"),
  });

  const hasVisionResults = selectedDetectionSummary.length > 0;
  const hasTranscriptionResults = selectedTranscriptions.length > 0;

  function toggleClipSelection(segmentId: string) {
    setSelectedClipIds((current) =>
      current.includes(segmentId)
        ? current.filter((id) => id !== segmentId)
        : [...current, segmentId],
    );
  }

  function recognitionLabel(segmentId: string) {
    const status = transcriptionStatusBySegment.get(segmentId);
    if (status === "completed") return "已识别";
    if (status === "processing") return "识别中";
    if (status === "pending") return "等待识别";
    if (status === "failed") return "识别失败";
    if (detectionsBySegment.get(segmentId)?.length) return "视觉完成";
    return "未识别";
  }

  async function transcribeSelected() {
    const targets = sortedSegments.filter((segment) =>
      selectedClipIds.includes(segment.id),
    );
    if (!targets.length) return;
    const results = await Promise.allSettled(
      targets.map((segment) => api.triggerTranscription(segment.id)),
    );
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    onNotify(
      failed
        ? `已创建 ${targets.length - failed} 个识别任务，${failed} 个失败`
        : `已创建 ${targets.length} 个语音识别任务`,
    );
    void queryClient.invalidateQueries({
      queryKey: ["clipLibraryTranscriptionJobs"],
    });
  }

  async function detectSelected() {
    const targets = sortedSegments.filter((segment) =>
      selectedClipIds.includes(segment.id),
    );
    if (!targets.length) return;
    const results = await Promise.allSettled(
      targets.map((segment) => api.triggerVision(segment.id, false)),
    );
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    onNotify(
      failed
        ? `已创建 ${targets.length - failed} 个视觉识别任务，${failed} 个失败`
        : `已创建 ${targets.length} 个视觉识别任务`,
    );
    void queryClient.invalidateQueries({
      queryKey: ["clipLibraryVisionDetections"],
    });
  }

  const selectedSegments = sortedSegments.filter((segment) =>
    selectedClipIds.includes(segment.id),
  );
  const availableTags = Array.from(
    new Set(
      Array.from(detectionsBySegment.values()).flatMap((items) =>
        items.map((item) => item.labelName),
      ),
    ),
  ).slice(0, 10);

  return (
    <div className={`redesignLibraryPage monitorLibrary density-${density}${inspectorHidden ? ' inspectorClosed' : ''}`} data-camera={overlays.camera} data-time={overlays.time} data-status={overlays.status} data-duration={overlays.duration}>
      <header className="redesignLibraryHeader">
        <div>
          <h1>片段库</h1>
          <p>按画面、时间和识别结果查找录像</p>
        </div>
        <div className="libraryHeadingCount">
          <FilmStrip size={18} />
          <strong>{segments.length.toLocaleString()}</strong> 个已加载片段
        </div>
      </header>

      <aside className="monitorLibraryFilters" aria-label="片段筛选">
      <header><strong>筛选录像</strong><button onClick={()=>{setSourceFilter('');setRecognitionFilter('all');setStartDate('');setEndDate('');setTagFilter('');setSpeechQuery('');}}>清除</button></header>
      <div className="redesignLibraryToolbar">
        <label className="libraryInlineSearch">
          <MagnifyingGlass size={17} />
          <input
            aria-label="搜索片段"
            value={speechQuery}
            onChange={(event) => setSpeechQuery(event.target.value)}
            placeholder="搜索时间、标签或字幕…"
          />
          {speech && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => setSpeechQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <select
          aria-label="按录像源筛选"
          className="librarySourceFilter"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
        >
          <option value="">全部录像源</option>
          {Array.from(sourceNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="按识别状态筛选"
          className="libraryRecognitionFilter"
          value={recognitionFilter}
          onChange={(event) => setRecognitionFilter(event.target.value)}
        >
          <option value="all">全部识别状态</option>
          <option value="completed">已有识别结果</option>
          <option value="processing">识别中</option>
          <option value="none">未识别</option>
          <option value="failed">识别失败</option>
        </select>
        <label className="libraryDate">
          <CalendarBlank size={16} />
          <input
            aria-label="片段日期"
            type="date"
            value={endDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setEndDate(event.target.value);
            }}
          />
        </label>
      </div>

      <div className="libraryMetaRow">
        <div className="libraryTagFilters">
          <span>画面标签</span>
          <button
            className={!tagFilter ? "active" : ""}
            onClick={() => setTagFilter("")}
          >
            全部
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              className={tagFilter === tag ? "active" : ""}
              onClick={() => setTagFilter(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        <span>{filtered.length} 个片段</span>
        <div className="libraryViewSwitch">
          <button
            type="button"
            aria-label="网格视图"
            aria-pressed={viewMode === "grid"}
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => setViewMode("grid")}
          >
            <SquaresFour size={18} />
          </button>
          <button
            type="button"
            aria-label="列表视图"
            aria-pressed={viewMode === "list"}
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
          >
            <ListBullets size={18} />
          </button>
        </div>
      </div>
      <fieldset className="monitorOverlayOptions">
        <legend>画面信息</legend>
        {([
          ['camera', '摄像头'], ['time', '时间'], ['status', '识别状态'], ['duration', '时长'],
        ] as const).map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={overlays[key]} onChange={(event) => setOverlays((current) => ({ ...current, [key]: event.target.checked }))} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="monitorGridDensity">
        网格密度
        <select aria-label="网格密度" disabled={viewMode !== 'grid'} value={density} onChange={(event) => setDensity(event.target.value as typeof density)}>
          <option value="compact">紧凑</option>
          <option value="comfortable">宽松</option>
        </select>
      </label>
      <p className="monitorFilterNote">画面标签来自实际识别结果，未识别的录像也会保留在片段库中。</p>
      </aside>
      {speech && speechSearchQuery.isError && (
        <p className="workInlineError" role="alert">
          字幕搜索暂时不可用，当前仅显示本地文件名和标签匹配。
        </p>
      )}

      <div className="redesignLibraryContent">
        <main
          className={
            viewMode === "grid" ? "redesignLibraryGrid" : "redesignLibraryList"
          }
        >
          {filtered.map((segment) => {
            const detections = detectionsBySegment.get(segment.id) ?? [];
            const transcriptHit = speech
              ? speechMatches.get(segment.id)?.transcription
              : null;
            const checked = selectedClipIds.includes(segment.id);
            return (
              <article
                key={segment.id}
                className={`redesignLibraryCard${selectedSegment?.id === segment.id ? " active" : ""}`}
              >
                <button
                  className="libraryCardOpen"
                  aria-label={`查看 ${sourceNames.get(segment.sourceId) ?? "录像源"} ${formatTime(segment.startTime)} 的片段详情`}
                  onClick={(event) => {
                    inspectorTrigger.current = event.currentTarget;
                    setSelectedClipId(segment.id);
                    setInspectorHidden(false);
                  }}
                >
                  <div className="redesignLibraryImage">
                    {segment.thumbnailUrl ? (
                      <img
                        src={segment.thumbnailUrl}
                        alt={`${formatTime(segment.startTime)} 录像画面`}
                        loading="lazy"
                      />
                    ) : (
                      <span className="libraryImageEmpty">
                        <FilmStrip size={28} />
                      </span>
                    )}
                    <time>{formatOffset(segment.durationSeconds)}</time>
                    {(overlays.camera || overlays.time) && <span className="monitorCardLabel">{overlays.camera && <span>{sourceNames.get(segment.sourceId) ?? '录像源'}</span>}{overlays.time && <small>{new Date(segment.startTime).toLocaleDateString('zh-CN', {month:'short',day:'numeric'})} · {formatTime(segment.startTime)}</small>}</span>}
                  </div>
                  <div className="redesignLibraryCardCopy">
                    <div>
                      <strong>
                        {formatHourMinute(segment.startTime)}
                        <small>
                          {sourceNames.get(segment.sourceId) ?? "录像源"}
                        </small>
                      </strong>
                      <p>
                        {formatTime(segment.startTime)} –{" "}
                        {formatTime(segment.endTime)}
                      </p>
                      {transcriptHit && (
                        <p className="clipSpeechHit">
                          {formatOffset(transcriptHit.startTime)}{" "}
                          {transcriptHit.text}
                        </p>
                      )}
                    </div>
                    <span
                      className={`libraryRecognitionStatus ${transcriptionStatusBySegment.get(segment.id) ?? "none"}`}
                    >
                      {recognitionLabel(segment.id)}
                    </span>
                  </div>
                  <div className="redesignLibraryTags">
                    {Array.from(
                      new Set(detections.map((item) => item.labelName)),
                    )
                      .slice(0, 3)
                      .map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    <time>
                      {new Date(segment.startTime).toLocaleDateString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </time>
                  </div>
                </button>
                <button
                  type="button"
                  aria-pressed={checked}
                  aria-label={`${checked ? "取消选择" : "选择"} ${formatTime(segment.startTime)} 片段`}
                  className={`librarySelectCheck${checked ? " checked" : ""}`}
                  onClick={() => toggleClipSelection(segment.id)}
                >
                  {checked && <Check size={13} weight="bold" />}
                </button>
              </article>
            );
          })}
          {!filtered.length && (
            <div className="redesignLibraryEmpty">
              <FilmStrip size={34} />
              <strong>
                {speech && speechSearchQuery.isFetching
                  ? "正在搜索字幕…"
                  : speech
                    ? "没有匹配的片段"
                    : "当前筛选范围内没有片段"}
              </strong>
              <span>调整筛选条件或扫描录像目录后再试。</span>
            </div>
          )}
        </main>

        {!inspectorHidden && <aside className="redesignLibraryInspector" aria-label="片段详情" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeInspector(); } }}>
          {selectedSegment ? (
            <>
              <header>
                <div>
                  <small>片段详情</small>
                  <h2>
                    {sourceNames.get(selectedSegment.sourceId) ?? "录像源"} ·{" "}
                    {formatHourMinute(selectedSegment.startTime)}
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="关闭详情"
                  autoFocus
                  onClick={closeInspector}
                >
                  <X size={18} />
                </button>
              </header>
              <button
                type="button"
                className="libraryDetailPreview"
                aria-label="打开当前片段回看"
                onClick={() => onOpenPlayback(selectedSegment)}
              >
                {selectedSegment.thumbnailUrl ? (
                  <img src={selectedSegment.thumbnailUrl} alt="片段预览" />
                ) : (
                  <FilmStrip size={32} />
                )}
                <span>
                  <Play size={18} weight="fill" />
                </span>
              </button>
              <dl>
                <div>
                  <dt>录像源</dt>
                  <dd>
                    {sourceNames.get(selectedSegment.sourceId) ?? "录像源"}
                  </dd>
                </div>
                <div>
                  <dt>日期</dt>
                  <dd>{formatFullDate(selectedSegment.startTime)}</dd>
                </div>
                <div>
                  <dt>时长</dt>
                  <dd>{formatOffset(selectedSegment.durationSeconds)}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>{recognitionLabel(selectedSegment.id)}</dd>
                </div>
                <div>
                  <dt>标签</dt>
                  <dd>
                    {selectedDetectionSummary.length
                      ? selectedDetectionSummary.slice(0, 2).map((item) => (
                          <span className="libraryTag" key={item.label}>
                            {item.labelName}
                          </span>
                        ))
                      : "暂无标签"}
                  </dd>
                </div>
              </dl>
              <div className="libraryRecognitionActions">
                <button
                  type="button"
                  onClick={() =>
                    triggerTranscriptionMutation.mutate({
                      segmentId: selectedSegment.id,
                      reset: hasTranscriptionResults,
                    })
                  }
                >
                  <Microphone size={16} />
                  {hasTranscriptionResults ? "重新识别" : "识别字幕"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerVisionMutation.mutate({
                      segmentId: selectedSegment.id,
                      force: hasVisionResults,
                    })
                  }
                >
                  <Eye size={16} />
                  视觉识别
                </button>
              </div>
              <button
                type="button"
                className="libraryPrimary full"
                onClick={() => onExportSegments([selectedSegment])}
              >
                <DownloadSimple size={17} />
                导出当前片段
              </button>
              {selectedTranscriptions.length > 0 && (
                <section className="libraryTranscriptPreview">
                  <strong>
                    <FileText size={15} />
                    字幕预览
                  </strong>
                  {selectedTranscriptions.slice(0, 3).map((line) => (
                    <p key={line.id}>
                      <time>{formatOffset(line.startTime)}</time>
                      {line.text}
                      <CaretRight size={13} />
                    </p>
                  ))}
                </section>
              )}
            </>
          ) : (
            <div className="redesignLibraryInspectorEmpty">
              <FilmStrip size={30} />
              <strong>选择片段查看详情</strong>
              <span>可预览、识别或导出当前片段。</span>
            </div>
          )}
        </aside>}
      </div>

      {selectedSegments.length > 0 && (
        <div
          className="redesignSelectionBar"
          role="region"
          aria-label="批量操作"
        >
          <span aria-live="polite">
            <CheckCircle size={19} weight="fill" />
            已选 {selectedSegments.length} 个片段
          </span>
          <button type="button" onClick={() => setSelectedClipIds([])}>
            取消选择
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void transcribeSelected()}
          >
            <Microphone size={16} />
            识别字幕
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void detectSelected()}
          >
            <Eye size={16} />
            识别画面
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onExportSegments(selectedSegments)}
          >
            <DownloadSimple size={16} />
            合并导出
          </button>
        </div>
      )}
    </div>
  );
}
