import { DownloadSimple, Minus, Plus, Scissors } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DisplaySegment } from "../../utils";
import { formatTime } from "../../utils";

export type RecordingRange = { startMs: number; endMs: number };

export function VerticalPlaybackTimeline({
  segments,
  selectedId,
  date,
  dateControls,
  hour,
  currentTimeMs,
  range,
  locked,
  onHourChange,
  onSeek,
  onRangeChange,
  onManage,
}: {
  segments: DisplaySegment[];
  selectedId?: string;
  date: string;
  dateControls: ReactNode;
  hour: number;
  currentTimeMs: number | null;
  range: RecordingRange | null;
  locked: boolean;
  onHourChange: (hour: number) => void;
  onSeek: (item: DisplaySegment, milliseconds: number) => void;
  onRangeChange: (range: RecordingRange) => void;
  onManage: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(60);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  useEffect(() => {
    if (range) {
      setRangeAnchor((range.startMs + range.endMs) / 2);
      setSpan(5);
    } else setRangeAnchor(null);
  }, [Boolean(range)]);
  const selected = segments.find((item) => item.id === selectedId);
  const hourStart = new Date(
    `${date}T${String(hour).padStart(2, "0")}:00:00`,
  ).getTime();
  const anchor =
    rangeAnchor !== null && new Date(rangeAnchor).getHours() === hour
      ? rangeAnchor
      : selected && new Date(selected.startTime).getHours() === hour
        ? new Date(selected.startTime).getTime()
        : hourStart;
  const start =
    span === 60
      ? hourStart
      : hourStart +
        Math.floor((anchor - hourStart) / (span * 60000)) * span * 60000;
  const end = start + span * 60000;
  const visibleRecordings = segments.filter(
    (item) => new Date(item.endTime).getTime() > start && new Date(item.startTime).getTime() < end,
  );
  const percent = (time: number) =>
    Math.max(0, Math.min(100, ((end - time) / (end - start)) * 100));
  function timeAt(clientY: number) {
    const box = track.current?.getBoundingClientRect();
    return box
      ? Math.round(
          (end -
            Math.max(0, Math.min(1, (clientY - box.top) / box.height)) *
              (end - start)) /
            1000,
        ) * 1000
      : start;
  }
  function seekAt(time: number) {
    const item = segments.find(
      (item) =>
        new Date(item.startTime).getTime() <= time &&
        new Date(item.endTime).getTime() > time,
    );
    if (item) onSeek(item, time);
    else {
      const nearest = [...segments].sort(
        (a, b) =>
          Math.abs(new Date(a.startTime).getTime() - time) -
          Math.abs(new Date(b.startTime).getTime() - time),
      )[0];
      if (nearest) onSeek(nearest, new Date(nearest.startTime).getTime());
    }
  }
  function moveHandle(key: "startMs" | "endMs", time: number) {
    if (!range || locked) return;
    onRangeChange(
      key === "startMs"
        ? { ...range, startMs: Math.min(time, range.endMs - 1000) }
        : { ...range, endMs: Math.max(time, range.startMs + 1000) },
    );
  }
  return (
    <section className="monitorTimeline" aria-label="录像时间轴">
      {dateControls}
      <header>
        <span>录像时间轴</span>
        <select
          aria-label="回看时段"
          value={hour}
          onChange={(e) => onHourChange(Number(e.target.value))}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>
              {String(i).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </header>
      <div className="monitorZoom">
        <button
          aria-label="缩小时间轴"
          disabled={span === 60}
          onClick={() => setSpan(span === 5 ? 15 : 60)}
        >
          <Minus size={13} />
        </button>
        <select
          aria-label="时间轴范围"
          value={span}
          onChange={(e) => setSpan(Number(e.target.value))}
        >
          <option value={60}>1 小时</option>
          <option value={15}>15 分钟</option>
          <option value={5}>5 分钟</option>
        </select>
        <button
          aria-label="放大时间轴"
          disabled={span === 5}
          onClick={() => setSpan(span === 60 ? 15 : 5)}
        >
          <Plus size={13} />
        </button>
      </div>
      <div
        className="monitorRuler"
        ref={track}
        onClick={(e) => seekAt(timeAt(e.clientY))}
      >
        {Array.from({ length: span === 5 ? 6 : 13 }, (_, i) => (
          <div
            className="monitorTick"
            key={i}
            style={{ top: `${(i / (span === 5 ? 5 : 12)) * 100}%` }}
          >
            <time>
              {formatTime(
                  new Date(end - (i / (span === 5 ? 5 : 12)) * (end - start)).toISOString(),
              ).slice(0, 5)}
            </time>
            <i />
          </div>
        ))}
        <div className="monitorCoverage" />
        {visibleRecordings.map((item) => (
            <button
              key={item.id}
              className={`monitorRecording${selectedId === item.id ? " active" : ""}`}
              aria-label={`定位 ${formatTime(item.startTime)} – ${formatTime(item.endTime)}`}
              title={`${formatTime(item.startTime)} – ${formatTime(item.endTime)}`}
              style={{
                top: `${percent(new Date(item.endTime).getTime())}%`,
                height: `${Math.max(0.15, percent(new Date(item.startTime).getTime()) - percent(new Date(item.endTime).getTime()))}%`,
              }}
              onClick={(e) => {
                if (e.detail === 0) {
                  e.stopPropagation();
                  onSeek(item, new Date(item.startTime).getTime());
                }
              }}
            />
          ))}
        {range && (
          <>
            <div
              className="monitorRange"
              style={{
                top: `${percent(range.endMs)}%`,
                height: `${percent(range.startMs) - percent(range.endMs)}%`,
              }}
            />
            {(["endMs", "startMs"] as const).map((key) => (
              <button
                key={key}
                className={`monitorRangeHandle ${key === 'startMs' ? 'rangeStart' : 'rangeEnd'}`}
                aria-label={key === "startMs" ? "拖动截取起点" : "拖动截取终点"}
                style={{ top: `${percent(range[key])}%` }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    moveHandle(key, timeAt(e.clientY));
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
                onKeyDown={(e) => {
                  if (["ArrowUp", "ArrowDown"].includes(e.key)) {
                    e.preventDefault();
                    moveHandle(
                      key,
                      range[key] +
                        (e.key === "ArrowUp" ? 1 : -1) *
                          (e.shiftKey ? 10 : 1) *
                          1000,
                    );
                  }
                }}
              >
                <span>{key === "startMs" ? "开始" : "结束"}</span>
                <time>{formatTime(new Date(range[key]).toISOString())}</time>
              </button>
            ))}
          </>
        )}
        {currentTimeMs !== null &&
          currentTimeMs >= start &&
          currentTimeMs <= end && (
            <div
              className="monitorPlayhead"
              style={{ top: `${percent(currentTimeMs)}%` }}
            >
              <time>{formatTime(new Date(currentTimeMs).toISOString())}</time>
            </div>
          )}
      </div>
      <footer>
        <small>当前范围 {visibleRecordings.length} 段 · 蓝色为录像</small>
        <button
          aria-label="管理片段"
          aria-pressed={Boolean(range)}
          disabled={!selected}
          onClick={onManage}
        >
          {range ? <Scissors size={15} /> : <DownloadSimple size={15} />}管理
        </button>
      </footer>
    </section>
  );
}
