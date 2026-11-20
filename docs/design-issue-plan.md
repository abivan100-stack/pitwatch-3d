# Design issue plan (issues #65–#80)

Issues: #65–#74 and #77–#80, all opened on 2026-11-19. They follow the bug fixes in `docs/bug-fix-model-plan.md` (#53–#62, all merged).

Each issue is already a full spec with its decisions taken, so the builder carries out the plan rather than designing it. Each one gets a fresh builder session at the listed effort. A new session that has not seen the build then reviews it before it is merged: **Sonnet 5.5** at **high** effort for the pages, and **Opus 5.5** at **high** effort for the 3D-scene issues (#79, #77, #72).

Claude builds all of them, so the overlapping groups below run in one sequence and no two builds edit the same file at once. On 2026-11-20 the owner asked for Sonnet 5.5 wherever possible, so every remaining build uses Sonnet 5.5. The exception is #79, whose Opus 5.5 build was nearly finished.

| Issue | What it changes                                                                        | Builder                           | Effort | Why                                                                                                                                                                                      | Progress                 |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| #80   | Show on map: the camera flight centres the finding, is quicker and writes state once   | Claude (Opus 5.5)                 | high   | Camera maths and timed browser checks in `CameraRig.tsx`, which #60 just changed. The reported centroid must not move.                                                                   | Merged in [#94][pr-94]   |
| #79   | The pit looks like a real open-pit mine: rock texture, wear, sculpted benches          | Claude (Opus 5.5)                 | xhigh  | Shader and texture work judged by eye. Contours and the tint must keep working. Part A changes only what is drawn. Any elevation change goes in a separate PR that re-runs the snapshot. | Merged in [#97][pr-97]   |
| #77   | Surrounding ground and a marked surveyed edge, so the model does not float             | Claude (Sonnet 5.5)               | high   | New scene geometry beside the terrain. It must take no clicks (#55), stay outside the survey grid and leave the snapshot unchanged.                                                      | Merged in [#98][pr-98]   |
| #72   | The landing model looks like real ground; two states plus two overlay toggles          | Claude (Sonnet 5.5)               | high   | The 3D look and a new control on the first page people see. It reuses #79's look and changes the date bar from #59.                                                                      | Merged in [#100][pr-100] |
| #66   | A quieter SIMULATED DATA badge that keeps its label                                    | Claude (Sonnet 5.5)               | low    | A small CSS change. The honesty rules in AGENTS.md still apply: the label and its meaning stay.                                                                                          | Merged in [#89][pr-89]   |
| #67   | A small, readable "How findings are marked" legend in the 3D map panel                 | Claude (Sonnet 5.5)               | low    | Self-contained styling. Severity colour must keep its glyph shape.                                                                                                                       | Merged in [#90][pr-90]   |
| #73   | Findings page: the evidence behind each finding in a Details dropdown                  | Claude (Sonnet 5.5)               | medium | A contained component. Print, CSV and PDF output must not change.                                                                                                                        | Merged in [#96][pr-96]   |
| #78   | The 3D map key moves out of the Map card onto the stage                                | Claude (Sonnet 5.5)               | medium | A layout move. The usual risk is overlap with the camera group, scale bar and timeline at 800–1100 px.                                                                                   | Merged in [#93][pr-93]   |
| #70   | An Uncertainty page in plain words, with one set of numbers and a fixed scale          | Claude (Sonnet 5.5)               | high   | Its figures sit next to #54's precision rules and must stay consistent with the engine's thresholds.                                                                                     | Merged in [#91][pr-91]   |
| #71   | One worked example on the landing page instead of three generic sections               | Claude (Sonnet 5.5)               | high   | Mostly copy and layout, but every figure must come from the engine and stay labelled as simulated.                                                                                       | Merged in [#92][pr-92]   |
| #74   | The Overview rebuilt: one answer, a readable site plan with a key, no repeated figures | Claude (Sonnet 5.5)               | high   | The largest page spec. It touches the site plan, its layout code and several existing browser checks.                                                                                    | Merged in [#95][pr-95]   |
| #65   | A compact Findings tab in the 3D map panel, with the reference text collapsed          | Claude (Sonnet 5.5), after triage | medium | `needs-triage`. It overlaps #67 and #73, so it follows them.                                                                                                                             | Merged in [#99][pr-99]   |
| #68   | The Map card's layer switches folded into dropdowns                                    | Claude (Sonnet 5.5), after triage | medium | `needs-triage`. It overlaps #78 and must keep every switch reachable on phones (`e2e/mobile-layers.spec.ts`).                                                                            | Merged in [#102][pr-102] |
| #69   | A concise About the data page                                                          | Claude (Sonnet 5.5), after triage | low    | `needs-triage`. Content trimming only.                                                                                                                                                   | Merged in [#103][pr-103] |
| #107  | The map Findings tab compact by default, with no Compact toggle                        | Claude (Fable 5.2)                | medium | Raised on 2026-11-20 after #65: the toggle was the wrong answer, the list should be compact from the start.                                                                              | Merged in [#108][pr-108] |
| #106  | The Overview survey and permit details grouped, tight and in one type rule             | Claude (Fable 5.2)                | medium | Raised on 2026-11-20 after #74: the fold read as a data dump.                                                                                                                            | Merged in [#109][pr-109] |
| #105  | The 3D map key compact, closed by default and clear of the model                       | Claude (Fable 5.2)                | medium | Raised on 2026-11-20 after #78: the key opened over the model.                                                                                                                           | Merged in [#110][pr-110] |
| #104  | The surveyed block and the ground around it read as one landscape                      | Claude (Fable 5.2)                | high   | Raised on 2026-11-20 after #77 and #72: a hard seam at the block edge and a slab on the landing.                                                                                         | Merged in [#111][pr-111] |

[pr-89]: https://github.com/abivan100-stack/pitwatch-3d/pull/89
[pr-90]: https://github.com/abivan100-stack/pitwatch-3d/pull/90
[pr-93]: https://github.com/abivan100-stack/pitwatch-3d/pull/93
[pr-94]: https://github.com/abivan100-stack/pitwatch-3d/pull/94
[pr-96]: https://github.com/abivan100-stack/pitwatch-3d/pull/96
[pr-91]: https://github.com/abivan100-stack/pitwatch-3d/pull/91
[pr-92]: https://github.com/abivan100-stack/pitwatch-3d/pull/92
[pr-95]: https://github.com/abivan100-stack/pitwatch-3d/pull/95
[pr-97]: https://github.com/abivan100-stack/pitwatch-3d/pull/97
[pr-98]: https://github.com/abivan100-stack/pitwatch-3d/pull/98
[pr-99]: https://github.com/abivan100-stack/pitwatch-3d/pull/99
[pr-100]: https://github.com/abivan100-stack/pitwatch-3d/pull/100
[pr-102]: https://github.com/abivan100-stack/pitwatch-3d/pull/102
[pr-103]: https://github.com/abivan100-stack/pitwatch-3d/pull/103
[pr-108]: https://github.com/abivan100-stack/pitwatch-3d/pull/108
[pr-109]: https://github.com/abivan100-stack/pitwatch-3d/pull/109
[pr-110]: https://github.com/abivan100-stack/pitwatch-3d/pull/110
[pr-111]: https://github.com/abivan100-stack/pitwatch-3d/pull/111

## Order

1. Claude builds one issue at a time, in this order: #80, #66, #67, #73, #78, #79, #77, #70, #71, #72, #74. Then, once triaged, #65, #68 and #69.
   - #80 goes first because it is the only bug.
   - The small shell changes (#66, #67) go early, so the larger page work starts from a settled shell.
   - #74, the largest page rebuild, goes last of the ready issues, so it builds on the final Findings and map changes.
2. The order keeps each overlapping group in sequence:
   - **Findings presentation:** #67, then #73, then #65.
   - **Map card:** #78, then #68.
   - **Terrain look:** #79, then #77 and #72. All three edit `src/scene/Terrain.tsx` or `src/scene/palette.ts`, and the apron and the landing model reuse #79's look.
   - **Landing page:** #71 is merged before #72 edits `src/ui/HomePage.tsx`. #71 changes the sections below the hero and #72 changes the hero and its control.
3. Triage #65, #68 and #69 (`needs-triage` to `ready-for-agent`, or `wontfix`) before they are built.
4. Each issue is built in its own worktree off the latest `main`. Each pull request merges `main` before it is merged, so its update-log entry sits on top and the browser suite runs on what will actually land.
5. When all are in, run one full `npm run verify && npm run test:e2e` on an idle machine, then the 1440, 1100, 800 and 390 px browser check.

## Reviewer checklist (Sonnet 5.5 or Opus 5.5, high effort)

- Read the diff, not the builder's summary.
- Revert the fix and confirm the new test fails, then restore it and confirm the test passes. For a visual change with no failing test possible, check the screenshots at every width the issue names.
- Check the change sits in the shared code path, not only the path the issue names.
- Check the compliance snapshot and fixtures are unchanged, unless the issue says otherwise and lists each moved number.
- Check the honesty rules in AGENTS.md: the SIMULATED DATA badge, provenance tags, ± uncertainty, no dead buttons, severity colour paired with a glyph shape, colours only from tokens.
- Check the update-log entry is accurate.
- No Haiku: the honesty rules and the failing-test-first rule are where a smaller model slips.
