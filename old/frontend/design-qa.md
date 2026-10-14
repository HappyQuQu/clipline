# Clipline formal frontend — Design QA

## Comparison target

- Current source visual truth: running prototype at `http://127.0.0.1:5175/` from `/Users/qu/Documents/GitHub/clipline/frontend/prototypes/clipline-full-redesign`.
- Browser-rendered implementation: `http://127.0.0.1:5174/`, connected to the real local Clipline backend.
- Eight 1440px combined comparisons: `m7-playback-comparison-1440-pass2.png`, `m7-library-comparison-1440-pass3.png`, `m7-tasks-comparison-1440.png`, `m7-sources-comparison-1440.png`, `m7-logs-comparison-1440.png`, `m7-settings-overview-comparison-1440.png`, `m7-export-settings-comparison-1440-pass2.png`, `m7-models-comparison-1440-pass2.png` under `/Users/qu/Documents/GitHub/clipline/docs/full-redesign-implementation-qa/`.
- Responsive evidence: source/formal playback pairs at 1180 × 900, 900 × 900, 660 × 900 and 390 × 844; normalized mobile comparisons are `m7-playback-comparison-390.png`, `m7-library-comparison-390-pass5.png` and `m7-search-comparison-390.png`. Library also has overflow checks at 900 × 900 and 660 × 900.
- Density normalization: device scale factor 1×. The prototype mobile screenshot excluded a 15px scrollbar and 32px bottom browser inset despite reporting a 390 × 844 CSS viewport, so it was padded—not scaled—to 390 × 844 before comparison.
- State: real `xiaomi` source, 2026-06-02, selected 09:30 clip/library item, populated tasks and management data.

## Findings

- No actionable P0/P1/P2 visual findings remain.
- No separate media deployment blocker remains: H.264/AAC is streamed directly, while HEVC/Opus now receives a cached H.264/AAC browser proxy without modifying the source file. The isolated real-API regression verifies both codec paths; first-play proxy generation time remains workload-dependent.

## Required fidelity surfaces

- Fonts and typography: system/PingFang stack, hierarchy and weights are aligned closely across all eight comparisons; Export and Model Management now use the prototype heading, card and table scales.
- Spacing and layout rhythm: topbar, 78px rail, management hierarchy, full-bleed playback viewer/timeline, mobile bottom navigation, library toolbar/cards, Export groups and Model Management table now follow the current prototype.
- Colors and visual tokens: blue, neutral surfaces, borders and semantic states match the prototype direction; disabled and error states remain distinguishable.
- Image quality and asset fidelity: the formal app now uses the prototype's exact v2 Clipline SVG; real segment thumbnails are used without placeholder art. Playback poster fallback preserves the real thumbnail when decoding fails. All interface icons now come from Phosphor.
- Copy and content: primary navigation, management hierarchy and seven settings categories match. Dynamic task/source/log values intentionally come from the real backend rather than prototype mock counts.

## Full-view comparison evidence

All eight 1440px baseline states now have same-viewport combined images. Playback, library, tasks, sources, logs, overview, Export and Model Management preserve the same major-region hierarchy. Core mutation paths pass against an isolated real API fixture, and compatible-media playback now has dynamic same-state evidence at 1440 and 390px.

## Focused region comparison evidence

Playback viewer/timeline, library selected card/inspector/batch bar, task rows/summary cards, source detail, log table, settings health strip, export cards and model rows were inspected from the combined images. Mobile playback was separately normalized and compared at 390 × 844; the first comparison exposed a two-column overflow bug and excess timeline height, both of which were fixed and recaptured.

## Primary interactions tested

- Four-item primary navigation.
- Management navigation: 录像源、日志、设置.
- Seven settings categories are present and reachable.
- Global search focus, clear action and keyboard shortcut remain reachable.
- Playback previous/next-day controls update the real date state and return correctly.
- Playback fast/accurate export modes can be switched without leaving the page.
- Playback DOM exposes previous/next segment navigation, gap legend, horizontal timeline and labeled play/export controls.
- Library grid/list controls switch the rendered layout while preserving filter state.
- Topbar search opens inline, exposes loading/empty/error states and no longer navigates to an independent search page.
- Task navigation opens the unified page; all five status filters preserve their state during recognition-job polling.
- Task DOM exposes the prototype header, cleanup-disabled backend constraint, unified columns, API error/empty state and three summary cards.
- Management navigation exposes one active second-level item and one active settings category; all seven settings categories are reachable.
- Sources expose search, status filtering, create-directory form, scan actions, selected-row detail and preserved draft inputs.
- Logs expose keyword/type/source/date filters and client-side CSV export for currently filtered real events.
- Settings overview opens the real source page; model filters switch between all/downloaded/missing without leaving the category.
- Settings drafts remain dirty across category switches; the shared sticky bar restores loaded values without issuing a backend mutation.
- Diagnostics calls the real status endpoint and exposes real system-log reading/download; unavailable endpoints surface an inline error.
- About exposes the real version/environment state plus valid repository and API documentation links.
- Browser DOM contains the intended semantic banner, navigation and labeled controls.
- Playback, library, task, source and log surfaces expose explicit loading, empty, error, expired/unavailable and partial-failure states instead of blank or permanent-loading bodies.
- Clip cards and task rows are keyboard operable; view/status switches expose pressed state; tables, cells and progress indicators expose semantic roles and values.
- Directory, management and export dialogs trap focus, close with Escape and restore focus to their trigger; all focusable controls receive a visible blue focus ring.
- Desktop and mobile target-size rules enforce 36px and 44px minimum controls, and reduced-motion preferences disable non-essential motion.
- Production build completed successfully.
- An isolated H.264/AAC fixture now verifies real source create/update/rescan/delete, settings persistence, fast/accurate export completion and download, recognition job terminal/error states, and invalid model-delete protection without touching configured user data.

## Console verification

The earlier 5173 preview was connected to the wrong API target and returned `resource_not_found`; it is no longer used as evidence. A fresh 5174 browser tab connected to the real local backend, waited through polling, and reported no console error or warning. TypeScript/Vite build, backend `compileall`, all four existing prototype worker tests, and the isolated mutation smoke test pass.

## Comparison history

### Pass 14 — HEVC/Opus playback capability

- Added an on-demand, source-safe playback proxy for indexed segments marked `needsTranscode`; compatible H.264/AAC files keep using direct byte-range streaming.
- The proxy cache identity includes source path, size and modification time, so changed recordings cannot reuse stale media. Source deletion and scan/retention cleanup remove matching proxies.
- Extended the isolated real-API mutation regression with an actual HEVC/Opus fixture. The stream endpoint output is verified by ffprobe as H.264/AAC, and the proxy is removed with its source.
- This closes the codec blocker recorded during Pass 13 without changing the passed prototype-alignment surface.

### Pass 9 — M7 real-data visual regression

- Corrected the QA environment: 5174 is the formal frontend connected to the real Clipline backend; 5175 is the current full-redesign prototype. The stale 5173 empty-state preview is excluded from final evidence.
- Captured all eight baseline states at 1440 × 1024 and generated side-by-side comparison artifacts for playback, library, tasks, sources, logs, overview, export settings and model management.
- Fixed async default-state bugs so the first real source and newest indexed date populate playback and library instead of showing a misleading current-date empty state.
- Replaced the old square brand mark with the prototype's exact v2 Clipline SVG.
- Reworked playback composition to the prototype's full-bleed desktop viewer/timeline, added the real thumbnail poster for unsupported codecs, and reduced excess card/margin treatment.
- At 390px, found and fixed a P0 two-column playback squeeze caused by cascade order; then compacted source/date controls and timeline actions so player, range and clip strip remain visible. Verified 390/660/900/1180/1440 with no page-level horizontal overflow.
- Task, source, log and overview comparisons have no remaining P0/P1 structural mismatch. Export settings and Model Management remain actionable P1 findings; the mixed icon library and library-toolbar density remain P2.

### Pass 10 — Export and Model Management alignment

- Rebuilt Export settings into the prototype's two large left-description/right-control groups, retained the sticky save bar and kept every visible editable value mapped to a real backend setting.
- Kept unsupported prototype settings honest: default export mode is read-only because mode is selected per task; cache cap and cleanup toggle are not fabricated. Server staging and browser-download semantics remain explicit.
- Replaced the compact model strip/list with three summary cards, a full-width descriptive ASR table, prototype filter tabs and a separate vision-status card.
- Preserved real model cache bytes, downloaded state, download polling, delete restrictions and real vision path/device/availability; no fake vision reload or download action was introduced.
- Recaptured both screens at 1440 × 1024 and compared them side by side in `m7-export-settings-comparison-1440-pass2.png` and `m7-models-comparison-1440-pass2.png`. The earlier Export/Model P1 hierarchy findings are resolved; dynamic counts, sizes and unsupported-field omissions are intentional real-backend differences.

### Pass 11 — Library toolbar and icon unification

- Recaptured the current running prototype instead of reusing the older library reference, then matched the exact populated interaction state: `xiaomi`, 2026-06-02, selected 09:30 card and one checked item.
- Reduced the library toolbar to the prototype's five visible controls: unified filename/tag/subtitle search, source, recognition state, one date and grid/list switch.
- Preserved the removed visual-label dropdown capability by folding real filename, source name, detected label and subtitle matching into the single prototype search field; the date control now applies one real day to both API bounds.
- Aligned card and inspector copy to the prototype's minute labels, full time range, `MM:SS` duration and full Chinese date.
- Replaced every remaining Lucide import with Phosphor, removed emoji status/icon substitutes from legacy helpers and removed `lucide-react` from the package and lockfile.
- The same-viewport comparison `m7-library-comparison-1440-pass3.png` resolves the earlier library-toolbar density P2; repository search confirms no Lucide import or dependency remains.
- A first 390px comparison exposed a wrapped toolbar, duplicate primary action and missing cancel action. The mobile rules now match the prototype's one-line scrollable toolbar, title/export header and cancel/merge selection bar; the normalized post-fix evidence is `m7-library-comparison-390-pass5.png`.
- Formal library `documentElement.scrollWidth` equals the viewport at 900, 660 and 390px, so the scrollable toolbar remains locally contained without page-level overflow.

### Pass 12 — Isolated mutation regression and mobile search

- Added `backend/tests/mutation_smoke.py`, which boots a temporary real backend around a generated H.264/AAC clip and removes its database, outputs and recording directory after the run.
- Verified source create/update/rescan/delete, settings persistence, fast and accurate export completion/download, transcription and vision task creation/terminal error reporting, and invalid model-delete protection.
- Rebuilt the global-search quick result popover around the prototype's three semantic rows: subtitle hit, matching clip and recognition task; every displayed value remains backed by real API data.
- Captured the prototype and formal search state at 390px. The formal popover is 242 × 186.5px at x60/y55.5, `scrollWidth` remains equal to 390px, and the normalized comparison is `m7-search-comparison-390.png`.

### Pass 13 — Compatible-media dynamic playback

- Generated three isolated H.264/AAC segments from the prototype's supplied printer assets and indexed them through a temporary real Clipline backend; configured user data was not read or changed.
- Captured the prototype and formal implementation in the playing state. The formal video reports `readyState=4`, advancing `currentTime`, `paused=false` and `error=null`.
- The first comparison exposed a P1 mismatch: the sidebar selected 09:00–10:00 while the rail rendered 08:41–09:41. The selected display range now drives the real rail window and produces 09:00 through 10:00 ticks.
- Rebuilt the source context hierarchy to match the prototype, then fixed mobile source-column compression, internal viewer scrolling after play-button focus, control-bar composition and clip-card density.
- Final desktop evidence is `m7-playback-comparison-h264-playing-1440-pass4.png`; final normalized mobile evidence is `m7-playback-comparison-h264-playing-390-pass5.png`. Dynamic counts, durations and rail occupancy differ only because the isolated source intentionally contains three short real segments.

### Pass 8 — M6 states, responsive behavior and accessibility

- Completed the four-page state matrix: playback has source/segment/loading/playback/scan failures; library preserves no-result, missing-thumbnail, recognition-failure and partial-batch feedback; tasks expose empty, polling failure, expiration and unavailable-download copy; management/settings retain read/save/model/diagnostic failure states.
- Added explicit 1180, 900, 660 and 390px layout rules covering playback context, library grids, task columns, management navigation, single-column forms, mobile export controls and page-level overflow containment.
- Added a reusable dialog-focus hook with initial focus, Tab trapping, Escape close and trigger restoration, then applied it to directory selection, management and export dialogs.
- Added keyboard activation, pressed/selected state, table/progress semantics, live error/status announcements, named icon controls, visible focus rings, target-size guarantees and `prefers-reduced-motion` handling.
- TypeScript and production build pass after the M6 changes. FR-602 remains formally blocked because the browser compositor cannot produce the required body screenshots at the responsive viewports.

### Pass 7 — M5 settings completion

- Replaced immediate per-control mutations with a shared settings draft provider that maps every supported backend field into one persistent cross-category patch.
- Added the prototype sticky settings footer with dirty, saving, success, error and reset states; browser DOM verified a scan change remains dirty after switching to Export, then resets without a backend write.
- Rebuilt Scan & Index around the actual backend fields for scheduling, file-stability delay, ffprobe concurrency, cleanup and idle scanning; unsupported prototype toggles are deliberately omitted.
- Added real diagnostics using `/api/system/status` and `/api/system/logs`, including a browser-downloadable log text file and explicit inline error feedback when the connected backend lacks the endpoint.
- Rebuilt About with the supplied Clipline logo, actual service state, repository link, API/data documentation and an explicit current license status.
- Production build passes. M5 functionality is complete; formal visual regression remains blocked by the same browser body-compositor issue.

### Pass 6 — M5 management checkpoint

- Kept the prototype management hierarchy and rebuilt the source surface as a page header, search/status toolbar, six-column table and selected-source preview/configuration panel.
- Preserved real directory creation, source enable/disable, scan, schedule, recognition policy, save and delete behavior; source edits remain in local draft state if a backend save fails.
- Replaced the compressed legacy log summary/sidebar with a full-width five-column table backed by scan, export, transcription, vision and file-failure data; added working keyword/type/source/date filters and CSV export.
- Rebuilt settings headers, overview health strip, storage/cache cards and source-scope callout from real status data; separated recognition settings from model management, added vision settings, model filters and current-model delete protection.
- Reworked export settings around real Web semantics: `data/exports` is read-only server staging and download location is controlled by the browser.
- Production build and browser DOM navigation pass. Formal visual comparison remains blocked by the browser compositor, and uniform sticky save lifecycle plus final scan/diagnostics/about alignment remain open.

### Pass 5 — M4 unified task implementation

- Replaced the legacy export-only/N+1 status composition with one normalized row model for export, transcription and vision jobs.
- Aligned the formal page to the prototype header, cleanup action, five status tabs, task/type/source/status/result-more columns and three summary cards.
- Connected completed export downloads, task-specific result/error copy and supported transcription/vision retry actions; cleanup is deliberately disabled because the backend exposes no task-delete API.
- React Query polling updates recognition tasks without resetting the selected status tab; browser DOM interaction verified the filter state.
- Production build passes. Visual QA remains blocked because the browser screenshot compositor omitted the task body and the connected backend did not provide populated recognition jobs.

### Pass 4 — M3 library and global search implementation

- Rebuilt the library around the prototype page header, horizontal filter toolbar, three-column grid/list switch, persistent desktop inspector and bottom multi-select bar.
- Connected real source, date, transcription status, visual-label and subtitle filters; batch transcription, batch vision and same-source merge export remain functional actions.
- Replaced the independent search page with a topbar popover backed by search, suggestions and popular-search APIs; result selection resolves the real segment and seeks to the transcription offset.
- Browser DOM and primary interactions were verified, including grid/list switching and loading/empty/error search states.
- Visual capture is blocked: the in-app browser returned a blank composited body despite visible DOM boxes and successful interactions. The unusable capture is retained at `docs/full-redesign-implementation-qa/m3-library-capture-blocked.jpg` as blocker evidence and is not treated as a visual comparison.
- M3 therefore remains `blocked` for screenshot comparison and responsive visual verification, not for compilation or DOM functionality.

### Pass 3 — M2 interaction completion

- Added real timeline gaps, gap count and legend, previous/next navigation, exact click-to-time seeking and gap feedback.
- Completed the export surface with preview, editable file name and range, fast/accurate modes, gap duration, estimated size, preserved failure input and success navigation.
- Added player loading/error states and clip-strip transcription status plus per-card transcription/export actions.
- Production build passed and the browser DOM exposed the expected playback timeline, navigation, gap legend and export mode controls.
- Final empty-state evidence: `docs/full-redesign-implementation-qa/m2-playback-final.jpg`.
- M2 remains visually blocked only on the unavailable source/segment fixture and unverified 900/660/390 responsive captures; no production mock data was introduced to hide that constraint.

### Pass 2 — M2 playback checkpoint

- Replaced the old vertical canvas rail with the prototype's horizontal recording timeline and a real playback playhead.
- Rebuilt the playback surface as a 250px source context column followed by player, timeline and horizontal clip strip.
- Moved source metadata and playback controls into the video surface, while retaining the real `/api/segments/:id/stream` path and existing playback events.
- Added a draggable blue export selection and kept the existing export panel as a modal layer.
- Captured the browser-rendered empty-data checkpoint at `docs/full-redesign-implementation-qa/m2-playback-empty.jpg`.
- The local backend provides no source/segment fixture, so media-filled comparison, gap behavior and export success remain unverified and are recorded as blockers rather than simulated in production code.

### Pass 1 — M1 checkpoint

- Implemented the 64px topbar, real logo asset, Phosphor shell icons, 78px primary rail, four-item navigation, management hierarchy and seven settings categories.
- Captured the formal implementation at the same 1440 × 1024 viewport as the source.
- P1/P2 findings remain by design because only M1 is in scope for this checkpoint.

## Implementation checklist

- Visual implementation and compatible-media interaction QA are complete.
- Active-model deletion protection, network Whisper Tiny download, real speech inference, real YOLO ONNX person detection, cache deletion and runtime session reload all pass in isolated release checks.

final result: passed
