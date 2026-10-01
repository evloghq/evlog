---
name: repo-health-sweep
description: Twice-weekly, coverage-led simplification audit over the whole evlog repository and Evi's real communication. Rotates through code, tests, architecture, skills, docs, examples, instructions, issue replies, review comments, and PR bodies; calls the simplification-sweep workflow for independent parallel review and adversarial verification; opens ready pull requests for fully verified mechanical fixes; records proposals and rejected findings so later runs go deeper instead of repeating easy observations. Load this when the repo-health-sweep schedule fires, or when Hugo asks for repository simplification, an unslop pass, a clarity audit, a skills-vs-reality check, or a convention drift review.
---

# Repo health sweep

This pass makes the repository easier to understand without changing what it means. It is not a search for short code at any cost. A smaller implementation that hides a protocol constraint, changes public behavior, or moves complexity elsewhere is worse.

The pass runs twice a week. Each run reviews bounded cohorts, not the whole tree. Coverage accumulates in Linear so the next run reaches code the previous one did not.

## What counts

A finding needs a concrete cost and a behavior-preserving smaller shape.

### Code

- Dead imports, helpers, branches, parameters, commented-out code, or unreachable fallbacks.
- A one-use wrapper that adds no policy, transformation, authority, or test boundary.
- Duplicated implementations of an invariant already owned by one helper.
- Defensive code that masks state already validated upstream.
- A paragraph comment that can become one durable constraint, or a comment that only paraphrases the code.

Keep comments that explain a protocol quirk, security boundary, compatibility requirement, or deliberate trade-off. Do not report a public rename or behavior change as cleanup.

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
- Framework integrations that no longer share the contract required by root `AGENTS.md`.
- A manual sequence that the installed framework now expresses directly.

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

Keep one Linear issue on the evlog team titled `Evi simplification coverage ledger`. Search that exact title once with `linear__list_issues`. Keep the returned issue ID for every read and write in the run, then read its comments with `linear__list_comments`. In a real run, create the issue when the exact search returns none. In a dry run, report the missing ledger and do not create it.

Each run comment records:

- revision and date;
- exact code, test, architecture, and communication cohorts;
- skipped areas and why;
- confirmed findings and their destination;
- rejected findings with the verifier's reason;
- questions and blockers;
- next cohorts.

A rejected finding is durable evidence. Do not raise it again unless the relevant source or maintainer decision changed.

## 3. Choose bounded cohorts

Choose one cohort for each reviewer. Prefer the least recently reviewed eligible area. Make the four scopes non-overlapping where possible.

**Code cohort:** one package directory or a similarly sized part of `apps/evi/agent/lib/`. Name exact paths.

**Test cohort:** one bounded test directory or one source area and its matching tests. Include both source and test paths so the reviewer can trace behavior rather than compare test names.

**Architecture cohort:** one relationship, such as runtime to adapters, CLI rules to package exports, or Eve wiring to `agent/lib/`. Name both sides and the invariant being examined.

**Communication cohort:** one authored surface plus a small sample of recent real output. Use GitHub search and context tools to collect Evi-authored issue replies or pull requests. Include each exact URL and its complete excerpt in the workflow input. Exclude an artifact when its body is missing, JavaScript-only, or truncated, and record the retrieval limitation. Do not ask the reviewer to recover external content from a link.

Do not choose a cohort inside its cooldown when another eligible area exists. A recent change may override the cooldown when the diff itself is the reason for review.

## 4. Run the workflow once

Call `simplification-sweep` with:

- the recorded revision;
- the four exact scopes;
- every relevant rejected finding or maintainer decision from the ledger.

The tool first verifies that the shared checkout matches the supplied full commit SHA. A mismatch ends the run before any specialist starts. It then fans out to hidden read-only specialists:

1. `code_simplifier`;
2. `test_reviewer`;
3. `architecture_reviewer`;
4. `communication_reviewer`.

After all four settle, `finding_verifier` tries to disprove every candidate against the same checkout. The workflow assigns finding ids and keeps the candidate fields itself; the verifier returns a verdict, delivery, and verification per id. The workflow returns reviewer status, limitations, programmatic counts, confirmed findings, rejected findings, and open questions. Read `status`, `reviewers`, and `counts` before the findings. A `degraded` run has missing evidence and cannot produce a pull-request-ready finding. A verification that returns no usable result degrades the run and marks every candidate as a question rather than failing the sweep. A `recovered` run may proceed, but the final report names the recovered failure. Copy counts from the result; never count finding IDs in prose. Do not bypass verification or ask the root model to recreate a failed specialist's report from memory.

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

A code or prose simplification gets a regression test when behavior could change. Pure removal still needs the existing checks that prove the affected surface.

A test simplification additionally cites the surviving coverage and explains why the removed test has no distinct failure mode, runtime boundary, regression history, or public contract. Run the focused test file before and after the edit, then the full suite and coverage. If the equivalence cannot be demonstrated, keep the test.

## 6. Deliver

### Ready pull request

A workflow-confirmed candidate marked `pull_request` becomes PR-ready only when the parent verification above also passes and all of these hold:

- it is mechanical and behavior-preserving;
- the verifier confirmed it with high confidence;
- the diff contains one finding and no opportunistic cleanup;
- a matching test covers the change, or a test-only reduction proves the remaining coverage is equivalent;
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, and affected content checks exit 0;
- required changesets, skill updates, API snapshot review, and visual evidence are present;
- the pull request body shows the change (a snippet, captured output, or capture, not prose alone) and states the problem, preserved behavior, verification, and the reviewed revision.

Immediately before pushing or opening the pull request, run `git merge-base HEAD <reviewed-revision>` and require the output to equal the full reviewed SHA. Inspect `git diff <reviewed-revision>...HEAD` and require it to contain only the verified candidate. If either check fails, do not deliver the branch; restart it from the reviewed revision.

Open a normal, ready pull request, not a draft. Read CI once it settles and fix any failure before requesting review from `hugorcd`. If the branch cannot meet the readiness gate, do not open a half-finished pull request. Keep the result as a blocker or proposal in the report.

Open at most two pull requests per run. One finding per pull request.

### Proposal or question

An architectural decision, uncertain reduction, or finding that needs product judgement becomes a Linear issue or an update to an existing one. State the current cost, evidence, proposed smaller boundary, behavior at risk, and decision required. Never implement a proposal autonomously.

### Report and ledger

Write the full run report as a Linear document. Then append the compact coverage entry to the ledger issue. Post one line per artifact in the schedule thread, with links inline.

Use this order in the final response:

1. Run status, revision, duration, and whether writes were enabled.
2. One line per reviewer with `complete`, `recovered`, or `incomplete` and any limitation.
3. The workflow's exact proposed, confirmed, rejected, question, proposal, and pull-request-candidate counts.
4. Each surviving candidate with ID, path and lines, problem, smaller shape, preserved behavior, matching test, parent-verification result, and destination.
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

Record the cohorts and rejected candidates in the ledger, then say the lenses ran and nothing warranted a change. A clean cohort advances coverage. Never invent a finding to fill the run.
