# Repo health sweep ledger

Compact current state of the `repo-health-sweep` schedule. **Hard cap: 150 lines.** A run reads this file in full at the start and rewrites it in full at the end, so it never grows with the number of runs.

- Holds only: last review per area, open questions and blockers, next cohorts. Nothing else.
- Past runs live in `archive/YYYY-MM.md` (append-only). Open one only for a specific detail, never by default.
- Rejected findings live in `repo-health-sweep-rejected.jsonl`, one JSON object per line. Search it with `rg` for the paths and areas about to be reviewed. Never read it in full.
- If a rewrite would pass the cap, drop the oldest reviewed rows into the archive section instead of trimming the open questions.

Last rewritten by: the run of 2026-11-06, revision `b756b76` (archive/2026-11.md, Run 2026-11-06). That run was partial: the simplification sweep's full result was not retained in its context, so reviewer health for three of four reviewers, the exact counts, and most candidate texts are unknown. It opened no batch pull request. Previous rewrite: the run of 2026-10-09 18:40 UTC, revision `a34dffd` (archive/2026-10.md, Entry 7).

## Last reviewed

Rev = revision of the review (short sha). Archive = where the detail is. Ref numbers are entries in that archive file.

### Code and tests

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `packages/evlog/src/next/` | 2026-11-06 | `b756b76` | Code reviewer complete (static reading, no shell). Candidate texts not retained. code-1 reproduced on main, held, not shipped | 2026-11 Run 2026-11-06 |
| `packages/evlog/src/shared/` | 2026-09-25 | `ab63002` | #735 shipped. Carryover code-3, code-4, code-5 verified, never recorded as shipped | 2026-09 #2 |
| `packages/evlog/src/adapters/` + `test/adapters/` | 2026-09-25 | `ab63002` | #736 shipped. Carryover tests-2 to tests-4 | 2026-09 #2 |
| `packages/evlog/src/runtime/` | 2026-10-02 | `7f4a26f` | #756, #757 shipped | 2026-10 #3 |
| `packages/evlog/test/vite/` + `src/vite/` | 2026-10-02 | `7f4a26f` | #755 shipped | 2026-10 #3 |
| `packages/evlog/src/nitro/` | 2026-10-02 | `7f4a26f` | #759, #760 shipped | 2026-10 #4 |
| `packages/evlog/test/nuxt/` + `src/nuxt/module.ts` | 2026-10-02 | `7f4a26f` | Clean | 2026-10 #4 |
| `packages/evlog/src/nitro-v3/` | 2026-10-09 | `54dcc50` | #795, #796 shipped. One clarify candidate held, text lost | 2026-10 #6 |
| `packages/evlog/test/nitro-v3/` | 2026-10-06 | `88d2c9f` | Clean except the tests-1 question | 2026-10 #5 |
| `packages/evlog/test/nitro/` + `src/nitro/` | 2026-10-09 | `54dcc50` | #797 shipped. tests-3 proposal, text lost. 2026-11 run: test reviewer result not recovered | 2026-10 #6 |
| `packages/evlog/src/ai/index.ts` + `test/ai/ai.test.ts` | 2026-10-09 | `a34dffd` | #800, #801 shipped. code-3 to code-6 not applied | 2026-10 #7 |
| `packages/cli/src/commands/` vs `packages/evlog/src/index.ts`, `package.json` | 2026-09-25 | `ab63002` | architecture-1 (0.85), architecture-2 (0.8, coordinate with #647) carried over | 2026-09 #2 |

### Architecture (Eve wiring under `apps/evi/agent/` vs `agent/lib/`)

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `apps/evi/agent/` wiring, `tools/` | 2026-10-02 | `7f4a26f` | #761 shipped. 3 proposals, text lost | 2026-10 #4 |
| `channels/`, `schedules/` | 2026-10-02 | `7f4a26f` | No finding recorded | 2026-10 #4 |
| `connections/` | 2026-10-06 | `88d2c9f` | Invariant held | 2026-10 #5 |
| `extensions/` (`browser.ts`, `github.ts`) | 2026-10-09 | `54dcc50` | 2 proposals, text lost. 2026-11 run: result not recovered | 2026-10 #6 |
| `hooks/evlog.ts` vs `lib/` | 2026-10-09 | `a34dffd` | Proposals, one safety-relevant | 2026-10 #7 |

### Communication

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `skills/review-logging-patterns/SKILL.md` + PR #731, #729 | 2026-09-25 | `ab63002` | Reviewed | 2026-09 #2 |
| `skills/contributing/SKILL.md` + #737 reply + PR #747 | 2026-10-02 | `7f4a26f` | Reviewed | 2026-10 #3 |
| `skills/before-after/SKILL.md` + PR #757 | 2026-10-02 | `7f4a26f` | Reviewed | 2026-10 #4 |
| `skills/content-pass/SKILL.md` + PR #783 | 2026-10-06 | `88d2c9f` | Incomplete, diff was elided. EVL-506 filed | 2026-10 #5 |
| `skills/content-pass/SKILL.md` + PR #790 | 2026-10-09 | `54dcc50` | communication-1 proposal, text lost | 2026-10 #6 |
| `apps/evi/agent/instructions.md` + PR bodies | 2026-10-09 | `a34dffd` | Findings recorded, not re-verified. 2026-11 run: result not recovered | 2026-10 #7 |

## Open questions and blockers

1. **Safety-relevant architecture item** (`hooks/evlog.ts`, `extensions/`): blocking an autonomous write without an enforcement option. Needs a maintainer decision. 2026-10 #6, #7.
2. **nitro `module.ts` normalization** (code-1, code-2 of 2026-10-06): needs a maintainer decision and a change to the stub at `test/nitro/module-paths.test.ts:49-53`. 2026-10 #5.
3. **tests-1**: verbatim-duplicated errorHandler test between `test/nitro-v3/` and `test/nitro/`. Judged conservatively on 2026-10-09, still pending a maintainer decision. 2026-10 #5, #6.
4. **Filed proposals**: EVL-505 (nitro-v3 errorHandler JSDoc subpath), EVL-506 (content-pass skill wording).
5. **ai/index.ts**: code-3 needs a typecheck with `@ai-sdk/provider` installed. code-4 to code-6 removals are not pinned by any test. `tsc --noEmit` has no baseline on `main` (298 errors, none in `src/ai/index.ts`). 2026-10 #7.
6. **Test-only removals**: batch with source dedupes or keep separate? Kept separate so far. 2026-10 #7.
7. **Awaiting review**: #795, #796, #797, #800, #801. Merge state is not recorded here.
8. **Lost material, never reconstruct**: the texts of the 2026-10-09 held clarify candidate, tests-3, architecture-1, architecture-2 and communication-1, and the proposals of 2026-10-02. Re-derive from the sources with a fresh reviewer pass.
9. **Counts and rejected list of the 2026-10-09 18:40 run** were not carried into that session and are not in the archive.
10. **2026-11-06 sweep result not retained.** Only the code reviewer's output was visible in the run context. Reviewer health for the test, architecture and communication reviewers, the exact counts, and the text of every candidate except code-1 are unknown. Re-run the workflow once with the full result stored. Do not reconstruct the candidates from memory. 2026-11 Run 2026-11-06.
11. **code-1 reproduced, not shipped.** `packages/evlog/src/next/client.ts:5` imports `log`, `setIdentity` and `clearIdentity`, which the file body never uses. Line 7 re-exports them. The change would drop them from the local import only. Held because its batch cannot be stated completely without the rest of the result. 2026-11 Run 2026-11-06.
12. **#976 (open, bot pull request)**: renames Adapter to Drain across 84 docs pages and freezes product words in `AGENTS.md`. Any terminology or wording finding on `apps/docs/content/`, `AGENTS.md`, or `instructions.md` must check #976 first. Maintainer decision pending.

## Next cohorts

1. **Code**: re-run `packages/evlog/src/next/` with the full result retained (code-1 to code-14). Then `ai/index.ts` code-3 to code-6 once the typecheck gap is closed.
2. **Test**: `packages/evlog/test/nitro/` for tests-1, tests-3, tests-6 to tests-8, once the test reviewer's result is recovered in full. Baseline on main on 2026-11-06: 24 files and 240 tests pass across `test/next`, `test/nitro` and the nitro-v3 barrel test (`npx vitest run`, about 8 seconds).
3. **Architecture**: `extensions/` to recover its two proposals. `hooks/evlog.ts` and `lib/` after the decision in question 1.
4. **Communication**: `instructions.md` after the decision on #976, then `skills/content-pass/SKILL.md` against a fresh, complete PR body.
5. **Next run**: per the schedule (twice weekly). Start from question 10.
