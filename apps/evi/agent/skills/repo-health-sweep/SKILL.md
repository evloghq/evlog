---
name: repo-health-sweep
description: Twice-weekly, coverage-led simplification audit over the whole evlog repository and Evi's real communication. Rotates through code, tests, architecture, skills, docs, examples, instructions, issue replies, review comments, and PR bodies; calls the simplification-sweep workflow for independent parallel review and adversarial verification; removes, deduplicates, and clarifies; opens ready pull requests, one per batch of same-kind mechanical fixes; records proposals and rejected findings so later runs go deeper instead of repeating easy observations. Load this when the repo-health-sweep schedule fires, or when Hugo asks for repository simplification, an unslop pass, a clarity audit, a skills-vs-reality check, or a convention drift review.
---

# Repo health sweep

This pass makes the repository easier to understand without changing what it means. It is not a search for short code at any cost. A smaller implementation that hides a protocol constraint, changes public behavior, or moves complexity elsewhere is worse. A comment that is shorter but no clearer is not a win either; the goal is that a reader stops re-reading.

The pass runs twice a week. Each run reviews bounded cohorts, not the whole tree. Coverage is kept in a compact ledger, `apps/evi/agent/ledgers/repo-health-sweep.md`, so the next run reaches code the previous one did not. The ledger stays small however many runs happen: past runs go to an archive and rejected findings go to a searchable file, and neither is read by default.

## What counts

A finding needs a concrete cost and a behavior-preserving smaller shape. Every finding carries a `kind`:

- `remove`: the text or code carries nothing; delete it.
- `dedupe`: one owner already exists; point to it.
- `clarify`: the meaning stays, the reader stops guessing. The finding names the ambiguity and quotes current and proposed text.

### Clarify

The repository's job is to make logging simple, and its own prose has to clear that bar. A clarify finding is any of:

- A comment, JSDoc block, or error message a reader cannot act on without reading the code it annotates.
- A JSDoc block on a public option that restates the type, repeats the docs page, or lists examples the docs already carry. The smaller shape keeps the purpose and the constraint, usually one sentence each, and nothing else. JSDoc on public APIs stays; its length is the finding.
- A paragraph comment whose durable constraint fits in one or two lines.
- A sentence in a skill, instruction, README, or PR body that can be read two ways.

The proposed text is part of the finding, not an afterthought. Without it the verifier has nothing to check and rejects the candidate as taste.

### Code

- Dead imports, helpers, branches, parameters, commented-out code, or unreachable fallbacks.
- A one-use wrapper that adds no policy, transformation, authority, or test boundary.
- Duplicated implementations of an invariant already owned by one helper.
- Defensive code that masks state already validated upstream.
- A comment that only paraphrases the code.

Keep comments that explain a protocol quirk, security boundary, compatibility requirement, or deliberate trade-off; shorten them when they ramble, never drop them. Do not report a public rename or behavior change as cleanup.

### Tests

- A test that reimplements source logic instead of importing and exercising it.
- Multiple tests with the same setup, action, assertion, and failure mode.
- An obsolete compatibility or regression case whose triggering source path no longer exists.
- A fixture or snapshot with no reader.
- Mock-only coverage duplicated by a test through the real framework runtime or request driver.
- An assertion that cannot fail independently of another assertion in the cohort.

A proposed removal names the surviving test and compares inputs, runtime boundary, observable output, and failure mode. Keep coverage for public contracts, past regressions, framework lifecycles, adapter protocols, type guarantees, platform-specific runtimes, and distinct edge cases. Never weaken an assertion or remove a test only because the suite is large.

### Architecture

- One policy or state owned in multiple places.
- A layer that only forwards data and has no independent contract.
- An abstraction whose second use disappeared.
- Logic in Eve wiring under `agent/` that belongs under `agent/lib/` with a colocated test.
- A manual sequence that the installed framework now expresses directly.

Framework integrations drifting from the contract in root `AGENTS.md` are the self-review's lens; do not duplicate it here.

A different design is not evidence. Trace callers, exports, tests, configuration, and failure paths before proposing a boundary change.

### Communication

Review both authored rules and recent output:

- `apps/evi/agent/instructions.md`, skills, schedules, subagent prompts, evals, and repository templates.
- Recent Evi-authored issue replies, review comments, and pull request titles and bodies.
- Docs, READMEs, examples, and AGENTS.md files when they fall in the selected cohort.

Look for answers that bury the conclusion, repeat it, narrate retrieval, expose internal detail without a user action, or sound certain beyond the evidence. Check whether instructions conflict or duplicate one another. Preserve repros, acceptance criteria, constraints, uncertainty, and explanations that help the reader act.

## 1. Start from a clean source

Work in `/workspace/repo` on the current `main`. Record `git rev-parse HEAD`; every reviewer receives that revision. Load `contributing` before writing an artifact.

Anything claimed about an API, option, export, adapter, example, or framework contract is read from source or executed at this revision. Absence is proven by enumerating the real surface. One counterexample kills a finding.

## 2. Read the coverage ledger

The ledger is three kinds of file in `apps/evi/agent/ledgers/`. Context cost depends on what the run is about to review, not on how many runs came before.

| File | Holds | How a run uses it |
| --- | --- | --- |
| `repo-health-sweep.md` | Compact current state: last revision and date per area, open questions and blockers, next cohorts. Hard cap 150 lines, stated in its header | Read in full at the start, rewritten in full at the end |
| `repo-health-sweep-rejected.jsonl` | One JSON object per rejected finding | Searched with `rg`, never read in full, new lines appended |
| `archive/YYYY-MM.md` | Append-only history, one section per run | Opened only for a specific detail, never by default |

Read the compact file from the checkout in step 1 before choosing cohorts. The previous run's ledger pull request may still be open, so its changes are not on `main` yet: search for an open pull request titled `docs(evi): record repo health sweep run` and, when there is one, read the compact file from that branch's head instead.

The compact file records, per area: the revision and date of its last review and the outcome in a few words, with a pointer to the archive entry. It also records:

- open questions and blockers;
- next cohorts.

It does not record run narratives, counts, finding lists, or rejection reasons. Those belong in the archive and the rejected file.

### Rejected findings

A rejected finding is durable evidence. Do not raise it again unless the relevant source or maintainer decision changed.

Once the cohorts are chosen, search the rejected file for each exact path and each area in scope, for example `rg -F -e '<path>' -e '<area>' apps/evi/agent/ledgers/repo-health-sweep-rejected.jsonl`. When a previous ledger pull request is open, search its head too with `git grep -F -e '<path>' <branch> -- apps/evi/agent/ledgers/repo-health-sweep-rejected.jsonl`. Do not open the file otherwise. Each line is one object with `area`, `paths`, `claim`, `reason`, `date`, `revision` and `source`. A `reason` of `not recovered` means the rejection still binds but its analysis was lost, so re-derive the analysis before judging that ground again. `source` names the archive section; open it only when the line is not enough.

## 3. Choose bounded cohorts

Choose one cohort for each reviewer. Prefer the least recently reviewed eligible area. Make the four scopes non-overlapping where possible.

**Code cohort:** one package directory or a similarly sized part of `apps/evi/agent/lib/`. Name exact paths. A directory whose files are a third comment lines (`packages/evlog/src/adapters/` is one) is a natural clarify cohort.

**Test cohort:** one bounded test directory or one source area and its matching tests. Include both source and test paths so the reviewer can trace behavior rather than compare test names.

**Architecture cohort:** one relationship, such as runtime to adapters, CLI rules to package exports, or Eve wiring to `agent/lib/`. Name both sides and the invariant being examined.

**Communication cohort:** one authored surface plus a small sample of recent real output. Use GitHub search and context tools to collect Evi-authored issue replies or pull requests. Include each exact URL and its complete excerpt in the workflow input. Exclude an artifact when its body is missing, JavaScript-only, or truncated, and record the retrieval limitation. Do not ask the reviewer to recover external content from a link.

Do not choose a cohort inside its cooldown when another eligible area exists. A recent change may override the cooldown when the diff itself is the reason for review.

## 4. Run the workflow once

Call `simplification-sweep` with:

- the recorded revision;
- the four exact scopes;
- every rejected finding the search above returned for the scoped paths and areas, and every maintainer decision recorded in the compact ledger.

The tool first verifies that the shared checkout matches the supplied full commit SHA. A mismatch ends the run before any specialist starts. It then fans out to hidden read-only specialists:

1. `code_simplifier`;
2. `test_reviewer`;
3. `architecture_reviewer`;
4. `communication_reviewer`.

After all four settle, `finding_verifier` tries to disprove every candidate against the same checkout. The workflow assigns finding ids and keeps the candidate fields itself; the verifier returns a verdict, delivery, and verification per id. The workflow returns reviewer status, limitations, programmatic counts, confirmed findings, rejected findings, open questions, and `pullRequestBatches`: confirmed pull-request candidates grouped by `kind` and directory. Read `status`, `reviewers`, and `counts` before the findings. A `degraded` run has missing evidence and cannot produce a pull-request-ready finding. A verification that returns no usable result degrades the run and marks every candidate as a question rather than failing the sweep. A `recovered` run may proceed, but the final report names the recovered failure. Copy counts from the result; never count finding IDs in prose. Do not bypass verification or ask the root model to recreate a failed specialist's report from memory.

## 5. Verify confirmed findings

The workflow is review, not permission to edit. Call its survivors workflow-confirmed candidates until this section passes. Do not call them ready findings or pull-request findings.

Immediately before parent verification, run `git rev-parse --verify HEAD^{commit}` and require the full SHA to equal the workflow's `revision`. If it differs, discard the result and rerun the workflow on the current checkout. In a real run, create each candidate branch from that exact reviewed revision before the first edit.

A dry run still completes every read-only check in this section. It skips edits, ledger writes, issue creation, branches, pushes, and pull requests. Do not stop after the workflow result and describe the remaining verification as future work.

For each confirmed finding:

1. Open the cited file and reproduce the evidence.
2. Search the whole repository for callers and counterexamples.
3. Check open Linear issues and GitHub issues or pull requests for the same ground.
4. State the behavior that must remain unchanged.
5. Identify the matching test before editing.
6. Drop it if implementation requires a new option, compatibility branch, public rename, or judgement the report did not surface.

A candidate whose edit touches only comments, JSDoc, or prose, confirmed by the verifier at confidence 0.9 or above, completes steps 1 and 4 only: there are no callers to trace and no test to match, and the verifier already read the file. Any candidate that changes an executable line completes all six.

A code or prose simplification gets a regression test when behavior could change. Pure removal still needs the existing checks that prove the affected surface.

A test simplification additionally cites the surviving coverage and explains why the removed test has no distinct failure mode, runtime boundary, regression history, or public contract. Run the focused test file before and after the edit, then the full suite and coverage. If the equivalence cannot be demonstrated, keep the test.

## 6. Deliver

### Ready pull request

The unit of delivery is a batch from `pullRequestBatches`: every confirmed candidate of one kind in one directory. A batch becomes PR-ready only when each of its candidates passed the parent verification above and all of these hold:

- every candidate is mechanical and behavior-preserving;
- the verifier confirmed each with high confidence;
- the diff contains the batch's candidates and no opportunistic cleanup; a candidate that failed parent verification leaves the batch, it does not block it;
- a matching test covers the change, or a test-only reduction proves the remaining coverage is equivalent;
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, and affected content checks exit 0;
- required changesets, skill updates, API snapshot review, and visual evidence are present;
- the pull request body shows the change (a snippet, captured output, or capture, not prose alone) and states the problem, preserved behavior, verification, and the reviewed revision.

Immediately before pushing or opening the pull request, run `git merge-base HEAD <reviewed-revision>` and require the output to equal the full reviewed SHA. Inspect `git diff <reviewed-revision>...HEAD` and require it to contain only the batch's verified candidates. If either check fails, do not deliver the branch; restart it from the reviewed revision.

Open a normal, ready pull request, not a draft. Title it by kind and area (`refactor(core): drop paraphrasing comments in shared/`, `docs(evi): clarify the sweep delivery rules`). The body lists each candidate with its before and after. Read CI once it settles and fix any failure before requesting review from `hugorcd`. If the branch cannot meet the readiness gate, do not open a half-finished pull request. Keep the result as a blocker or proposal in the report.

Open at most three pull requests per run. One batch per pull request; never mix kinds or directories. Batches past the cap go to the compact ledger as next cohorts.

### Proposal or question

An architectural decision, uncertain reduction, or finding that needs product judgement becomes a Linear issue or an update to an existing one. State the current cost, evidence, proposed smaller boundary, behavior at risk, and decision required. Never implement a proposal autonomously.

### Report and ledger

Write the full run report as a Linear document. Then record the run in the ledger with three changes, all under `apps/evi/agent/ledgers/`:

1. **Rewrite** `repo-health-sweep.md` in full: update the last review of each area the run covered, replace the open questions and next cohorts, and refresh the header line. Keep it under the cap in its header. Never append to it.
2. **Append** one section to `archive/YYYY-MM.md` for the month of the run, creating the file when the month is new, headed `## Run YYYY-MM-DD, revision <short sha>`. It holds what used to be the whole ledger entry: cohorts, reviewer health, exact counts, confirmed findings and their destination, limitations, and a link to the report and every pull request the run opened. Never edit an earlier section.
3. **Append** one line to `repo-health-sweep-rejected.jsonl` per finding the verifier or parent verification rejected, with `area`, `paths`, `claim`, `reason`, `date`, `revision` and `source` (the archive section). Never edit or delete an existing line. Write only what the result states, and use `not recovered` for a reason that was lost.

The ledger change is its own pull request, not a batch. Branch from current `origin/main`, or from the open previous ledger pull request's head when there is one, so the rewrite builds on it. Change only the ledger files above, and title it `docs(evi): record repo health sweep run YYYY-MM-DD`. It needs no changeset, does not count toward the three-pull-request cap, and is exempt from the reviewed-revision checks above, which guard the batches. Open it ready and request review from `hugorcd` once CI passes. Post one line per artifact in the schedule thread, with links inline.

Use this order in the final response:

1. Run status, revision, duration, and whether writes were enabled.
2. One line per reviewer with `complete`, `recovered`, or `incomplete` and any limitation.
3. The workflow's exact proposed, confirmed, rejected, question, proposal, pull-request-candidate, and batch counts.
4. Each surviving candidate with ID, kind, path and lines, problem, smaller shape, preserved behavior, matching test, parent-verification result, batch, and destination.
5. Recoverable errors and their effect on coverage.
6. Links to created artifacts, or the exact next action in a dry run.

Say `0 PR-ready` until parent verification and the readiness gate pass. A workflow-confirmed count is not a PR-ready count.

## Response-quality follow-up

A weak real-world response may justify an eval fixture. Propose the fixture with the source artifact, failure mode, and expected behavior. Do not run live-model evals or change evaluation criteria unattended; the repository keeps those manual because they cost money and can redefine Evi's behavior.

Useful eval coverage includes:

- community answers that lead with the answer and explain the relevant why;
- maintainer replies that stay direct without deleting necessary context;
- pull request bodies that show the change and state problem, preserved behavior, and verification;
- no repeated conclusion or repeated link;
- internal implementation detail translated into an action the reader can take;
- uncertainty preserved instead of polished away.

## When nothing survives

Record the cohorts in the compact ledger and the run in the archive, add any rejected candidates to the rejected file, then say the lenses ran and nothing warranted a change. A clean cohort advances coverage. Never invent a finding to fill the run.
