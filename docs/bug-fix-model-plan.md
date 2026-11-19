# Bug-fix model plan (tickets #53–#62)

Spec: #52. Report: `docs/bug-check-2026-11-19.md`.

Codex and Claude each own five tickets. Each ticket uses a fresh builder session at the listed effort. Every ticket is then reviewed by a new **Opus 5.5** session at **high** effort that has not seen the build.

| Ticket | What it fixes                                                    | Builder             | Effort | Why                                                                                                 | Progress                                      |
| ------ | ---------------------------------------------------------------- | ------------------- | ------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| #53    | Inspector change verdict agrees with the findings it lists       | Codex               | high   | Changes what the compliance reading reports and must keep the snapshot and all five findings intact | Merged in [#76][pr-76]                        |
| #54    | Printed figures agree with the verdict beside them               | Codex               | medium | Check the exact boundary values given in the ticket                                                 | Merged in [#76][pr-76]                        |
| #56    | Map shortcuts stay out of the way while the phone drawer is open | Codex               | medium | Verify that Escape preserves the measurement and shortcuts are inactive while the drawer is open    | Merged in [#82][pr-82]                        |
| #57    | Coordinate form status clears when the point changes             | Codex               | low    | Clear stale status while preserving the announcement for typed submissions                          | Fix verified in [#84][pr-84], open for review |
| #58    | A shared link always matches the selected finding                | Codex               | high   | Keep browser history, hash parsing and selected findings in sync                                    | Fix verified in [#85][pr-85], open for review |
| #55    | Only what is drawn can be clicked (hidden terrain, badge clicks) | Claude (Opus 5.5)   | xhigh  | Check R3F click order and propagation where badges appear in front of terrain                       | Merged in [#64][pr-64]                        |
| #60    | Camera flight ends at the new depth when exaggeration changes    | Claude (Opus 5.5)   | high   | Verify the final camera target when exaggeration changes mid-flight                                 | Merged in [#81][pr-81]                        |
| #62    | Terrain textures disposed only when replaced or unmounted        | Claude (Opus 5.5)   | medium | Check that textures stay live while in use and are cleaned up on unmount. Start after #55.          | Unblocked by #55, next                        |
| #59    | Landing date bar labels the in-between model as an illustration  | Claude (Sonnet 5.5) | medium | Check the wording during the transition and at both endpoints                                       | Merged in [#83][pr-83]                        |
| #61    | Ramp builder fails softly when no ramp point survives            | Claude (Sonnet 5.5) | medium | Cover the empty ramp case and verify that the compliance snapshot stays unchanged                   | Not started                                   |

[pr-64]: https://github.com/abivan100-stack/pitwatch-3d/pull/64
[pr-76]: https://github.com/abivan100-stack/pitwatch-3d/pull/76
[pr-81]: https://github.com/abivan100-stack/pitwatch-3d/pull/81
[pr-82]: https://github.com/abivan100-stack/pitwatch-3d/pull/82
[pr-83]: https://github.com/abivan100-stack/pitwatch-3d/pull/83
[pr-84]: https://github.com/abivan100-stack/pitwatch-3d/pull/84
[pr-85]: https://github.com/abivan100-stack/pitwatch-3d/pull/85

## Order

1. Codex implemented #53, #54, #56, #57 and #58 in that order.
2. Claude implemented #55, #60 and #59, each reviewed by a separate Opus 5.5 high-effort session. #62 (unblocked now that #55 is merged) and #61 remain, in that order.
3. Start tickets one at a time, or two at most in separate worktrees. Browser tests time out on a loaded machine.
4. Finish with one full `npm run verify && npm run test:e2e` on an idle machine, then the 1440, 1100 and 800 px browser check.

## Reviewer checklist (Opus 5.5, high effort)

- Read the diff, not the builder's summary.
- Revert the fix and confirm the new test fails, then restore it and confirm the test passes.
- Check the fix sits in the shared code path, not only the path the ticket names.
- Check the compliance snapshot and fixtures are unchanged and the update-log entry is accurate.
- No Haiku: these tickets need a test that genuinely fails first, and that is where a smaller model slips.
