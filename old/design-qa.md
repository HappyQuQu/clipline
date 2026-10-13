# Clipline — UniFi-inspired playback and range downloads

Final result: passed

## Follow-up pass — playback and library reference alignment

Final result: passed. This pass implements the user's follow-up to use the UniFi references for both 回看 and 片段库.

### Visual truth and comparison

- Playback source: `/var/folders/21/hjbt152d0vs3n8td7233xd8r0000gn/T/codex-clipboard-4f77cbb1-f352-4a7b-9c66-82bda2325680.png` (1827 × 868; includes surrounding frame/padding). Library source: `/var/folders/21/hjbt152d0vs3n8td7233xd8r0000gn/T/codex-clipboard-eca8795d-7f91-46d6-ae7a-7e7eaf78f22b.png` (1920 × 962; includes Chrome UI). Range-management source: `/var/folders/21/hjbt152d0vs3n8td7233xd8r0000gn/T/codex-clipboard-3587e895-eaae-4ce2-baa6-b2762f8a03d5.png` (1920 × 850).
- Final implementation screenshots, 1920 × 850 CSS/pixels, 1× density: `clipline-reference-pass2-playback.png`, `clipline-reference-pass2-library.png`, and `clipline-reference-pass2-manage.png` in the screenshot directory below.
- Source and rendered playback were included in one comparison input. Source and final library were included in another combined comparison input. Chrome chrome and outer screenshot padding were excluded conceptually from the layout assessment, not counted as application drift. These are intentionally reference-inspired, not exact pixel clones; the source video, dates, counts and branding differ.
- Focused inspection covered date navigation, camera selector, timeline count/playhead, library overlays and the four display switches. Full-resolution comparisons and DOM state/geometry were used. An attempted clipped screenshot was unusable and is not QA evidence.

### Required fidelity surfaces

- Typography: retained system/PingFang fallbacks and compact 10–12px secondary labels, with 15px library heading; no new display type. Source/date/status overlay text remains readable on dark translucent surfaces.
- Spacing: removed the separate playback heading/filter row; date navigation now belongs to the left timeline and camera selection belongs above the video. At 1920px the video starts at y=98 instead of y=142. Narrow rail, restrained borders/radii and dense thumbnail spacing remain aligned with the reference intent.
- Colors: retained blue selection/playhead, white/neutral-gray controls, dark video background and light borders. No new gradients or decorative effects.
- Images: preserved real source thumbnails/video, object-fit containment for playback, compact thumbnail crops for the archive, and the supplied Clipline logo. No invented confidence percentages or fabricated surveillance imagery.
- Content: display switches say 摄像头、时间、识别状态、时长; supported density values are 紧凑/宽松. Timeline count now reports recordings intersecting the visible time range instead of the full day. Unsupported UniFi operations remain omitted.

### Interaction and responsive verification

- Date forward control changes 2026-06-02 to 2026-06-03; back restores the selected date. Range management still opens and closes inside playback.
- All four overlay checkboxes work. With all unchecked: no camera/time label remains, and computed display for duration and recognition status is `none`; all 123 recordings remain.
- At 1920px compact grid has 8 columns (193.25px); comfortable has 6 (260px). List view disables the density selector. Restoring grid and checked overlays returns the expected default view.
- Enter on a clip opens its actual details. Batch selection exposes its action bar and cancellation clears the selection without creating recognition/export jobs.
- At 375px both filter dropdowns now occupy 151px, not 20px. The mobile drawer is visible, scrollable, and has actual preview/recognition/export content. Escape closes it and returns focus to the originating clip.
- At 768px archive columns remain usable; management video width is 669px. At 1024px management video width is 925px. Document scrollWidth equals viewport width at 375/768/1024/1920.
- Responsive evidence: `clipline-reference-pass2-mobile-playback.png`, `clipline-reference-pass2-mobile-library.png`, `clipline-reference-pass2-mobile-detail.png`, `clipline-reference-pass2-tablet-library.png`, `clipline-reference-pass2-tablet-manage.png`.
- Browser console check returned no captured warning/error entries. Production TypeScript/Vite Docker build and `git diff --check` passed; health endpoint remains OK.

### Iteration history

- [P2, resolved] Playback's duplicate top row reduced camera space and placed date navigation away from the timeline. Moved the date control into the timeline and source selection into the viewer heading; recaptured final desktop playback.
- [P2, resolved] Legacy mobile CSS set dropdown width to zero, leaving only arrows. Added a specific full-width select override; final mobile screenshot and 151px geometry confirm readable controls.
- [P1, resolved] Legacy responsive CSS hid clip details entirely. Explicitly render the inspector, use an on-demand fixed drawer below 1024px, focus its close control, and restore origin focus on close/Escape. Final mobile-detail screenshot verifies the result.
- No actionable P0/P1/P2 remain in this pass. Native date-calendar typing and larger browser text zoom were not newly tested; previous export/codec regression results below still apply, with no backend changes in this follow-up.

Reviewed on 2026-10-09 against the three UniFi screenshots supplied by the user. This is a reference-inspired implementation in the existing application, not a pixel-exact UniFi clone.

## Scope and source of truth

- Running implementation: http://127.0.0.1:8083/ (Docker, real API and local recordings).
- Camera source: `/Volumes/extended/clipline/media/XiaomiCamera_00_B88880972E7E`; 123 indexed recordings.
- Retained Clipline branding, existing Phosphor icons, actual camera thumbnails and playback. No generated surveillance images or simulated LIVE state.
- Reference image 3 and implementation were inspected together at 1920 × 850. Reference image 2 and the 1920 × 850 library screenshot were also inspected together; its browser chrome was intentionally excluded from application-layout assessment.
- Intentional differences: compact application heading/date toolbar; real available video instead of the reference's missing-video error; only supported download operations, without decorative archive/delete controls.

## Evidence

Screenshots reside in `/Users/qu/.codex/visualizations/2026/08/04/019fcc78-5ba5-7fa2-9b60-36c233689d27/`:

- `clipline-unifi-manage-desktop.png`: final 1920 × 850 management view.
- `clipline-unifi-library-desktop.png`: 1920 × 850, eight-column real thumbnail grid.
- `clipline-unifi-manage-ready.png`: file-ready state following the real 8-second export.
- `clipline-unifi-tablet.png`: corrected 768 × 900 camera-first stacked layout.
- `clipline-unifi-tablet-1024.png`: 1024 × 768 playback/range layout.
- `clipline-unifi-mobile.png` and `clipline-unifi-mobile-range.png`: 375 × 844 playback and scrolled range-download panel.

## Interactions verified

- Timeline-bottom 管理 opens in-page range controls; video remains visible on desktop. Close returns to normal playback.
- Start/end time inputs commit with Enter; duration and available-recording coverage update.
- Keyboard and pointer movement of the end handle update the selected range. Dragging the tested end handle moved 09:35:56 to 09:36:35.
- Empty 09:58–09:59 selection shows no available footage and disables download.
- Actual accurate export, 09:35:48–09:35:56: job `exp_db42c514e2e1417e` completed; browser downloaded `/Users/qu/Downloads/回看区间验证-8秒.mp4`. ffprobe confirmed 8.020 seconds, 3840 × 2160 H.264 and AAC, 8,364,469 bytes.
- Existing interrupted export is now failed with an actionable restart message, not permanently running. Media conversion threads are bounded.
- Library recognition filter produces the actual one recognized recording; clearing restores 123. Grid/list switching was exercised. Date-filter keyboard/native-calendar behavior was not independently revalidated in this pass.
- Playback video readyState = 4; real browser-compatible playback proxy remains available.
- At 375, 768, 1024 and 1920 CSS pixels, document scrollWidth equals viewport width. Mobile range actions remain reachable by vertical scrolling; tablet video uses full available width (669px at 768, 925px at 1024).

## Findings resolved

- Invisible play icon: corrected explicit icon color.
- Short-range boundary labels overlapping: offset start/end labels to opposite edges.
- Full-hour management selection too compressed: automatically use a stable 5-minute range window.
- Repeated minute labels: reduced 5-minute ruler ticks.
- Library filter labels collapsing: fixed flex sizing and label wrapping.
- Mobile breadcrumb wrapping: prevent shrinking and let search consume remaining space.
- Tablet management squeezing video into the timeline column: use a full-width video row and timeline/range row below.
- Backend limit mismatch: removed hardcoded client duration limit; configured server validation supplies the actual limit and error.

No actionable P0/P1/P2 findings remain within the reviewed playback, range-download and library layout scope. Global system-management pages were preserved, not redesigned in this pass.

## Engineering checks

- Docker production frontend TypeScript/Vite build passed (existing bundle-size warning only).
- `git diff --check` passed.
- Export contract regression: 7 tests passed, isolated temporary database.
- Isolated mutation smoke passed source scanning/update, settings persistence, fast/accurate exports, HEVC/Opus playback proxy and HTTP Range 206; recognition failure reporting and model lifecycle constraints were also exercised without touching the user's source files.
- Docker health: `{ "ok": true }`.
