import * as Toast from "@radix-ui/react-toast";
import {
  Archive,
  CaretRight,
  CheckCircle,
  FileText,
  Gear,
  HardDrives,
  ListChecks,
  MagnifyingGlass,
  Play,
  SidebarSimple,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import {
  SETTINGS_TABS,
  SettingsPage,
  type SettingsTab,
} from "./components/settings/SettingsPage";
import { ClipLibraryView } from "./components/views/ClipLibraryView";
import { LogsStage } from "./components/views/LogsStage";
import { SourceStage } from "./components/views/SourceStage";
import { TaskCenterView } from "./components/views/TaskCenterView";
import {
  PlaybackWorkbench,
  type SeekRequest,
} from "./components/workspace/PlaybackWorkbench";
import {
  RecordingExportDialog,
  type ExportSelection,
} from "./components/workspace/RecordingExportDialog";
import { WorkspaceSearch } from "./components/workspace/WorkspaceSearch";
import type { Source } from "./types";
import {
  type DisplaySegment,
  queryMessage,
  selectedSourceStorageKey,
  toDisplaySegment,
} from "./utils";

type ViewKey = "playback" | "clips" | "tasks" | "manage";
type ManageSection = "sources" | "logs" | "settings";
const navItems = [
  { key: "playback" as const, label: "回看", icon: Play },
  { key: "clips" as const, label: "片段库", icon: Archive },
  { key: "tasks" as const, label: "任务", icon: ListChecks },
  { key: "manage" as const, label: "管理", icon: Gear },
];

export function App() {
  const queryClient = useQueryClient();
  const mainRef = useRef<HTMLElement>(null);
  const initialSource = useRef("");
  const [activeView, setActiveView] = useState<ViewKey>("playback");
  const [manageSection, setManageSection] = useState<ManageSection>("sources");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("overview");
  const [collapsed, setCollapsed] = useState(true);
  const [sourceId, setSourceId] = useState(
    () => localStorage.getItem(selectedSourceStorageKey) ?? "",
  );
  const [date, setDate] = useState(() => localDay(new Date()));
  const [hour, setHour] = useState(9);
  const [selectedId, setSelectedId] = useState("");
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"transcript" | "details">(
    "transcript",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportSelection, setExportSelection] =
    useState<ExportSelection | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [sourceScanInterval, setSourceScanInterval] = useState(0);
  const [message, setMessage] = useState("");
  const [toastOpen, setToastOpen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [watchedExports, setWatchedExports] = useState<string[]>([]);

  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    refetchInterval: 10000,
  });
  const directoriesQuery = useQuery({
    queryKey: ["directories"],
    queryFn: () => api.directories(),
    enabled: activeView === "manage",
  });
  const segmentsQuery = useInfiniteQuery({
    queryKey: ["segments", "workspace"],
    queryFn: ({ pageParam }) =>
      api.segments({ scanStatus: "indexed", limit: 1000, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page) =>
      page.offset + page.items.length < page.total
        ? page.offset + page.items.length
        : undefined,
    refetchInterval: 10000,
  });
  const timelineQuery = useQuery({
    queryKey: ["timeline", sourceId, date],
    queryFn: () => api.timeline(sourceId, date),
    enabled: Boolean(sourceId),
    refetchInterval: 10000,
  });
  const exportsQuery = useQuery({
    queryKey: ["exports"],
    queryFn: api.exports,
    refetchInterval: 2500,
  });
  const statusQuery = useQuery({
    queryKey: ["systemStatus"],
    queryFn: api.status,
    refetchInterval: 15000,
  });
  const scanJobsQuery = useQuery({
    queryKey: ["scanJobs"],
    queryFn: () => api.scanJobs(),
    refetchInterval: 5000,
  });
  const failedQuery = useQuery({
    queryKey: ["segments", sourceId, "failed"],
    queryFn: () => api.segments({ sourceId, scanStatus: "failed", limit: 8 }),
    enabled: activeView === "manage" && Boolean(sourceId),
  });
  const speechJobsQuery = useQuery({
    queryKey: ["transcriptionJobs"],
    queryFn: () => api.getTranscriptionJobs(),
    refetchInterval: 3000,
  });
  const visionJobsQuery = useQuery({
    queryKey: ["visionJobs"],
    queryFn: () => api.getVisionJobs(),
    refetchInterval: 3000,
  });
  const sources = sourcesQuery.data?.items ?? [];
  const selectedSource = sources.find((source) => source.id === sourceId);
  const exports = exportsQuery.data?.items ?? [];
  const rawSegments = useMemo(
    () => segmentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [segmentsQuery.data],
  );
  const segments = useMemo(
    () =>
      rawSegments
        .map(toDisplaySegment)
        .filter((segment): segment is DisplaySegment => Boolean(segment)),
    [rawSegments],
  );
  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  );
  const daySegments = useMemo(
    () =>
      (timelineQuery.data?.segments ?? []).map((segment) => ({
        ...segment,
        sourceId,
        filename: rawSegments.find((item) => item.id === segment.id)?.filename,
      })),
    [timelineQuery.data, sourceId, rawSegments],
  );
  const latest = segments.find((segment) => segment.sourceId === sourceId);
  const selectedSegment =
    daySegments.find((segment) => segment.id === selectedId) ??
    daySegments.at(-1) ??
    null;
  const activeJobs =
    exports.filter((job) => ["queued", "running"].includes(job.status)).length +
    (speechJobsQuery.data?.items ?? []).filter((job) =>
      ["pending", "processing"].includes(job.status),
    ).length +
    (visionJobsQuery.data?.items ?? []).filter((job) =>
      ["pending", "processing"].includes(job.status),
    ).length;
  const speechStatuses = useMemo(() => {
    const map = new Map<
      string,
      "pending" | "processing" | "completed" | "failed"
    >();
    for (const job of speechJobsQuery.data?.items ?? [])
      if (!map.has(job.segmentId)) map.set(job.segmentId, job.status);
    return map;
  }, [speechJobsQuery.data]);

  function notify(text: string, url?: string | null) {
    setMessage(text);
    setDownloadUrl(url ?? null);
    setToastOpen(false);
    window.setTimeout(() => setToastOpen(true), 0);
  }
  async function refreshAll() {
    await Promise.all(
      [
        "sources",
        "segments",
        "timeline",
        "exports",
        "scanJobs",
        "systemStatus",
        "transcriptionJobs",
        "visionJobs",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  }
  function changeSource(id: string) {
    setSourceId(id);
    setSelectedId("");
    setSeekRequest(null);
    localStorage.setItem(selectedSourceStorageKey, id);
  }
  function openSegment(
    segment: DisplaySegment,
    time?: number,
    tab: "transcript" | "details" = "transcript",
  ) {
    initialSource.current = segment.sourceId;
    if (segment.sourceId !== sourceId) changeSource(segment.sourceId);
    const start = new Date(segment.startTime);
    setDate(localDay(start));
    setHour(start.getHours());
    setSelectedId(segment.id);
    setInspectorTab(tab);
    setSeekRequest({
      segmentId: segment.id,
      seconds: Math.max(0, Math.min(segment.durationSeconds, time ?? 0)),
      key: Date.now(),
    });
    setActiveView("playback");
  }
  function exportSegments(items: DisplaySegment[]) {
    if (!items.length) return;
    if (new Set(items.map((item) => item.sourceId)).size > 1) {
      notify("合并导出请选择同一个录像源的片段");
      return;
    }
    setExportSelection({
      sourceId: items[0].sourceId,
      startMs: Math.min(
        ...items.map((item) => new Date(item.startTime).getTime()),
      ),
      endMs: Math.max(...items.map((item) => new Date(item.endTime).getTime())),
      segmentIds: items.map((item) => item.id),
    });
  }
  const scanMutation = useMutation({
    mutationFn: api.scanSource,
    onSuccess: () => {
      notify("扫描任务已创建");
      void refreshAll();
    },
    onError: (error) => notify(queryMessage(error, "扫描失败")),
  });
  const createSourceMutation = useMutation({
    mutationFn: api.createSource,
    onSuccess: (created) => {
      changeSource(created.id);
      setSourceName("");
      notify(`已添加录像源 ${created.name}`);
      void refreshAll();
    },
    onError: (error) => notify(queryMessage(error, "创建录像源失败")),
  });
  const updateSourceMutation = useMutation({
    mutationFn: ({ id, ...payload }: Partial<Source> & { id: string }) =>
      api.updateSource(id, payload),
    onSuccess: () => {
      notify("录像源配置已保存");
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error) => notify(queryMessage(error, "保存失败")),
  });
  const deleteSourceMutation = useMutation({
    mutationFn: api.deleteSource,
    onSuccess: () => {
      notify("录像源已删除");
      void refreshAll();
    },
    onError: (error) => notify(queryMessage(error, "删除失败")),
  });
  const exportMutation = useMutation({
    mutationFn: api.createExport,
    onSuccess: (result) => {
      setWatchedExports((ids) => [...ids, result.exportId]);
      void queryClient.invalidateQueries({ queryKey: ["exports"] });
    },
  });

  useEffect(() => {
    if (!sources.length) return;
    if (!sources.some((source) => source.id === sourceId))
      changeSource(sources[0].id);
  }, [sourcesQuery.data]);
  useEffect(() => {
    if (!latest || initialSource.current === sourceId) return;
    initialSource.current = sourceId;
    const start = new Date(latest.startTime);
    setDate(localDay(start));
    setHour(start.getHours());
    setSelectedId(latest.id);
  }, [latest?.id, sourceId]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    localStorage.setItem("clipline.activeView", activeView);
  }, [activeView]);
  useEffect(() => {
    const completed = exports.find(
      (job) =>
        watchedExports.includes(job.id) &&
        ["completed", "failed"].includes(job.status),
    );
    if (!completed) return;
    notify(
      completed.status === "completed"
        ? "导出已完成，可以下载"
        : `导出失败：${completed.errorMessage ?? "请查看任务"}`,
      completed.downloadUrl,
    );
    setWatchedExports((ids) => ids.filter((id) => id !== completed.id));
  }, [exportsQuery.data, watchedExports]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <Toast.Provider duration={5000}>
      <div className={`workspaceApp surveillanceWorkspace view-${activeView}${collapsed ? " navCollapsed" : ""}`}>
        <aside className="workspaceSidebar">
          <button
            className="workspaceBrand"
            aria-label="Clipline 首页"
            onClick={() => setActiveView("playback")}
          >
            <img src="/clipline-logo.svg" alt="" />
            <span>
              Clipline<small>录像工作台</small>
            </span>
          </button>
          <span className="workspaceNavLabel">工作空间</span>
          <nav aria-label="主导航">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                aria-label={label}
                title={label}
                aria-current={activeView === key ? "page" : undefined}
                className={activeView === key ? "active" : ""}
                onClick={() => setActiveView(key)}
              >
                <Icon
                  size={21}
                  weight={activeView === key ? "fill" : "regular"}
                />
                <span>{label}</span>
                {key === "tasks" && activeJobs > 0 && <em>{activeJobs}</em>}
              </button>
            ))}
          </nav>
          <div className="workspaceSources">
            <span className="workspaceNavLabel">
              录像源 <small>{sources.length}</small>
            </span>
            {sources.slice(0, 5).map((source) => (
              <button
                key={source.id}
                className={sourceId === source.id ? "selected" : ""}
                title={source.name}
                onClick={() => {
                  changeSource(source.id);
                  setActiveView("playback");
                }}
              >
                <i className={source.enabled ? "enabled" : ""} />
                <span>
                  {source.name}
                  <small>{source.segmentCount} 个片段</small>
                </span>
              </button>
            ))}
          </div>
          <div className="workspaceSidebarFooter">
            <div>
              <HardDrives size={21} />
              <span>
                <strong>本地录像库</strong>
                <small>
                  {sources
                    .reduce((sum, source) => sum + source.segmentCount, 0)
                    .toLocaleString()}{" "}
                  个片段已索引
                </small>
              </span>
              <i
                className={
                  statusQuery.data?.database.available ? "enabled" : ""
                }
              />
            </div>
            <footer>
              <span>本地工作空间</span>
              <button
                aria-label={collapsed ? "展开导航" : "折叠导航"}
                onClick={() => setCollapsed((value) => !value)}
              >
                <SidebarSimple size={18} />
              </button>
            </footer>
          </div>
        </aside>
        <div className="workspaceBody">
          <header className="workspaceTopbar">
            <div>
              Clipline
              <CaretRight size={13} />
              <strong>
                {navItems.find((item) => item.key === activeView)?.label}
              </strong>
            </div>
            <button
              className="workspaceSearchTrigger"
              aria-label="全局搜索"
              onClick={() => setSearchOpen(true)}
            >
              <MagnifyingGlass size={17} />
              <span>搜索字幕、片段或标签</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="workspaceAvatar" title="本地工作空间">
              CL
            </span>
          </header>
          <main ref={mainRef} className="workspaceMain">
            {(sourcesQuery.isError || segmentsQuery.isError) && (
              <div className="workspaceConnectionError" role="alert">
                <strong>录像库暂时无法加载</strong>
                <span>
                  {queryMessage(
                    sourcesQuery.error || segmentsQuery.error,
                    "请检查后端连接",
                  )}
                </span>
                <button
                  className="workButton"
                  onClick={() => void refreshAll()}
                >
                  重试连接
                </button>
              </div>
            )}
            {activeView === "playback" && (
              <PlaybackWorkbench
                sources={sources}
                sourceId={sourceId}
                date={date}
                hour={hour}
                segments={daySegments}
                segment={selectedSegment}
                rawSegment={rawSegments.find(
                  (item) => item.id === selectedSegment?.id,
                )}
                seekRequest={seekRequest}
                inspectorTab={inspectorTab}
                statuses={speechStatuses}
                loading={
                  (Boolean(sourceId) && timelineQuery.isPending) ||
                  sourcesQuery.isPending
                }
                error={timelineQuery.error}
                scanning={scanMutation.isPending}
                latest={latest}
                onSourceChange={changeSource}
                onDateChange={(value) => {
                  setDate(value);
                  setSelectedId("");
                  setSeekRequest(null);
                }}
                onHourChange={setHour}
                onOpen={openSegment}
                onExport={(selection) => setExportSelection(selection)}
                onScan={() => sourceId && scanMutation.mutate(sourceId)}
                onRefresh={() => void refreshAll()}
                onLibrary={() => setActiveView("clips")}
                onManage={() => {
                  setManageSection("sources");
                  setActiveView("manage");
                }}
                onNotify={notify}
              />
            )}
            {activeView === "clips" && (
              <>
                <ClipLibraryView
                  segments={segments}
                  sourceNames={sourceNames}
                  selectedId={selectedId}
                  onOpenPlayback={openSegment}
                  onExportSegments={exportSegments}
                  onNotify={notify}
                />
                {segmentsQuery.hasNextPage && (
                  <div className="workspaceLoadMore">
                    <button
                      className="workButton"
                      disabled={segmentsQuery.isFetchingNextPage}
                      onClick={() => void segmentsQuery.fetchNextPage()}
                    >
                      {segmentsQuery.isFetchingNextPage
                        ? "正在加载…"
                        : `加载更多片段 · 已显示 ${segments.length.toLocaleString()} / ${segmentsQuery.data?.pages[0].total.toLocaleString()}`}
                    </button>
                  </div>
                )}
              </>
            )}
            {activeView === "tasks" && (
              <TaskCenterView
                exports={exports}
                exportError={exportsQuery.error}
                segments={segments}
                sourceNames={sourceNames}
                onSelectSegment={(segment, kind) =>
                  openSegment(
                    segment,
                    0,
                    kind === "vision" ? "details" : "transcript",
                  )
                }
                onNotify={notify}
              />
            )}
            {activeView === "manage" && (
              <div className="workspaceManagement">
                <aside className="workspaceManageNav">
                  <span>工作区</span>
                  <h1>管理</h1>
                  <nav aria-label="系统管理">
                    {(
                      [
                        { key: "sources", label: "录像源", icon: VideoCamera },
                        { key: "logs", label: "日志", icon: FileText },
                        { key: "settings", label: "设置", icon: Gear },
                      ] as const
                    ).map(({ key, label, icon: Icon }) => (
                      <button
                        className={manageSection === key ? "active" : ""}
                        key={key}
                        onClick={() => setManageSection(key)}
                      >
                        <Icon size={18} />
                        {label}
                        <CaretRight size={13} />
                      </button>
                    ))}
                  </nav>
                  {manageSection === "settings" && (
                    <nav className="workspaceSettingsNav" aria-label="设置分类">
                      {SETTINGS_TABS.map(({ key, label, icon: Icon }) => (
                        <button
                          key={key}
                          className={settingsTab === key ? "active" : ""}
                          onClick={() => setSettingsTab(key)}
                        >
                          <Icon size={16} />
                          {label}
                        </button>
                      ))}
                    </nav>
                  )}
                  <div className="workspaceManageNote">
                    <HardDrives size={20} />
                    <strong>本地工作区</strong>
                    <p>管理录像目录与处理方式。</p>
                    <button
                      onClick={() => {
                        setManageSection("settings");
                        setSettingsTab("overview");
                      }}
                    >
                      查看系统概览
                      <CaretRight size={13} />
                    </button>
                  </div>
                </aside>
                <section className="workspaceManageContent">
                  {manageSection === "sources" && (
                    <SourceStage
                      sources={sources}
                      segments={segments}
                      selectedId={sourceId}
                      directories={directoriesQuery.data?.items ?? []}
                      directoryRoot={directoriesQuery.data?.root ?? ""}
                      sourceName={sourceName}
                      sourcePath={sourcePath}
                      sourceScanInterval={sourceScanInterval}
                      scanJobs={scanJobsQuery.data?.items ?? []}
                      creating={createSourceMutation.isPending}
                      scanning={scanMutation.isPending}
                      onSelect={changeSource}
                      onScan={(id) => scanMutation.mutate(id)}
                      onCreate={() =>
                        createSourceMutation.mutate({
                          name:
                            sourceName.trim() || `录像源 ${sources.length + 1}`,
                          path: sourcePath,
                          scanIntervalMinutes: sourceScanInterval,
                        })
                      }
                      onNameChange={setSourceName}
                      onPathChange={setSourcePath}
                      onIntervalChange={setSourceScanInterval}
                      onToggle={(id, enabled) =>
                        updateSourceMutation.mutate({ id, enabled })
                      }
                      onScheduleChange={(id, scanIntervalMinutes) =>
                        updateSourceMutation.mutate({ id, scanIntervalMinutes })
                      }
                      onRecognitionChange={(id, payload) =>
                        updateSourceMutation.mutate({ id, ...payload })
                      }
                      onSave={(id, payload) =>
                        updateSourceMutation.mutate({ id, ...payload })
                      }
                      onDelete={(id) => deleteSourceMutation.mutate(id)}
                    />
                  )}
                  {manageSection === "logs" && (
                    <LogsStage
                      sources={sources}
                      segments={segments}
                      scanJobs={scanJobsQuery.data?.items ?? []}
                      exports={exports}
                      failedSegments={failedQuery.data?.items ?? []}
                      onRefresh={() => void refreshAll()}
                      busy={scanJobsQuery.isFetching}
                    />
                  )}
                  {manageSection === "settings" && (
                    <SettingsPage
                      sources={sources}
                      status={statusQuery.data ?? null}
                      onRefresh={() => void refreshAll()}
                      busy={statusQuery.isFetching}
                      activeTab={settingsTab}
                      onTabChange={setSettingsTab}
                      onOpenSources={() => setManageSection("sources")}
                      embedded
                    />
                  )}
                </section>
              </div>
            )}
          </main>
        </div>
        {searchOpen && (
          <WorkspaceSearch
            segments={segments}
            sourceNames={sourceNames}
            onOpen={openSegment}
            onClose={() => setSearchOpen(false)}
            onNotify={notify}
          />
        )}
        {exportSelection && (
          <RecordingExportDialog
            selection={exportSelection}
            segments={[
              ...segments,
              ...daySegments.filter(
                (item) => !segments.some((segment) => segment.id === item.id),
              ),
            ]}
            sourceName={sourceNames.get(exportSelection.sourceId) ?? "录像源"}
            onClose={() => setExportSelection(null)}
            onCreate={async (payload) => {
              await exportMutation.mutateAsync(payload);
            }}
            onTasks={() => {
              setExportSelection(null);
              setActiveView("tasks");
            }}
          />
        )}
      </div>
      <Toast.Root
        className="workspaceToast"
        open={toastOpen}
        onOpenChange={setToastOpen}
      >
        <CheckCircle size={20} />
        <Toast.Description>{message}</Toast.Description>
        {downloadUrl && (
          <Toast.Action asChild altText="下载导出文件">
            <a href={downloadUrl}>下载</a>
          </Toast.Action>
        )}
        <Toast.Close aria-label="关闭提示">
          <X size={16} />
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="workspaceToastViewport" />
    </Toast.Provider>
  );
}

function localDay(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
