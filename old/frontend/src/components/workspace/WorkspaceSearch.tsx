import {
  ClosedCaptioning,
  FilmStrip,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { SearchResult } from "../../types";
import {
  type DisplaySegment,
  formatTime,
  queryMessage,
  searchHistoryStorageKey,
  toDisplaySegment,
} from "../../utils";
import { useDialogFocus } from "../shared/useDialogFocus";

export function WorkspaceSearch({
  segments,
  sourceNames,
  onOpen,
  onClose,
  onNotify,
}: {
  segments: DisplaySegment[];
  sourceNames: Map<string, string>;
  onOpen: (segment: DisplaySegment, seconds?: number) => void;
  onClose: () => void;
  onNotify: (text: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, true, onClose);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [opening, setOpening] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(searchHistoryStorageKey) ?? "[]",
      );
      return Array.isArray(saved)
        ? saved
            .filter((item): item is string => typeof item === "string")
            .slice(0, 20)
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: ["workspaceSearch", debounced],
    queryFn: () => api.search({ q: debounced, limit: 20 }),
    enabled: Boolean(debounced),
  });
  const vision = useQuery({
    queryKey: ["workspaceSearchTags"],
    queryFn: () => api.listVisionDetections({ limit: 5000 }),
    enabled: Boolean(debounced),
    staleTime: 10000,
  });
  const tagMatches = new Set(
    (vision.data?.items ?? [])
      .filter((item) =>
        `${item.label} ${item.labelName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
      .map((item) => item.segmentId),
  );
  const matches = segments
    .filter(
      (item) =>
        tagMatches.has(item.id) ||
        `${item.filename ?? ""} ${sourceNames.get(item.sourceId)} ${formatTime(item.startTime)} ${formatTime(item.endTime)}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .slice(0, query.trim() ? 10 : 3);
  function remember() {
    if (!query.trim()) return;
    const next = [
      query.trim(),
      ...history.filter((item) => item !== query.trim()),
    ].slice(0, 20);
    setHistory(next);
    localStorage.setItem(searchHistoryStorageKey, JSON.stringify(next));
  }
  async function openResult(item: SearchResult) {
    setOpening(true);
    try {
      const segment =
        segments.find((segment) => segment.id === item.segmentId) ??
        toDisplaySegment(await api.segment(item.segmentId));
      if (!segment) throw new Error("该录像片段没有可用的时间信息");
      remember();
      onOpen(segment, item.transcription.startTime);
      onClose();
    } catch (error) {
      onNotify(queryMessage(error, "无法打开搜索结果"));
    } finally {
      setOpening(false);
    }
  }
  return (
    <div
      className="workModalBackdrop"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        ref={ref}
        className="workSearchDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workSearchTitle"
        tabIndex={-1}
      >
        <div className="workSearchInput">
          <MagnifyingGlass size={23} />
          <input
            aria-label="搜索录像内容"
            placeholder="搜索字幕、时间或画面标签…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="workIconButton"
            aria-label="关闭搜索"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workSearchContent">
          <h2 id="workSearchTitle">
            {query.trim() ? "搜索结果" : "找到你需要的那段录像"}
          </h2>
          {!query.trim() && history.length > 0 && (
            <div className="workSearchHistory">
              {history.slice(0, 6).map((item) => (
                <button key={item} onClick={() => setQuery(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}
          {query.trim() &&
            (query.trim() !== debounced ||
              results.isFetching ||
              vision.isFetching) && (
              <p className="workSearchHint" role="status">
                正在搜索…
              </p>
            )}
          {debounced && results.isError && (
            <p className="workInlineError" role="alert">
              {queryMessage(results.error, "搜索暂时不可用")}
            </p>
          )}
          {query.trim() &&
            query.trim() === debounced &&
            !vision.isFetching &&
            (results.data?.items ?? []).map((item) => (
              <button
                disabled={opening}
                className="workSearchResult"
                key={item.transcription.id}
                onClick={() => void openResult(item)}
              >
                <ClosedCaptioning size={21} />
                <div>
                  <strong>{item.transcription.text}</strong>
                  <small>{item.sourceName} · 字幕</small>
                </div>
                <time>
                  {item.segmentStartTime
                    ? formatTime(
                        new Date(
                          new Date(item.segmentStartTime).getTime() +
                            item.transcription.startTime * 1000,
                        ).toISOString(),
                      )
                    : `${Math.floor(item.transcription.startTime / 60)}:${String(Math.floor(item.transcription.startTime % 60)).padStart(2, "0")}`}
                </time>
              </button>
            ))}
          {matches.map((item) => (
            <button
              className="workSearchResult"
              key={item.id}
              onClick={() => {
                remember();
                onOpen(item);
                onClose();
              }}
            >
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt="" />
              ) : (
                <FilmStrip size={24} />
              )}
              <div>
                <strong>
                  {sourceNames.get(item.sourceId) ?? "录像源"} ·{" "}
                  {formatTime(item.startTime)}
                </strong>
                <small>{item.filename ?? "录像片段"}</small>
              </div>
              <time>
                {new Date(item.startTime).toLocaleDateString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                })}
              </time>
            </button>
          ))}
          {query.trim() &&
            query.trim() === debounced &&
            !vision.isFetching &&
            !results.isFetching &&
            !results.isError &&
            !results.data?.items.length &&
            !matches.length && (
              <div className="workSearchEmpty">
                <MagnifyingGlass size={30} />
                <strong>没有找到相关内容</strong>
                <p>换一个时间、字幕关键词或文件名试试。</p>
              </div>
            )}
        </div>
        <footer>
          <span>点击结果直接打开回看</span>
          <kbd>Esc 关闭</kbd>
        </footer>
      </section>
    </div>
  );
}
