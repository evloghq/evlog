# Repo health sweep ledger

Compact current state of the `repo-health-sweep` schedule. **Hard cap: 150 lines.** A run reads this file in full at the start and rewrites it in full at the end, so it never grows with the number of runs.

- Holds only: last review per area, open questions and blockers, next cohorts. Nothing else.
- Past runs live in `archive/YYYY-MM.md` (append-only). Open one only for a specific detail, never by default.
- Rejected findings live in `repo-health-sweep-rejected.jsonl`, one JSON object per line. Search it with `rg` for the paths and areas about to be reviewed. Never read it in full.
- If a rewrite would pass the cap, drop the oldest reviewed rows into the archive section instead of trimming the open questions.

Last rewritten by: the run of 2026-11-27, revision `881db85` (archive/2026-11.md, Run 2026-11-27, status degraded, 0 PR-ready). Previous rewrite: the run of 2026-11-24, revision `915b23b` (archive/2026-11.md, Run 2026-11-24, status recovered, 0 PR-ready).

Report of the 2026-11-27 run: https://linear.app/hrcd/document/repo-health-sweep-2026-11-27-revision-881db85-39f7d5f97bce

Report of the 2026-11-24 run: https://linear.app/hrcd/document/repo-health-sweep-2026-11-24-revision-915b23b-4940ea37f33c

Report of the 2026-11-20 run: https://linear.app/hrcd/document/repo-health-sweep-2026-11-20-revision-85369bb-69dbf3cc9912

Report of the 2026-11-17 run: https://linear.app/hrcd/document/repo-health-sweep-2026-11-17-revision-907dc23-dd3965fc659f

## Last reviewed

Rev = revision of the review (short sha). Archive = where the detail is. Ref numbers are entries in that archive file.

### Code and tests

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `packages/evlog/src/next/` | 2026-11-17 | `907dc23` | code-1, code-2, code-7, code-9 (#1093) and code-5, code-6 (#1092) merged on 2026-11-17. code-4 dropped in parent verification. code-10 held, equivalence verified. code-8 re-check due. code-3, code-11 proposals | 2026-11 Run 2026-11-17 |
| `packages/evlog/src/shared/` | 2026-11-24 | `915b23b` | code-3, code-5, code-6 confirmed at verifier confidence 0.5 to 0.7, held (no batch cleared the gate). code-1, code-2 (re-raise of 2026-09-25), code-7 to code-14 rejected. code-4 question. Full read of all 41 files | 2026-11 Run 2026-11-24 |
| `packages/evlog/src/adapters/` + `test/adapters/` | 2026-11-13 | `74f4423` | Dead code (#1046) and duplicate helpers (#1047) merged. Earlier #736 shipped. Carryover tests-2 to tests-4 | 2026-11 Run 2026-11-13 |
| `packages/evlog/src/runtime/` | 2026-11-20 | `85369bb` | code-1, code-2, code-3 confirmed, held (degraded run, not PR-ready). code-4 rejected. Client plugin rejection re-derived, still binding. #756, #757 shipped earlier | 2026-11 Run 2026-11-20 |
| `packages/evlog/test/vite/` + `src/vite/` | 2026-11-20 | `85369bb` | tests-1, tests-3, tests-4, tests-6, tests-7, tests-9 confirmed, held. tests-2, tests-5 rejected. tests-8 rejected under the 2026-10-02 decision. #755 shipped earlier | 2026-11 Run 2026-11-20 |
| `packages/evlog/src/nitro/` | 2026-11-17 | `907dc23` | #759, #760 shipped. Held tests in next cohorts. #797 shipped (2026-10-09) | 2026-10 #4 |
| `packages/evlog/test/nitro/` | 2026-11-17 | `907dc23` | tests-10 (#1091) merged on 2026-11-17. tests-5, tests-6, tests-7, tests-11 held for mutation proof. tests-1 blocked on Q3. tests-2, tests-8, tests-9 proposals. tests-3, tests-4 rejected | 2026-11 Run 2026-11-17 |
| `packages/evlog/test/nuxt/` + `src/nuxt/module.ts` | 2026-11-24 | `915b23b` | tests-1, tests-4, tests-5, tests-6, tests-7 rejected. tests-2, tests-3, tests-8, tests-9 questions, blocked by the 2026-10-02 rejections (check the archive first). Earlier review 2026-10-02 clean | 2026-11 Run 2026-11-24 |
| `packages/evlog/test/fixtures/nuxt-ts/` | 2026-11-24 | `915b23b` | tests-10 (remove the fixture `tsconfig.json`, its only `include` names a missing file) confirmed at confidence 0.3, held. Only reader is `test/nuxt/auto-import-types.test.ts` | 2026-11 Run 2026-11-24 |
| `packages/evlog/src/nitro-v3/` | 2026-11-27 | `881db85` | Run ids are per run. code-1 (dedupe), code-2 and code-3 (removes) confirmed; code-8 (clarify) confirmed at 0.3. All held: the run is degraded. code-1, code-2, code-8 reproduced on main. This run's code-4 and code-5 (JSDoc clarify) and code-7, code-9 rejected; code-6 question. #795, #796 shipped earlier | 2026-11 Run 2026-11-27 |
| `packages/evlog/test/nitro-v3/` | 2026-10-06 | `88d2c9f` | Clean except the tests-1 question | 2026-10 #5 |
| `packages/evlog/src/ai/index.ts` + `test/ai/ai.test.ts` | 2026-11-27 | `881db85` | tests-4, tests-5, tests-12, tests-13 confirmed (clarify test names), held. tests-1, tests-2, tests-6 to tests-11 rejected (distinct read surfaces or boundaries). tests-3 question. #800, #801 shipped earlier. 2026-10 code-3 to code-6 still not applied | 2026-11 Run 2026-11-27 |
| `packages/cli/src/commands/` vs `packages/evlog/src/index.ts`, `package.json` | 2026-11-20 | `85369bb` | architecture-1 (env precedence) and architecture-2 (`--until` ranges) proposals, both need a decision. Reviewer incomplete, PR #647 not checked | 2026-11 Run 2026-11-20 |

### Architecture (Eve wiring under `apps/evi/agent/` vs `agent/lib/`)

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `apps/evi/agent/tools/` | 2026-11-24 | `915b23b` | architecture-2 (`content-targets.ts` corpus command) confirmed at 0.45, held. architecture-1, -3, -8 proposals. architecture-7 question. Recovered reviewer, not complete | 2026-11 Run 2026-11-24 |
| `apps/evi/agent/lib/` (`gateway.ts`) | 2026-11-24 | `915b23b` | architecture-4, architecture-5 confirmed at 0.3, held. architecture-5 changes an exported type | 2026-11 Run 2026-11-24 |
| `apps/evi/agent/lib/github/` | 2026-11-24 | `915b23b` | architecture-6 (`shellQuote` owner in `workspace.ts`) confirmed at 0.5, held. Byte-identical copies in `signed-push.ts` and `content/scan.ts` | 2026-11 Run 2026-11-24 |
| `apps/evi/agent/` wiring, `tools/` (earlier) | 2026-10-02 | `7f4a26f` | #761 shipped. 3 proposals, text lost | 2026-10 #4 |
| `channels/`, `schedules/` | 2026-11-27 | `881db85` | architecture-3 (`schedules/tasks.ts:27-28`) confirmed at 0.3, held. architecture-2 proposal (iMessage principal in two modules, maintainer decision). Held for rerun: the `channels/slack.ts` maintainer gate, which needs eve types. Reviewer incomplete. Earlier 2026-10-02 review: no finding | 2026-11 Run 2026-11-27 |
| `apps/evi/agent/lib/slack.ts` | 2026-11-27 | `881db85` | architecture-1 (test-only `resetSlackMemberCache` with no caller) confirmed at 0.85, reproduced on main | 2026-11 Run 2026-11-27 |
| `connections/` | 2026-10-06 | `88d2c9f` | Invariant held | 2026-10 #5 |
| `extensions/` (`browser.ts`, `github.ts`, `git/`) | 2026-11-17 | `907dc23` | architecture-1, -3, -4 proposals. architecture-1 depends on eve types the reviewer could not read | 2026-11 Run 2026-11-17 |
| `hooks/evlog.ts` vs `lib/` | 2026-10-09 | `a34dffd` | Proposals, one safety-relevant | 2026-10 #7 |

### Communication

| Area | Last reviewed | Rev | Outcome | Archive |
| --- | --- | --- | --- | --- |
| `skills/contributing/SKILL.md` + PR #1161, #1227 bodies | 2026-11-24 | `915b23b` | communication-5 proposal (held). communication-6 proposal on #1161 body. communication-1 to -4, -9 to -13 rejected under binding rulings or taste. communication-7, -8 questions on #1227 (missing author input) | 2026-11 Run 2026-11-24 |
| `skills/before-after/SKILL.md` + PR #1047, #1048 bodies | 2026-11-20 | `85369bb` | communication-1, -2 proposals (held). communication-3, -4 rejected. communication-5 to -9 target merged bodies, not actionable as edits | 2026-11 Run 2026-11-20 |
| `skills/contributing/SKILL.md` + #737 reply + PR #747 | 2026-10-02 | `7f4a26f` | Reviewed | 2026-10 #3 |
| `skills/review-logging-patterns/SKILL.md` + PR #731, #729 | 2026-09-25 | `ab63002` | Reviewed | 2026-09 #2 |
| `skills/content-pass/SKILL.md` + PR #783 | 2026-10-06 | `88d2c9f` | Incomplete, diff was elided. EVL-506 filed | 2026-10 #5 |
| `skills/content-pass/SKILL.md` + PR #790 | 2026-10-09 | `54dcc50` | communication-1 proposal, text lost | 2026-10 #6 |
| `skills/content-pass/SKILL.md` + PR #1230, #1232 bodies | 2026-11-27 | `881db85` | communication-1, -2, -5, -10 confirmed (clarify, dedupe), held. communication-3 proposal: the report template has no ELI5 and conflicts with the `createPullRequest` gate. communication-14 to -18 questions on the PR bodies. communication-4, -6 questions. communication-7, -8, -9, -11, -12, -13 rejected | 2026-11 Run 2026-11-27 |
| `apps/evi/agent/instructions.md` + PR bodies | 2026-11-17 | `907dc23` | communication-2, -5, -11, -12 rejected. communication-8, -9, -13, -14 proposals. ELI5 whitespace finding not made. Raw bodies of #1047 and #1048 not checked | 2026-11 Run 2026-11-17 |

## Open questions and blockers

1. **Readiness gate threshold** (2026-11-24): the gate requires the verifier to confirm each finding with "high confidence" and gives no number. The 2026-11-24 run found no batch at 0.7 or above with a passing test, so it shipped nothing. A maintainer should set a number (for example 0.8) or say the verifier value is not the measure. Blocks every batch.
2. **Safety-relevant architecture item** (`hooks/evlog.ts`, `extensions/`): blocking an autonomous write without an enforcement option. Needs a maintainer decision. 2026-10 #6, #7.
3. **nitro `module.ts` normalization** (code-1, code-2 of 2026-10-06): needs a maintainer decision and a change to the stub at `test/nitro/module-paths.test.ts:49-53`. 2026-10 #5.
4. **tests-1 (nitro) and Q3**: `test/nitro/plugin.test.ts:14-226` mirrors `src/nitro/enrich-drain.ts`. Blocked on Q3 of the 2026-11-17 run, which asks about the verbatim errorHandler duplicate between `test/nitro-v3/` and `test/nitro/`. The question text was not retained. Needs a maintainer decision.
5. **Filed proposals**: EVL-505 (nitro-v3 errorHandler JSDoc subpath), EVL-506 (content-pass skill wording). Not re-checked since 2026-11-13.
6. **ai/index.ts**: code-3 needs a typecheck with `@ai-sdk/provider` installed. code-4 to code-6 removals are not pinned by any test. `tsc --noEmit -p packages/evlog/tsconfig.json` on `main` at `74f4423` reports 338 errors, none in `src/ai/index.ts`. 2026-10 #7, 2026-11-13.
7. **Shared batch needs proof** (2026-11-24): code-3, code-5, code-6 need `pnpm run typecheck` and the focused tests (`test/shared/nitroConfigBridge.test.ts`, `test/core/pretty-error.test.ts`, `test/http/shared-http-identity.test.ts`) run on a branch from `915b23b`, to raise verifier confidence. Not run in this run.
8. **Batch shape**: removals and dedupes ship as separate pull requests. Test-only removals stay in their own batch. A pull request ships only candidates that passed parent verification and the gate; a candidate left out is held, not rejected. 2026-11-17.
9. **Degraded runs ship nothing**: the 2026-11-20 run produced 9 held candidates (code-1, code-2, code-3, tests-1, tests-3, tests-4, tests-6, tests-7, tests-9). They need a complete rerun before any batch opens.
10. **Architecture coordination with #647**: `architecture-2` in `packages/cli/src/commands/logs.ts` must be checked against #647 before any change. Not done on 2026-11-20 (not fetched).
11. **Outbound gate on PR bodies**: `outbound.ts:60-62` would refuse a body with no fenced block, table or image outside the ELI5. The 2026-11-20 communication reviewer saw #1047 and #1048 without one. Check whether the gate is enforced on these PRs before treating it as a rule. Also `outbound.ts` lines 55-70 are an open question, not a finding.
12. **Maintainer questions from 2026-11-24**: code-4 (is an empty `userAgent` intended, `shared/http.ts`), tests-9 (intent of the dist path fixture), architecture-7 (intent of the `*_KEY` refusals in `tools/set-vercel-env.ts`), communication-7 and -8 (author input missing on #1227).
13. **#976 closed without merge** (checked 2026-11-17). The Adapter to Drain rename is a maintainer-rejected proposal: do not propose it again.
14. **Lost material, never reconstruct**: the texts of the 2026-10-09 held clarify candidate, tests-3 (2026-10), architecture-1 and architecture-2 (2026-10), communication-1, the proposals of 2026-10-02, and every test, architecture and communication candidate of 2026-11-13. Re-derive from the sources with a fresh reviewer pass.
15. **Full results**: the full simplification result JSON stays in the sandbox only. The archive section and the Linear reports carry the findings, reviewer limitations and counts.
16. **Photon principal (architecture-2, 2026-11-27)**: the maintainer's iMessage principal is spelled in `channels/photon.ts` and `lib/trust.ts`, and the phone presence test is written twice. Moving it needs a maintainer decision on where the principal set lives. A proposal, not a batch. Linear: EVL-834.
17. **Content-pass report shape (communication-3, 2026-11-27)**: the content-pass report template has its own sections and no ELI5, but the PR body rule allows one shape only and `createPullRequest` refuses a body without the ELI5. A live conflict. A maintainer decides which shape a content-pass PR follows. Linear: EVL-835.
18. **Degraded architecture reviewer (2026-11-27)**: `node_modules` and the eve source are not installed in the checkout, so the eve types were unread. Held: the `channels/slack.ts` maintainer gate (admitMaintainer and onAnswers, a dedupe candidate). Needs a rerun with dependencies installed.
19. **nitro-v3 type evidence (2026-11-27)**: `node_modules` is absent, so the h3 and nitro declared types were not read. code-1 and code-2 rest on indirect evidence from `plugin.ts` and the errorHandler test. Run `pnpm install` before the next nitro-v3 batch.
20. **Questions with no decision (2026-11-27)**: code-6 (the Record branch of `getNitroV3RequestHeader`, which its only caller cannot reach), tests-3 (a conditional assertion that can pass with no assertion), communication-4 (one-line or two-line report), communication-6 (the Checks line omitted for markdown-only changes), communication-14 to -18 (PR bodies #1230 and #1232).

## Next cohorts

1. **Code**: `packages/evlog/src/nitro-v3/` code-1, code-2, code-3, code-8 after `pnpm install` gives the h3 and nitro types (questions 18 and 19). Then `packages/evlog/src/shared/` code-3, code-5, code-6 (question 7). `packages/evlog/src/runtime/` held candidates after a complete rerun. `packages/evlog/src/next/` code-10 and code-8 re-check.
2. **Test**: `packages/evlog/test/ai/ai.test.ts` tests-4, tests-5, tests-12, tests-13 as one clarify batch, after the source behavior is traced again on a checkout with dependencies installed. `packages/evlog/test/nuxt/` tests-2, tests-3, tests-8, tests-9 after the 2026-10-02 check. `packages/evlog/test/fixtures/nuxt-ts/` tests-10 (question on `tsc -p` behavior). `packages/evlog/test/vite/` held candidates after a complete rerun. `packages/evlog/test/nitro/` tests-5, tests-6, tests-7, tests-11 need mutation proof.
3. **Architecture**: `apps/evi/agent/lib/slack.ts` architecture-1 (test-only export removal) is the mechanical candidate. Next, the `channels/slack.ts` gate dedupe once the eve types are read (question 18). `channels/photon.ts` architecture-2 after question 16. `schedules/tasks.ts` architecture-3 once the write gates are named. `apps/evi/agent/lib/github/` architecture-6 and `tools/` architecture-2 from 2026-11-24. `packages/cli` against `packages/evlog` exports, with #647 checked.
4. **Communication**: `skills/content-pass/SKILL.md` communication-1, -2, -5, -10 once question 17 is decided. `skills/contributing/SKILL.md` communication-5 as a decision. `skills/before-after/SKILL.md` communication-1 and -2. Then the outbound gate in question 11.
5. **Batches held**: the 2026-11-27 run produced 8 batches and 14 pull-request candidates, none PR-ready because the run is degraded. The next run starts from questions 1, 7 and 16 to 18, then the held candidates above.
