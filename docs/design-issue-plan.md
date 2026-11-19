# Design issue plan (issues #65–#80)

Issues: #65–#74 and #77–#80, all opened on 2026-11-19. They follow the bug fixes in `docs/bug-fix-model-plan.md` (#53–#62, all merged).

Each issue is already a full spec with its decisions taken, so the builder carries out the plan rather than designing it. Each one gets a fresh builder session at the listed effort. A new **Opus 5.5** session at **high** effort, one that has not seen the build, then reviews it before it is merged.

The split keeps every group of overlapping issues with one builder. Claude takes the 3D scene and its look. Codex takes the pages and their content.

| Issue | What it changes                                                                        | Builder             | Effort | Why                                                                                                                                                                                      | Progress |
| ----- | -------------------------------------------------------------------------------------- | ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| #80   | Show on map: the camera flight centres the finding, is quicker and writes state once   | Claude (Opus 5.5)   | high   | Camera maths and timed browser checks in `CameraRig.tsx`, which #60 just changed. The reported centroid must not move.                                                                   | —        |
| #79   | The pit looks like a real open-pit mine: rock texture, wear, sculpted benches          | Claude (Opus 5.5)   | xhigh  | Shader and texture work judged by eye. Contours and the tint must keep working. Part A changes only what is drawn. Any elevation change goes in a separate PR that re-runs the snapshot. | —        |
| #77   | Surrounding ground and a marked surveyed edge, so the model does not float             | Claude (Opus 5.5)   | high   | New scene geometry beside the terrain. It must take no clicks (#55), stay outside the survey grid and leave the snapshot unchanged.                                                      | —        |
| #72   | The landing model looks like real ground; two states plus two overlay toggles          | Claude (Opus 5.5)   | high   | The 3D look and a new control on the first page people see. It reuses #79's look and changes the date bar from #59.                                                                      | —        |
| #66   | A quieter SIMULATED DATA badge that keeps its label                                    | Codex               | low    | A small CSS change. The honesty rules in AGENTS.md still apply: the label and its meaning stay.                                                                                          | —        |
| #67   | A small, readable "How findings are marked" legend in the 3D map panel                 | Codex               | low    | Self-contained styling. Severity colour must keep its glyph shape.                                                                                                                       | —        |
| #73   | Findings page: the evidence behind each finding in a Details dropdown                  | Codex               | medium | A contained component. Print, CSV and PDF output must not change.                                                                                                                        | —        |
| #78   | The 3D map key moves out of the Map card onto the stage                                | Codex               | medium | A layout move. The usual risk is overlap with the camera group, scale bar and timeline at 800–1100 px.                                                                                   | —        |
| #70   | An Uncertainty page in plain words, with one set of numbers and a fixed scale          | Codex               | high   | Its figures sit next to #54's precision rules and must stay consistent with the engine's thresholds.                                                                                     | —        |
| #71   | One worked example on the landing page instead of three generic sections               | Codex               | high   | Mostly copy and layout, but every figure must come from the engine and stay labelled as simulated.                                                                                       | —        |
| #74   | The Overview rebuilt: one answer, a readable site plan with a key, no repeated figures | Codex               | high   | The largest page spec. It touches the site plan, its layout code and several existing browser checks.                                                                                    | —        |
| #65   | A compact Findings tab in the 3D map panel, with the reference text collapsed          | Codex, after triage | medium | `needs-triage`. It overlaps #67 and #73, so it follows them.                                                                                                                             | —        |
| #68   | The Map card's layer switches folded into dropdowns                                    | Codex, after triage | medium | `needs-triage`. It overlaps #78 and must keep every switch reachable on phones (`e2e/mobile-layers.spec.ts`).                                                                            | —        |
| #69   | A concise About the data page                                                          | Codex, after triage | low    | `needs-triage`. Content trimming only.                                                                                                                                                   | —        |

## Order

1. Claude: #80, then #79, #77 and #72. #79 comes before #72 because the landing model reuses the map's terrain look, and before #77 because the apron has to match it.
2. Codex: #66, #67, #73, #78, #70, #71 and #74. The small changes go first so the larger page work starts from a settled shell.
3. Overlapping groups run in sequence, never in parallel:
   - **Findings presentation:** #67, then #73, then #65.
   - **Map card:** #78, then #68.
   - **Landing page:** #71 is merged before #72 edits `src/ui/HomePage.tsx`. #71 changes the sections below the hero and #72 changes the hero and its control.
   - **Terrain look:** #79, then #77 and #72. All three edit `src/scene/Terrain.tsx` or `src/scene/palette.ts`.
4. Triage #65, #68 and #69 (`needs-triage` to `ready-for-agent`, or `wontfix`) before anyone builds them.
5. Run one ticket at a time per builder, or two at most in separate worktrees. Browser tests time out on a loaded machine.
6. Each pull request merges `main` before it is merged, so its update-log entry sits on top and the browser suite runs on what will actually land.
7. When all are in, run one full `npm run verify && npm run test:e2e` on an idle machine, then the 1440, 1100, 800 and 390 px browser check.

## Reviewer checklist (Opus 5.5, high effort)

- Read the diff, not the builder's summary.
- Revert the fix and confirm the new test fails, then restore it and confirm the test passes. For a visual change with no failing test possible, check the screenshots at every width the issue names.
- Check the change sits in the shared code path, not only the path the issue names.
- Check the compliance snapshot and fixtures are unchanged, unless the issue says otherwise and lists each moved number.
- Check the honesty rules in AGENTS.md: the SIMULATED DATA badge, provenance tags, ± uncertainty, no dead buttons, severity colour paired with a glyph shape, colours only from tokens.
- Check the update-log entry is accurate.
- No Haiku: the honesty rules and the failing-test-first rule are where a smaller model slips.
