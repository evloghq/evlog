# Repo health sweep ledger

Compact current state of the `repo-health-sweep` schedule. **Hard cap: 150 lines.** A run reads this file in full at the start and rewrites it in full at the end, so it never grows with the number of runs.

- Holds only: last review per area, open questions and blockers, next cohorts. Nothing else.
- Past runs live in `archive/YYYY-MM.md` (append-only). Open one only for a specific detail, never by default.
- Rejected findings live in `repo-health-sweep-rejected.jsonl`, one JSON object per line. Search it with `rg` for the paths and areas about to be reviewed. Never read it in full.
- If a rewrite would pass the cap, drop the oldest reviewed rows into the archive section instead of trimming the open questions.

Last rewritten by: the run of 2026-11-17, revision `907dc23` (archive/2026-11.md, Run 2026-11-17). Previous rewrite: the run of 2026-11-13, revision `74f4423` (archive/2026-11.md, Run 2026-11-13).

Report of the 2026-11-17 run: https://linear.app/hrcd/document/repo-health-sweep-2026-11-17-revision-907dc23-dd3965fc659f

## Last reviewed

Rev = revision of the review (short sha). Archive = where the detail is. Ref numbers are entries in that archive file.

### Code and tests

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `packages/evlog/src/next/` | 2026-11-17 | `907dc23` | code-1, code-2, code-7, code-9 in #1093 (open). code-5, code-6 in #1092 (open). code-4 dropped in parent verification. code-10 held, equivalence verified. code-8 deferred behind #1093. code-3, code-11 proposals | 2026-11 Run 2026-11-17 |
| `packages/evlog/src/shared/` | 2026-09-25 | `ab63002` | #735 shipped. Carryover code-3, code-4, code-5 verified, never recorded as shipped | 2026-09 #2 |
| `packages/evlog/src/adapters/` + `test/adapters/` | 2026-11-13 | `74f4423` | Dead code (#1046) and duplicate helpers (#1047) open, each verified on its branch. Earlier #736 shipped. Carryover tests-2 to tests-4 | 2026-11 Run 2026-11-13 |
| `packages/evlog/src/runtime/` | 2026-10-02 | `7f4a26f` | #756, #757 shipped | 2026-10 #3 |
| `packages/evlog/test/vite/` + `src/vite/` | 2026-10-02 | `7f4a26f` | #755 shipped | 2026-10 #3 |
| `packages/evlog/src/nitro/` | 2026-10-02 | `7f4a26f` | #759, #760 shipped | 2026-10 #4 |
| `packages/evlog/test/nuxt/` + `src/nuxt/module.ts` | 2026-10-02 | `7f4a26f` | Clean | 2026-10 #4 |
| `packages/evlog/src/nitro-v3/` | 2026-10-09 | `54dcc50` | #795, #796 shipped. One clarify candidate held, text lost | 2026-10 #6 |
| `packages/evlog/test/nitro-v3/` | 2026-10-06 | `88d2c9f` | Clean except the tests-1 question | 2026-10 #5 |
| `packages/evlog/test/nitro/` + `src/nitro/` | 2026-11-17 | `907dc23` | tests-10 in #1091 (open). #797 shipped (2026-10-09). tests-5, tests-6, tests-7, tests-11 held for mutation proof. tests-1 blocked on Q3. tests-2, tests-8, tests-9 proposals. tests-3, tests-4 rejected | 2026-11 Run 2026-11-17 |
| `packages/evlog/src/ai/index.ts` + `test/ai/ai.test.ts` | 2026-10-09 | `a34dffd` | #800, #801 shipped. code-3 to code-6 not applied | 2026-10 #7 |
| `packages/cli/src/commands/` vs `packages/evlog/src/index.ts`, `package.json` | 2026-09-25 | `ab63002` | architecture-1 (0.85), architecture-2 (0.8, coordinate with #647) carried over | 2026-09 #2 |

### Architecture (Eve wiring under `apps/evi/agent/` vs `agent/lib/`)

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `apps/evi/agent/` wiring, `tools/` | 2026-10-02 | `7f4a26f` | #761 shipped. 3 proposals, text lost | 2026-10 #4 |
| `channels/`, `schedules/` | 2026-10-02 | `7f4a26f` | No finding recorded | 2026-10 #4 |
| `connections/` | 2026-10-06 | `88d2c9f` | Invariant held | 2026-10 #5 |
| `extensions/` (`browser.ts`, `github.ts`, `git/`) | 2026-11-17 | `907dc23` | architecture-1, -3, -4 proposals. architecture-1 depends on eve types the reviewer could not read | 2026-11 Run 2026-11-17 |
| `hooks/evlog.ts` vs `lib/` | 2026-10-09 | `a34dffd` | Proposals, one safety-relevant | 2026-10 #7 |

### Communication

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `skills/review-logging-patterns/SKILL.md` + PR #731, #729 | 2026-09-25 | `ab63002` | Reviewed | 2026-09 #2 |
| `skills/contributing/SKILL.md` + #737 reply + PR #747 | 2026-10-02 | `7f4a26f` | Reviewed | 2026-10 #3 |
| `skills/before-after/SKILL.md` + PR #757 | 2026-10-02 | `7f4a26f` | Reviewed | 2026-10 #4 |
| `skills/content-pass/SKILL.md` + PR #783 | 2026-10-06 | `88d2c9f` | Incomplete, diff was elided. EVL-506 filed | 2026-10 #5 |
| `skills/content-pass/SKILL.md` + PR #790 | 2026-10-09 | `54dcc50` | communication-1 proposal, text lost | 2026-10 #6 |
| `apps/evi/agent/instructions.md` + PR bodies | 2026-11-17 | `907dc23` | communication-2, -5, -11, -12 rejected. communication-8, -9, -13, -14 proposals. ELI5 whitespace finding not made. Raw bodies of #1047 and #1048 not checked | 2026-11 Run 2026-11-17 |

## Open questions and blockers

1. **Safety-relevant architecture item** (`hooks/evlog.ts`, `extensions/`): blocking an autonomous write without an enforcement option. Needs a maintainer decision. 2026-10 #6, #7.
2. **nitro `module.ts` normalization** (code-1, code-2 of 2026-10-06): needs a maintainer decision and a change to the stub at `test/nitro/module-paths.test.ts:49-53`. 2026-10 #5.
3. **tests-1 and Q3**: `test/nitro/plugin.test.ts:14-226` mirrors `src/nitro/enrich-drain.ts`. Blocked on Q3 of the 2026-11-17 run, which asks about the verbatim errorHandler duplicate between `test/nitro-v3/` and `test/nitro/`. The question text was not retained. Needs a maintainer decision. 2026-11 Run 2026-11-17.
4. **Filed proposals**: EVL-505 (nitro-v3 errorHandler JSDoc subpath), EVL-506 (content-pass skill wording). Not re-checked since 2026-11-13. The 2026-11-17 proposals are listed in its Linear report; no issues were filed for them.
5. **ai/index.ts**: code-3 needs a typecheck with `@ai-sdk/provider` installed. code-4 to code-6 removals are not pinned by any test. `tsc --noEmit -p packages/evlog/tsconfig.json` on `main` at `74f4423` reports 338 errors, the same set as after #1046 and #1047; none is in `src/ai/index.ts`. 2026-10 #7, 2026-11-13.
6. **Batch shape**: removals and dedupes ship as separate pull requests. Test-only removals stay in their own batch. A pull request ships only candidates that passed parent verification; a candidate left out is held, not rejected. 2026-11-17.
7. **Awaiting review**: #795, #796, #797, #800, #801, #1046, #1047 (state not re-checked in 2026-11-17). #1091, #1092, #1093 (open; review requested once CI passes on the final head).
8. **Lost material, never reconstruct**: the texts of the 2026-10-09 held clarify candidate, tests-3 (2026-10), architecture-1 and architecture-2 (2026-10), communication-1, the proposals of 2026-10-02, and every test, architecture and communication candidate of 2026-11-13. The three 2026-10-02 rejections were truncated. The texts of the nine 2026-11-17 workflow questions are not stored, except Q3's subject. Re-derive from the sources with a fresh reviewer pass.
9. **Full result retained (2026-11-17).** The full simplification result is in the archive section. Each reviewer's limitations are recorded there.
10. **#976 closed without merge** (checked 2026-11-17). The Adapter to Drain rename is a maintainer-rejected proposal: do not propose it again.

## Next cohorts

1. **Code**: `packages/evlog/src/next/` code-10 (remove the `Promise.resolve` wrappers in `composeDrains`, `src/next/stream.ts:103-107`), as a removal after #1093 merges. Re-check code-8 after #1093 merges. code-3 and code-11 need a decision. `ai/index.ts` code-3 to code-6 once the typecheck gap closes. Re-check `src/adapters/` after #1046 and #1047 merge.
2. **Test**: `packages/evlog/test/nitro/` tests-5, tests-6, tests-7, tests-11 need mutation proof before removal. tests-2, tests-8, tests-9 are proposals. tests-1 waits for Q3. Batch counts on the 2026-11-17 branches: 127 files, 2484 tests (A and B), 127 files, 2483 tests (C). No main baseline was measured in that run. The 2026-11-13 baseline (125 files, 2449 tests) is not comparable.
3. **Architecture**: `extensions/` architecture-1 once the eve types can be read from a checkout with `node_modules` installed. `hooks/evlog.ts` and `lib/` after the decision in question 1.
4. **Communication**: `instructions.md` is no longer blocked by #976. Check the raw bodies of #1047 and #1048 against the write gate, and the ELI5 whitespace, before any finding. Then `skills/content-pass/SKILL.md` against a fresh, complete PR body.
5. **Next run**: per the schedule (twice weekly). Start from the held candidates in the cohorts above and from question 3.
