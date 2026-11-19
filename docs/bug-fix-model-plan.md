# Bug-fix model plan (tickets #53–#62)

Spec: #52. Report: `docs/bug-check-2026-11-19.md`.

The builder uses the model and effort in the table, one fresh session per ticket. Every ticket is then reviewed by a new **Opus 5.5** session at **high** effort that has not seen the build.

| Ticket | What it fixes                                                    | Builder    | Effort | Why                                                                                              |
| ------ | ---------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------ |
| #53    | Inspector change verdict agrees with the findings it lists       | Opus 5.5   | high   | Changes what the compliance reading reports; must keep the snapshot and all five findings intact |
| #55    | Only what is drawn can be clicked (hidden terrain, badge clicks) | Opus 5.5   | xhigh  | R3F click order and propagation; badge-over-terrain priority is the hardest fix in the set       |
| #60    | Camera flight ends at the new depth when exaggeration changes    | Opus 5.5   | high   | Flight state and rescale interact frame by frame; easy to fix the symptom, not the cause         |
| #62    | Terrain textures disposed only when replaced or unmounted        | Opus 5.5   | medium | Small diff, but a wrong lifetime leaks GPU memory or disposes a live texture. Start after #55    |
| #58    | A shared link always matches the selected finding                | Sonnet 5.5 | high   | History push vs replace, plus the map following hash changes; several paths to keep consistent   |
| #54    | Printed figures agree with the verdict beside them               | Sonnet 5.5 | medium | Formatting change with exact boundary values given in the ticket                                 |
| #56    | Map shortcuts stay out of the way while the phone drawer is open | Sonnet 5.5 | medium | Clear cause; needs a browser check below `lg`                                                    |
| #59    | Landing date bar labels the in-between model as an illustration  | Sonnet 5.5 | medium | Copy change, but the test has to sample the bar mid-tween                                        |
| #61    | Ramp builder fails softly when no ramp point survives            | Sonnet 5.5 | medium | Guard plus unit test; the compliance snapshot must not move                                      |
| #57    | Coordinate form status clears when the point changes             | Sonnet 5.5 | low    | One-line cause, one browser check                                                                |

## Order

1. Start tickets one at a time, or two at most in separate worktrees. Browser tests time out on a loaded machine.
2. Run #62 only after #55 is merged.
3. Finish with one full `npm run verify && npm run test:e2e` on an idle machine, then the 1440, 1100 and 800 px browser check.

## Reviewer checklist (Opus 5.5, high effort)

- Read the diff, not the builder's summary.
- Revert the fix and confirm the new test fails, then restore it and confirm the test passes.
- Check the fix sits in the shared code path, not only the path the ticket names.
- Check the compliance snapshot and fixtures are unchanged and the update-log entry is accurate.
- No Haiku: these tickets need a test that genuinely fails first, and that is where a smaller model slips.
