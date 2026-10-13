import { DownloadSimple, Minus, Plus } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DisplaySegment, formatDuration, formatTime } from "../../utils";

type Range = { startMs: number; endMs: number };
export function PlaybackTimeline({
  segments,
  selectedId,
  date,
  hour,
  currentTimeMs,
  trimRange,
  onHourChange,
  onSeek,
  onTrimChange,
  onExport,
  onNotify,
}: {
  segments: DisplaySegment[];
  selectedId?: string;
  date: string;
  hour: number;
  currentTimeMs: number | null;
  trimRange: Range | null;
  onHourChange: (hour: number) => void;
  onSeek: (segment: DisplaySegment, ms: number) => void;
  onTrimChange: (range: Range) => void;
  onExport: () => void;
  onNotify: (message: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(60);
  const selected = segments.find((item) => item.id === selectedId);
  const anchor =
    selected && new Date(selected.startTime).getHours() === hour
      ? new Date(selected.startTime).getTime()
      : new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).getTime();
  const windowStart =
    span === 60
      ? new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).getTime()
      : Math.floor(anchor / (span * 60000)) * span * 60000;
  const windowEnd = windowStart + span * 60000;
  const percent = (time: number) =>
    Math.max(
      0,
      Math.min(100, ((time - windowStart) / (windowEnd - windowStart)) * 100),
    );
  const coverage = useMemo(
    () =>
      trimRange
        ? rangeCoverage(segments, trimRange.startMs, trimRange.endMs)
        : { seconds: 0, count: 0 },
    [segments, trimRange],
  );
  function handleSeek(clientX: number) {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return;
    const time =
      windowStart +
      Math.max(0, Math.min(1, (clientX - box.left) / box.width)) *
        (windowEnd - windowStart);
    const item = segments.find(
      (segment) =>
        new Date(segment.startTime).getTime() <= time &&
        new Date(segment.endTime).getTime() > time,
    );
    if (item) onSeek(item, time);
    else onNotify("这个时间没有录像，点击蓝色区间查看相邻片段");
  }
  return (
    <section className="workTimeline" aria-label="录像时间轴">
      <header>
        <div>
          <strong>时间轴</strong>
          <span className="workTimelineLegend">
            <i />
            有录像
            <b />
            无录像
          </span>
        </div>
        <div className="workTimelineTools">
          <select
            aria-label="回看时段"
            value={hour}
            onChange={(event) => onHourChange(Number(event.target.value))}
          >
            {Array.from({ length: 24 }, (_, value) => (
              <option key={value} value={value}>
                {String(value).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <button
            className="workIconButton"
            aria-label="缩小时间轴"
            disabled={span === 60}
            onClick={() => setSpan((value) => Math.min(60, value * 2))}
          >
            <Minus size={14} />
          </button>
          <select
            aria-label="时间轴范围"
            value={span}
            onChange={(event) => setSpan(Number(event.target.value))}
          >
            <option value={60}>1 小时</option>
            <option value={30}>30 分钟</option>
            <option value={15}>15 分钟</option>
          </select>
          <button
            className="workIconButton"
            aria-label="放大时间轴"
            disabled={span === 15}
            onClick={() => setSpan((value) => Math.max(15, value / 2))}
          >
            <Plus size={14} />
          </button>
        </div>
      </header>
      <div className="workTimelineRuler">
        {Array.from({ length: 7 }, (_, index) => (
          <time key={index}>
            {formatTime(
              new Date(windowStart + index * span * 10000).toISOString(),
            ).slice(0, 5)}
          </time>
        ))}
      </div>
      <div
        ref={trackRef}
        className="workTimelineTrack"
        onClick={(event) => handleSeek(event.clientX)}
      >
        <div className="workTimelineTicks" />
        {segments
          .filter(
            (item) =>
              new Date(item.endTime).getTime() > windowStart &&
              new Date(item.startTime).getTime() < windowEnd,
          )
          .map((item) => (
            <button
              key={item.id}
              aria-label={`定位 ${formatTime(item.startTime)} – ${formatTime(item.endTime)}`}
              className={`workRecording${item.id === selectedId ? " active" : ""}`}
              style={{
                left: `${percent(new Date(item.startTime).getTime())}%`,
                width: `${Math.max(0.1, percent(new Date(item.endTime).getTime()) - percent(new Date(item.startTime).getTime()) - 0.1)}%`,
              }}
              onClick={(event) => {
                if (event.detail === 0) {
                  event.stopPropagation();
                  onSeek(item, new Date(item.startTime).getTime());
                }
              }}
            />
          ))}
        {currentTimeMs !== null &&
          currentTimeMs >= windowStart &&
          currentTimeMs <= windowEnd && (
            <div
              className="workPlayhead"
              style={{ left: `${percent(currentTimeMs)}%` }}
            >
              <span />
            </div>
          )}
        {trimRange && (
          <div
            className="workTrimHighlight"
            style={{
              left: `${percent(trimRange.startMs)}%`,
              width: `${Math.max(0, percent(trimRange.endMs) - percent(trimRange.startMs))}%`,
            }}
          />
        )}
      </div>
      <footer>
        <span>
          {selected ? (
            <>
              当前片段{" "}
              <strong>
                {formatTime(selected.startTime)} –{" "}
                {formatTime(selected.endTime)}
              </strong>
            </>
          ) : (
            "当前日期没有已索引录像"
          )}
        </span>
        <span>{segments.length} 个片段</span>
      </footer>
      {trimRange && (
        <div className="workTrimEditor">
          <div>
            <label>
              起点
              <TimeEditor
                label="截取起点"
                date={date}
                value={trimRange.startMs}
                onCommit={(value) => {
                  if (value >= trimRange.endMs) {
                    onNotify("起点需要早于终点");
                    return false;
                  }
                  onTrimChange({ ...trimRange, startMs: value });
                  return true;
                }}
                onNotify={onNotify}
              />
            </label>
            <span>—</span>
            <label>
              终点
              <TimeEditor
                label="截取终点"
                date={date}
                value={trimRange.endMs}
                onCommit={(value) => {
                  if (value <= trimRange.startMs) {
                    onNotify("终点需要晚于起点");
                    return false;
                  }
                  onTrimChange({ ...trimRange, endMs: value });
                  return true;
                }}
                onNotify={onNotify}
              />
            </label>
            <small>
              {coverage.count} 个片段 · 录像 {formatDuration(coverage.seconds)}
              {trimRange.endMs - trimRange.startMs > coverage.seconds * 1000 + 1
                ? ` · 断档 ${formatDuration((trimRange.endMs - trimRange.startMs) / 1000 - coverage.seconds)}`
                : ""}
            </small>
          </div>
          <button
            className="workButton primary"
            disabled={!coverage.count}
            onClick={onExport}
          >
            <DownloadSimple size={16} />
            导出区间
          </button>
        </div>
      )}
    </section>
  );
}

export function TimeEditor({
  label,
  date,
  value,
  onCommit,
  onNotify,
  disabled = false,
}: {
  label: string;
  date: string;
  value: number;
  onCommit: (time: number) => boolean;
  onNotify: (text: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(formatTime(new Date(value).toISOString()));
  useEffect(() => setDraft(formatTime(new Date(value).toISOString())), [value]);
  function commit(text: string) {
    const normalized = text.trim().replaceAll("：", ":");
    if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(normalized)) {
      onNotify("请输入 HH:MM:SS 格式的时间");
      setDraft(formatTime(new Date(value).toISOString()));
      return;
    }
    const time = new Date(`${date}T${normalized}`).getTime();
    if (!onCommit(time)) setDraft(formatTime(new Date(value).toISOString()));
  }
  return (
    <input
      aria-label={label}
      disabled={disabled}
      value={draft}
      placeholder="HH:MM:SS"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function rangeCoverage(
  segments: DisplaySegment[],
  start: number,
  end: number,
) {
  const ranges = segments
    .map((item) => ({
      start: Math.max(start, new Date(item.startTime).getTime()),
      end: Math.min(end, new Date(item.endTime).getTime()),
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  let last = start;
  for (const range of ranges) {
    covered += Math.max(0, range.end - Math.max(last, range.start));
    last = Math.max(last, range.end);
  }
  return { seconds: covered / 1000, count: ranges.length };
}
