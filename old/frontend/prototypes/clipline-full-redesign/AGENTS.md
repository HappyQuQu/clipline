# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## September 2026 redesign

- The user explicitly rejected the previous prototype and requested a fresh redesign on 2026-09-08. Older visual-alignment restrictions do not apply to this iteration.
- The current entry is `src/Workspace.jsx`: a light, restrained video archive workbench with a dark player, compact source/date controls, a single contextual export flow, and a collapsible transcript/details panel.
- Preserve the product boundary: recorded files in a NAS directory, not a live-camera/NVR product. Keep source files read-only. Export skips recording gaps.
- This is an interactive frontend prototype. Keep demo data and simulated playback/task behavior identifiable; do not imply a backend export or model download happened.
- Keep the four primary areas: 回看、片段库、任务、管理. Search should link directly to a clip and timestamp. All main controls must provide meaningful interactions.
