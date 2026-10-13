# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Prototype direction

- Match the Apple-inspired visual language in `/Users/qu/Documents/GitHub/foliopath/prototypes/apple-redesign`: translucent global chrome, `#F5F5F7` canvas, white elevated cards, SF system typography, restrained blue actions, soft separators, and compact information density.
- This is a style-only redesign. Preserve Clipline's existing deployment, application shell, layout, vertical timeline structure, player/clip-dock split, resize affordance, management-panel placement, and exact menu structure.
- Keep the existing rail menu and labels: 录像回放、片段墙、任务中心、录像源、日志、设置. Do not add, rename, regroup, relocate, or remove menu items.
- Responsive behavior may compress existing regions, but must not replace the rail with a different navigation pattern or redesign the information architecture.
