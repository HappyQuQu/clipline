import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsOut,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ClosedCaptioning,
  DownloadSimple,
  Eye,
  FilmStrip,
  FolderOpen,
  Info,
  Microphone,
  Pause,
  Play,
  Scissors,
  SidebarSimple,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  SpeakerSlash,
  SpinnerGap,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Segment, Source } from "../../types";
import {
  type DisplaySegment,
  formatDuration,
  formatTime,
  queryMessage,
} from "../../utils";
import { SubtitleOverlay } from "../views/SubtitleOverlay";
import { VerticalPlaybackTimeline } from "./VerticalPlaybackTimeline";
import { RecordingRangePanel } from "./RecordingRangePanel";
import type { ExportSelection } from "./RecordingExportDialog";

export type SeekRequest = { segmentId: string; seconds: number; key: number };
type Props = {
  sources: Source[];
  sourceId: string;
  date: string;
  hour: number;
  segments: DisplaySegment[];
  segment: DisplaySegment | null;
  rawSegment?: Segment;
  seekRequest: SeekRequest | null;
  inspectorTab: "transcript" | "details";
  statuses: Map<string, "pending" | "processing" | "completed" | "failed">;
  loading: boolean;
  error: unknown;
  scanning: boolean;
  latest?: DisplaySegment;
  onSourceChange: (id: string) => void;
  onDateChange: (date: string) => void;
  onHourChange: (hour: number) => void;
  onOpen: (segment: DisplaySegment, seconds?: number) => void;
  onExport: (selection: ExportSelection) => void;
  onScan: () => void;
  onRefresh: () => void;
  onLibrary: () => void;
  onManage: () => void;
  onNotify: (text: string) => void;
};

export function PlaybackWorkbench(props: Props) {
  const {
    sources,
    sourceId,
    date,
    hour,
    segments,
    segment,
    seekRequest,
    statuses,
    onOpen,
    onNotify,
  } = props;
  const client = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const resumeRef = useRef(false);
  const appliedSeek = useRef<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoState, setVideoState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [tab, setTab] = useState(props.inspectorTab);
  const [focus, setFocus] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [rangeLocked, setRangeLocked] = useState(false);
  const [trimRange, setTrimRange] = useState<{
    startMs: number;
    endMs: number;
  } | null>(null);
  const source = sources.find((item) => item.id === sourceId);
  const ordered = [...segments].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );
  const currentIndex = ordered.findIndex((item) => item.id === segment?.id);
  const absoluteTime = segment
    ? new Date(segment.startTime).getTime() + currentTime * 1000
    : null;
  const speechStatus = segment ? statuses.get(segment.id) : undefined;
  const speech = useQuery({
    queryKey: ["transcription", segment?.id],
    queryFn: () => api.getTranscription(segment!.id),
    enabled: Boolean(segment),
    refetchInterval:
      speechStatus === "pending" || speechStatus === "processing"
        ? 2500
        : false,
  });
  const vision = useQuery({
    queryKey: ["segmentVision", segment?.id],
    queryFn: () => api.getVisionDetections(segment!.id),
    enabled: Boolean(segment) && tab === "details",
    refetchInterval: tab === "details" ? 5000 : false,
  });
  const metadata = useQuery({
    queryKey: ["segmentMetadata", segment?.id],
    queryFn: () => api.segment(segment!.id),
    enabled: Boolean(segment) && tab === "details" && !props.rawSegment,
  });
  const rawSegment = props.rawSegment ?? metadata.data;
  const visionStatus = useQuery({
    queryKey: ["segmentVisionStatus", segment?.id],
    queryFn: () => api.getVisionStatus(segment!.id),
    enabled: Boolean(segment) && tab === "details",
    refetchInterval: 3000,
  });
  const transcript = speech.data?.items ?? [];
  useEffect(() => {
    if (speechStatus === "completed")
      void client.invalidateQueries({
        queryKey: ["transcription", segment?.id],
      });
  }, [speechStatus, segment?.id, client]);
  const activeLine = transcript.reduce(
    (last, line, index) =>
      line.startTime <= currentTime && line.endTime >= currentTime
        ? index
        : last,
    -1,
  );
  const labels = Array.from(
    new Set((vision.data?.items ?? []).map((item) => item.labelName)),
  );
  const recognizing =
    speechStatus === "processing" || speechStatus === "pending";
  const recognizingVision = ["pending", "processing"].includes(
    visionStatus.data?.status ?? "",
  );
  const recognitionMutation = useMutation({
    mutationFn: (kind: "speech" | "vision") =>
      kind === "speech"
        ? api.triggerTranscription(segment!.id)
        : api.triggerVision(segment!.id, false),
    onSuccess: (_result, kind) => {
      onNotify(`${kind === "speech" ? "语音" : "视觉"}识别任务已创建`);
      void Promise.all(
        [
          "transcriptionJobs",
          "visionJobs",
          "segmentVisionStatus",
          "taskCenter",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
    onError: (error) => onNotify(queryMessage(error, "创建识别任务失败")),
  });

  useEffect(() => {
    setTab(props.inspectorTab);
    if (seekRequest) setInspector(true);
  }, [props.inspectorTab, seekRequest?.key]);
  useEffect(() => {
    setCurrentTime(0);
    setVideoState("loading");
    appliedSeek.current = null;
    if (!trimming && segment)
      setTrimRange({
        startMs: new Date(segment.startTime).getTime(),
        endMs: new Date(segment.endTime).getTime(),
      });
  }, [segment?.id]);
  useEffect(() => {
    setTrimming(false);
    setPlaying(false);
    resumeRef.current = false;
  }, [date, sourceId]);
  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      !segment ||
      seekRequest?.segmentId !== segment.id ||
      video.readyState === 0
    )
      return;
    video.currentTime = Math.min(
      seekRequest.seconds,
      video.duration || segment.durationSeconds,
    );
    setCurrentTime(video.currentTime);
    appliedSeek.current = seekRequest.key;
  }, [seekRequest?.key, segment?.id]);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      videoRef.current.muted = muted;
    }
  }, [rate, muted, segment?.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
      if (
        event.code !== "Space" ||
        (event.target as HTMLElement).closest(
          'button,input,select,textarea,[role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      togglePlay();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [segment?.id]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      void video
        .play()
        .catch(() => onNotify("无法开始播放，请检查录像文件后重试"));
    } else video.pause();
  }
  function selectRelative(offset: number) {
    const next = ordered[currentIndex + offset];
    if (next) {
      resumeRef.current = playing;
      onOpen(next);
    }
  }
  function seek(seconds: number) {
    if (!videoRef.current || !segment) return;
    videoRef.current.currentTime = Math.max(
      0,
      Math.min(segment.durationSeconds, seconds),
    );
    setCurrentTime(videoRef.current.currentTime);
  }
  function shiftDate(offset: number) {
    const next = new Date(`${date}T12:00:00`);
    next.setDate(next.getDate() + offset);
    props.onDateChange(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`,
    );
  }
  async function downloadTranscript() {
    if (!segment) return;
    try {
      const data = await api.exportTranscription(segment.id, "srt");
      const url = URL.createObjectURL(
        new Blob([data.content], { type: "text/plain;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${source?.name ?? "录像"}-字幕.srt`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      onNotify(queryMessage(error, "下载字幕失败"));
    }
  }
  const visibleSegments = [...ordered]
    .reverse()
    .filter(
      (item) =>
        new Date(item.startTime).getHours() === hour || item.id === segment?.id,
    );
  function manageRange() {
    if (trimming) { setTrimming(false); return; }
    if (!segment) return;
    const startMs = Math.floor((absoluteTime ?? new Date(segment.startTime).getTime()) / 1000) * 1000;
    const endMs = Math.min(startMs + 60000, new Date(segment.endTime).getTime());
    setTrimRange({ startMs: Math.max(new Date(segment.startTime).getTime(), Math.min(startMs, endMs - 1000)), endMs });
    setInspector(false);
    setTrimming(true);
  }

  return (
    <section className={`workReview${focus ? " workFocus" : ""}`}>
      <h1 className="monitorScreenReaderHeading">录像回看</h1>
      <div className={`workReviewGrid${inspector && !trimming ? "" : " hideInspector"}${trimming ? " managingRange" : ""}`}>
        <VerticalPlaybackTimeline
          segments={segments} selectedId={segment?.id} date={date} hour={hour}
          dateControls={
            <div className="monitorDateNavigation">
              <button aria-label="前一天" title="前一天" onClick={() => shiftDate(-1)}><CaretLeft size={13} /></button>
              <input aria-label="回看日期" type="date" value={date} onChange={(event) => event.target.value && props.onDateChange(event.target.value)} />
              <button aria-label="后一天" title="后一天" onClick={() => shiftDate(1)}><CaretRight size={13} /></button>
            </div>
          }
          currentTimeMs={absoluteTime} range={trimming ? trimRange : null}
          onHourChange={props.onHourChange}
          onSeek={(item, ms) => { resumeRef.current = playing; onOpen(item, (ms - new Date(item.startTime).getTime()) / 1000); }}
          onRangeChange={setTrimRange} locked={rangeLocked} onManage={manageRange}
        />
        {trimming && trimRange && <RecordingRangePanel sourceId={sourceId} sourceName={source?.name ?? '录像源'} date={date} range={trimRange} segments={segments} currentTimeMs={absoluteTime} onChange={setTrimRange} onBusyChange={setRangeLocked} onClose={()=>setTrimming(false)} onNotify={onNotify}/>}
        <div className="workViewingColumn">
          <div className="workVideoHeading">
            <div>
              <i className={source?.enabled ? "enabled" : ""} />
              <label className="monitorCameraSelect">
                <VideoCamera size={16} />
                <select aria-label="当前录像源" value={sourceId} onChange={(event) => props.onSourceChange(event.target.value)}>
                  <option value="" disabled>选择录像源</option>
                  {sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              {rawSegment?.width && (
                <span>
                  {rawSegment.width} × {rawSegment.height}
                </span>
              )}
            </div>
            <div>
              <button
                className="workIconButton"
                aria-label={inspector ? "收起片段信息" : "打开片段信息"}
                onClick={() => { setTrimming(false); setInspector((value) => !value); }}
              >
                <SidebarSimple size={20} />
              </button>
              <button
                className={trimming ? "workButton" : "workButton primary"}
                disabled={!segment}
                onClick={manageRange}
              >
                {trimming ? <X size={17} /> : <Scissors size={17} />}
                {trimming ? "关闭管理" : "管理片段"}
              </button>
            </div>
          </div>
          <div className="workPlayer">
            <div className="workPlayerFrame">
              {segment ? (
                <>
                  <video
                    ref={videoRef}
                    key={segment.id}
                    src={`/api/segments/${segment.id}/stream`}
                    poster={segment.thumbnailUrl ?? undefined}
                    aria-label={`${source?.name ?? "录像源"}录像回放`}
                    playsInline
                    preload="metadata"
                    onClick={togglePlay}
                    onLoadStart={() => setVideoState("loading")}
                    onLoadedMetadata={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      video.playbackRate = rate;
                      if (
                        seekRequest?.segmentId === segment.id &&
                        appliedSeek.current !== seekRequest.key
                      ) {
                        video.currentTime = Math.min(
                          seekRequest.seconds,
                          video.duration || segment.durationSeconds,
                        );
                        appliedSeek.current = seekRequest.key;
                      }
                      setCurrentTime(video.currentTime);
                    }}
                    onCanPlay={() => {
                      setVideoState("ready");
                      if (resumeRef.current && videoRef.current) {
                        resumeRef.current = false;
                        void videoRef.current
                          .play()
                          .catch(() => setPlaying(false));
                      }
                    }}
                    onWaiting={() => setVideoState("loading")}
                    onTimeUpdate={() =>
                      setCurrentTime(videoRef.current?.currentTime ?? 0)
                    }
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onError={() => {
                      setVideoState("error");
                      setPlaying(false);
                      resumeRef.current = false;
                    }}
                    onEnded={() => {
                      const next = ordered[currentIndex + 1];
                      if (next) {
                        const gap =
                          (new Date(next.startTime).getTime() -
                            new Date(segment.endTime).getTime()) /
                          1000;
                        if (gap > 1)
                          onNotify(`已跳过 ${formatDuration(gap)} 无录像区间`);
                        resumeRef.current = true;
                        onOpen(next);
                      } else setPlaying(false);
                    }}
                  />
                  <div className="workVideoStamp">
                    <span>录像回放</span>
                    <time>
                      {date.replaceAll("-", ".")} &nbsp;{" "}
                      {absoluteTime
                        ? formatTime(new Date(absoluteTime).toISOString())
                        : "--:--:--"}
                    </time>
                  </div>
                  {captions && transcript.length > 0 && (
                    <SubtitleOverlay
                      transcriptions={transcript}
                      currentTime={currentTime}
                    />
                  )}
                  {videoState === "loading" && (
                    <div className="workVideoState" aria-live="polite">
                      <SpinnerGap size={28} className="spinning" />
                      <span>正在加载录像</span>
                    </div>
                  )}
                  {videoState === "error" && (
                    <div className="workVideoState" role="alert">
                      <VideoCamera size={32} />
                      <strong>录像无法播放</strong>
                      <span>请检查文件是否可访问，或尝试其他片段。</span>
                      <button
                        className="workButton"
                        onClick={() => videoRef.current?.load()}
                      >
                        重新加载
                      </button>
                    </div>
                  )}
                  {!playing && videoState === "ready" && (
                    <button
                      className="workCenterPlay"
                      aria-label="开始播放"
                      onClick={togglePlay}
                    >
                      <Play size={30} weight="fill" />
                    </button>
                  )}
                </>
              ) : (
                <div
                  className="workEmptyVideo"
                  role={props.error ? "alert" : "status"}
                >
                  {props.loading ? (
                    <SpinnerGap size={38} className="spinning" />
                  ) : (
                    <FilmStrip size={40} />
                  )}
                  <h2>
                    {props.loading
                      ? "正在加载录像"
                      : props.error
                        ? "录像加载失败"
                        : sourceId
                          ? "这一天还没有录像"
                          : "添加你的第一个录像源"}
                  </h2>
                  <p>
                    {props.error
                      ? queryMessage(props.error, "请刷新重试")
                      : sourceId
                        ? "切换日期，或查看最近一次索引的内容。"
                        : "连接录像目录，让每段画面都可以被找到。"}
                  </p>
                  {props.error ? (
                    <button className="workButton" onClick={props.onRefresh}>
                      重新加载
                    </button>
                  ) : props.latest ? (
                    <button
                      className="workButton"
                      onClick={() => onOpen(props.latest!)}
                    >
                      查看最近录像
                      <CaretRight size={15} />
                    </button>
                  ) : (
                    <button className="workButton" onClick={props.onManage}>
                      管理录像源
                      <CaretRight size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="workPlayerControls">
              <button
                aria-label="前一片段"
                disabled={currentIndex <= 0}
                onClick={() => selectRelative(-1)}
              >
                <SkipBack size={19} />
              </button>
              <button
                className="workPlayButton"
                aria-label={playing ? "暂停" : "播放"}
                disabled={!segment || videoState === "error"}
                onClick={togglePlay}
              >
                {playing ? (
                  <Pause size={21} weight="fill" />
                ) : (
                  <Play size={21} weight="fill" />
                )}
              </button>
              <button
                aria-label="后一片段"
                disabled={
                  currentIndex < 0 || currentIndex >= ordered.length - 1
                }
                onClick={() => selectRelative(1)}
              >
                <SkipForward size={19} />
              </button>
              <time>
                {absoluteTime
                  ? formatTime(new Date(absoluteTime).toISOString())
                  : "--:--:--"}
                <small>
                  {" "}
                  / {segment ? formatTime(segment.endTime) : "--:--:--"}
                </small>
              </time>
              <span className="workControlSpacer" />
              <button
                className="workBackTen"
                aria-label="后退十秒"
                disabled={!segment}
                onClick={() => seek(currentTime - 10)}
              >
                <ArrowCounterClockwise size={18} />
                <small>10</small>
              </button>
              <select
                aria-label="播放速度"
                value={rate}
                onChange={(event) => setRate(Number(event.target.value))}
              >
                {[0.5, 1, 1.5, 2, 4].map((value) => (
                  <option value={value} key={value}>
                    {value}×
                  </option>
                ))}
              </select>
              <button
                aria-label="切换画面字幕"
                aria-pressed={captions}
                disabled={!transcript.length}
                className={captions ? "active" : ""}
                onClick={() => setCaptions((value) => !value)}
              >
                <ClosedCaptioning size={21} />
              </button>
              <button
                aria-label={muted ? "开启声音" : "静音"}
                disabled={!segment}
                onClick={() => setMuted((value) => !value)}
              >
                {muted ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}
              </button>
              <button
                aria-label={focus ? "退出专注模式" : "专注回看"}
                onClick={() => setFocus((value) => !value)}
              >
                {focus ? <X size={20} /> : <ArrowsOut size={20} />}
              </button>
            </div>
          </div>
          <section className="workFilmstripSection">
            <header>
              <h2>
                当前时段片段<span>{visibleSegments.length}</span>
              </h2>
              <button onClick={props.onLibrary}>
                进入片段库
                <CaretRight size={14} />
              </button>
            </header>
            {visibleSegments.length ? (
              <div className="workFilmstrip">
                {visibleSegments.map((item) => (
                  <button
                    key={item.id}
                    aria-label={`播放 ${formatTime(item.startTime)} 片段`}
                    aria-pressed={item.id === segment?.id}
                    className={item.id === segment?.id ? "active" : ""}
                    onClick={() => {
                      resumeRef.current = playing;
                      onOpen(item);
                    }}
                  >
                    <div>
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={`${formatTime(item.startTime)} 录像缩略图`}
                          loading="lazy"
                        />
                      ) : (
                        <FilmStrip size={25} />
                      )}
                      <time>{offsetTime(item.durationSeconds)}</time>
                      {item.id === segment?.id && (
                        <em>
                          <Play size={11} weight="fill" />
                          当前
                        </em>
                      )}
                    </div>
                    <strong>{formatTime(item.startTime)}</strong>
                    <small>
                      {statuses.get(item.id) === "completed"
                        ? "字幕完成"
                        : statuses.get(item.id) === "failed"
                          ? "识别失败"
                          : ["pending", "processing"].includes(
                                statuses.get(item.id) ?? "",
                              )
                            ? "识别中"
                            : "未识别"}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="workEmptyStrip">
                <CalendarBlank size={22} />
                当前时段没有录像，试试其他日期或时段。
              </div>
            )}
          </section>
        </div>
        {inspector && !trimming && (
          <aside className="workInspector">
            <header>
              <h2>片段信息</h2>
              {segment && <span>{offsetTime(segment.durationSeconds)}</span>}
            </header>
            <div
              role="tablist"
              aria-label="片段信息"
              className="workInspectorTabs"
            >
              <button
                role="tab"
                aria-selected={tab === "transcript"}
                className={tab === "transcript" ? "active" : ""}
                onClick={() => setTab("transcript")}
              >
                <ClosedCaptioning size={17} />
                字幕
                {transcript.length > 0 && <small>{transcript.length}</small>}
              </button>
              <button
                role="tab"
                aria-selected={tab === "details"}
                className={tab === "details" ? "active" : ""}
                onClick={() => setTab("details")}
              >
                <Info size={17} />
                详情
              </button>
            </div>
            {!segment ? (
              <div className="workInspectorEmpty">
                <FilmStrip size={28} />
                <strong>选择一个录像片段</strong>
                <p>查看字幕、画面标签与文件信息。</p>
              </div>
            ) : tab === "transcript" ? (
              <>
                <div className="workTranscriptStatus">
                  <span>
                    <CheckCircle size={14} />
                    {recognizing
                      ? "字幕识别中"
                      : transcript.length
                        ? "字幕已就绪"
                        : speech.isError
                          ? "字幕加载失败"
                          : "暂无字幕"}
                  </span>
                  <small>语音识别</small>
                </div>
                {transcript.length > 0 ? (
                  <>
                    <p className="workTranscriptHint">
                      点击字幕，跳转到对应时刻
                    </p>
                    <div className="workTranscriptList">
                      {transcript.map((line, index) => (
                        <button
                          className={index === activeLine ? "active" : ""}
                          key={line.id}
                          onClick={() => seek(line.startTime)}
                        >
                          <time>
                            {formatTime(
                              new Date(
                                new Date(segment.startTime).getTime() +
                                  line.startTime * 1000,
                              ).toISOString(),
                            )}
                          </time>
                          <p>{line.text}</p>
                          {index === activeLine && (
                            <Play size={12} weight="fill" />
                          )}
                        </button>
                      ))}
                    </div>
                    <footer>
                      <span>{transcript.length} 条字幕</span>
                      <button
                        className="workIconButton"
                        aria-label="导出字幕"
                        onClick={() => void downloadTranscript()}
                      >
                        <DownloadSimple size={18} />
                      </button>
                    </footer>
                  </>
                ) : (
                  <div className="workInspectorEmpty">
                    <Microphone size={29} />
                    <strong>
                      {recognizing ? "正在把声音转为字幕" : "让录像变得可搜索"}
                    </strong>
                    <p>
                      {speechStatus === "failed"
                        ? "识别失败，可在任务页查看原因并重试。"
                        : speech.isError
                          ? queryMessage(speech.error, "请稍后重试")
                          : "识别语音后，可以按内容找到录像。"}
                    </p>
                    <button
                      className="workButton"
                      disabled={recognizing || recognitionMutation.isPending}
                      onClick={() => recognitionMutation.mutate("speech")}
                    >
                      {recognizing ? "识别中…" : "识别字幕"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="workClipDetails">
                {segment.thumbnailUrl && (
                  <img src={segment.thumbnailUrl} alt="片段预览" />
                )}
                <dl>
                  <div>
                    <dt>录像源</dt>
                    <dd>{source?.name}</dd>
                  </div>
                  <div>
                    <dt>日期</dt>
                    <dd>{date}</dd>
                  </div>
                  <div>
                    <dt>时间范围</dt>
                    <dd>
                      {formatTime(segment.startTime)} –{" "}
                      {formatTime(segment.endTime)}
                    </dd>
                  </div>
                  <div>
                    <dt>分辨率</dt>
                    <dd>
                      {rawSegment?.width
                        ? `${rawSegment.width} × ${rawSegment.height}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>视频编码</dt>
                    <dd>{rawSegment?.videoCodec ?? "—"}</dd>
                  </div>
                </dl>
                <h3>画面标签</h3>
                <div className="workTags">
                  {labels.length ? (
                    labels.map((label) => <span key={label}>{label}</span>)
                  ) : (
                    <small>
                      {vision.isError ? "标签暂时无法加载" : "暂无标签"}
                    </small>
                  )}
                </div>
                <button
                  className="workButton"
                  disabled={recognizingVision || recognitionMutation.isPending}
                  onClick={() => recognitionMutation.mutate("vision")}
                >
                  <Eye size={16} />
                  {recognizingVision ? "识别中…" : "识别画面"}
                </button>
                {visionStatus.data?.errorMessage && (
                  <p className="workInlineError">
                    {visionStatus.data.errorMessage}
                  </p>
                )}
                <p className="workFileNote">
                  原始录像保存在目录中，导出会生成副本。
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
      <footer className="workReviewFooter">
        <span>
          <FolderOpen size={14} />
          {source
            ? `${source.segmentCount.toLocaleString()} 个片段已索引`
            : "尚未添加录像目录"}
        </span>
        <button disabled={!sourceId || props.scanning} onClick={props.onScan}>
          <ArrowClockwise
            size={14}
            className={props.scanning ? "spinning" : ""}
          />
          {props.scanning ? "正在扫描…" : "重新扫描"}
        </button>
      </footer>
    </section>
  );
}

export function offsetTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}
