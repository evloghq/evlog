---
name: content-pass
description: The daily pass over evlog's written surfaces. Picks the files the scanner ranks worst across the docs, the landing, the package READMEs, the skills, and the AGENTS.md files, reviews them against the content doctrine, applies what holds, and opens one draft PR whose body is the report. Also covers the enrichment half, run when nothing scores badly enough to rewrite, such as the page an index promises and nobody wrote, the integration documented at half its contract, the correction that should have become a rule. Load this when the content-pass schedule fires, or when Hugo asks for a content pass, a docs review, a rewrite of a page, a README, a skill or an AGENTS.md, or what is worth writing next.
---

# Content pass

One pass, one group, one pull request. The corpus is ~120 files: the docs tree and the landing, the four package READMEs, the internal and published skills, and the three AGENTS.md files. None of that gets fixed in a day, and trying is how a rewriter starts rewriting for its own sake.

Half the corpus is read by people and half by agents, and the pass treats them differently. A skill or an AGENTS.md governs the agent running this pass, so it may fix a house rule there (punctuation, a dead link, a retired entry point, a wrong term) and nothing else. Procedure, bounds, and a skill's `description` come back as findings for Hugo. That is `M-09` in the doctrine, and `content-targets` enforces it by returning those files with mode `report`.

The doctrine lives in the repository, at `.agents/skills/write-evlog-content/`. This file is the procedure; that skill is the standard. Never restate its rules here. Read them there, and when they are wrong, fix them there.

## The two halves

**Rewrite** is the default: the scanner ranks the corpus, the worst pages get reviewed, and what survives review gets applied.

**Enrich** is what runs when the rewrite half comes back empty, with no page above the bar or everything ranked inside its cooldown. That is a good day, not a wasted one. Switch to the second half rather than lowering the bar.

Never run both in one pass. A PR that rewrites two pages and adds a third is a PR nobody reviews properly.

## Rewrite

### 1. Pick the targets

Call `content-targets`. It runs the scanner over the whole corpus, drops files changed inside the cooldown, and returns the top files from a single group with their candidates. A group is one docs section, one skill's directory, or a flat surface (`readme`, `agents`, `landing`).

Pass `surface` when Hugo asked for one, or when the weekly corpus check found a surface drifting. Otherwise take what ranks.

**Read `eligible` before deciding anything.** It is the count of files with findings that are outside the cooldown, and it is the only number that says whether there is work. `eligible: 0` sends you to **Enrich**. Anything above zero means the rewrite half has targets, and the pass rewrites.

Write the three numbers into the PR body verbatim: `scanned`, `candidates`, `eligible`. A pass that says the rewrite half was empty without them is asserting, not reporting, and a corpus of 120 files with 47 eligible pages has been called empty before.

### 2. Branch

In `/workspace/repo`, from a fresh `main`:

```
git -C /workspace/repo checkout -B content/<group>-<slug> origin/main
```

Slugify the group: `.agents/skills/create-adapter` becomes `skills-create-adapter`.

### 3. Apply the derivable fixes first

```
node scripts/content-lint/index.mjs <each target> --fix
```

This rewrites only what follows from the rule rather than from taste: a retired entry point, a term with one replacement, a link with a redirect behind it. Dashes are not mechanical and stay findings for the reviewer. It re-scans each file afterwards and reverts anything that scored worse or introduced a new id, so a reverted file is a bug to report, not a file to retry.

Keep these page edits uncommitted until verification. The content agents share the parent's actual workspace, including new pages and local edits. Source code changes must be committed before capturing an identity; a local commit is sufficient. Never change Git state or write files while a reviewer is reading them.

Then re-run `content-targets`. A file whose findings were all mechanical now comes back clean and is dropped from the pass. Never send a reviewer a finding a codemod already fixed: it costs a dispatch and it teaches the reviewer that findings are cheap.

### 4. Review, in parallel

Call `content_snapshot` for each target. Dispatch `content_review` once per target with the returned identity, its surface, candidates and `modelChecks`. Include factual sources and executed-check results, but not your interpretation or preferred verdict. Content agents explicitly share the parent sandbox and call `content_load` to check the digest and source revision before reading. A load failure blocks that page; capture it again rather than substituting another version.

The candidates are what tripped a counter. The `modelChecks` are what no counter reached on that page, and the reviewer answers every one of them. Pass them through as they came; they are chosen per surface and per page, and editing them is how a pass quietly stops checking something.

The reviewer returns a verdict. `pass` means that page is done for this run; do not rewrite it, do not ask again.

### 5. Rewrite, in parallel

For every target whose verdict is not `pass` and whose mode is `rewrite`, dispatch `content_rewrite` with the same snapshot and that page's findings. It returns full replacement text and the original digest. Wait for all readers, then apply the results serially in the parent with `content_apply`, passing the original snapshot and replacement text. If the page or revision changed meanwhile, capture and review it again instead of overwriting newer work.

Targets with mode `report` skip this step: the landing page absent a critical finding, and any skill or AGENTS.md whose findings go past the house rules. Their findings go in the PR body for Hugo to decide on. Do not edit the landing page for voice or rhythm, and do not touch a procedure, a bound, or a `description`.

### 6. Verify

In the sandbox:

```
node scripts/content-lint/index.mjs <each changed file>
git -C /workspace/repo diff --stat
```

Then the checks the changed files actually need:

- A docs page or the landing: run the docs lint and content tests, parse changed frontmatter with the actual content parser, and inspect the rendered title, description and changed MDC. Run changed executable examples against the relevant package and runtime. A passing prose scan does not verify metadata, APIs or rendered output.
- A skill or an AGENTS.md: nothing builds these, so the check is the scanner plus reading the diff. Every relative link is resolved by `U-16`, so a dead cross-reference shows up in the scan.
- `packages/evlog/README.md`: this one ships to npm. It needs a changeset (`patch`), and the automd blocks are regenerated rather than hand-edited. The other three package READMEs follow the same rule.

What you are checking:

- Correctness is the blocking check. Send every applied snapshot through `content_review` again, with the previous critical findings and execution evidence. Confirm the reported revision and digest match the applied snapshot, and that critical findings are resolved. Missing evidence remains explicitly unverified.
- Review new scanner candidates against their legitimate twins. Do not revert a factual correction solely because its style score fell. Explain a confirmed false positive in the PR and propose a narrow scanner correction; do not weaken thresholds or add filler to satisfy the score. Required CI failures still prevent marking the PR ready.
- The diff touches only the target files. A stray change to a component, a config, or a package is a bug in the pass, not a bonus.
- Frontmatter and MDC structure survived. Read the diff, not just the score.

If verification finds a concrete new defect, send that finding back for a targeted correction and rerun affected checks. Do not retry for style variation alone. If the defect cannot be resolved, keep the PR draft and report the blocker.

Before opening the PR, read the changed pages together: state the reader question each answers, remove duplicated explanations where a link suffices, and resolve contradictory promises. Record which checks ran on which revision. After further edits, rerun affected checks rather than carrying a stale pass forward.

### 7. Open the pull request

Commit with a conventional subject naming the group, push with `git__push`, and open a **draft** PR with `github__createPullRequest`.

**The title is validated by CI and a wrong scope means the PR cannot merge.** The accepted list is `scopes:` in `.github/workflows/semantic-pull-request.yml`. Read it rather than guessing, and note what is not in it:

- **`evlog` is never a scope.** The whole monorepo is evlog, so a bare `docs:` already means evlog itself. `docs(evlog):` fails validation.
- One docs page under `4.integrate/adapters/<name>/` or `4.integrate/frameworks/<name>` takes that subsystem's scope: `docs(posthog):`, `docs(hono):`.
- Several pages, or a page belonging to no subsystem: `docs:` with no scope.
- The package READMEs: `docs(core):`. The skills and the `AGENTS.md` files: no scope.
- `fix(docs):` when the pass fixed a broken sample or a dead link, because that is what it was.
- A changeset only when the diff leaves `apps/*`. `packages/evlog/README.md` ships with the package, so it gets one; a docs page, a skill under `.agents/`, and an AGENTS.md do not.
- The body **is** the report:

```markdown
## Content pass: <group>

<one line: how many pages the scanner ranked, how many were fixed mechanically, how many were reviewed, how many changed>

### Fixed mechanically
- [id] <path>:<line>, what the codemod replaced. One line each, or `_None._`.

### <path>
Score <before> → <after>. Verdict: <verdict>.
- [id] what changed and why, one line.

### Not applied
- [id] <path>, the finding did not hold or the fix needs a decision.

### Reported, not changed
- [id] <path>, landing findings and anything else left for you.
```

Facts only. No summary of what the pass is for, no closing note about improving the docs.

### 8. Say it in one line

Report to the thread: what group, how many files, the PR link. Two lines maximum. The PR body is where the detail belongs, and chat is where it is least readable.

## Enrich

Run this when `eligible` is 0. It needs an observation, not an opinion: name the gap you found and where you found it, or drop it.

**Whatever file you end up editing, run `--fix` on it first.** A page you are already opening does not have "pre-existing" findings, it has findings, and the mechanical ones cost one command. Leaving a wrong term on a page you just edited, and writing that it was out of scope, is the pass explaining why it did less than the tool it was given.

Look, in this order, and stop at the first thing that holds:

- **A promise with no page.** A section index, a card group, or a `links:` block pointing at something thin or missing. The scanner's `U-16` findings are the mechanical version; the interesting cases are pages that exist and do not deliver what the index said.
- **An integration documented at half its contract.** Every framework page owes `evlog()`, `useLogger()`, `log.fork()`, and the framework-native accessor. `evlog/workers` is the documented exception. A page missing half of that is a real gap in the docs, not a style problem.
- **Source that outran the docs.** A recent export, option, or adapter in `packages/evlog/src` with no page. `git log --since='30 days ago' -- packages/evlog/src` against the content tree.
- **A skill that outran the repository.** `AGENTS.md` says a skill describing the old behavior is worse than no skill. Take one skill, check every path, command, and symbol in it against the checkout (`M-03`, `M-07`), and report what no longer exists. This is a finding for Hugo, not an edit.
- **A dossier nobody refreshed.** `references/landscape/*.md` carries a `Checked:` date. Older than six months and every `U-12` review this quarter leaned on stale facts. Re-reading one tool's docs and updating its dossier is a better day's work than a rewrite.
- **A correction that should be a rule.** `references/corrections.md` with the same lesson written three times is a rule waiting to be added to `references/rules/`. That is a PR against the skill, and it is worth more than any single page.
- **A blog post that has a reason.** Only when something happened: a release with a real behavior change, a decision with a cost worth explaining, a measurement that surprised us. Read `references/rules/blog.md` and `references/surfaces/blog.md` first, and answer its four questions in the issue before drafting anything. A post with no event behind it does not get written.

A new page or a post is a **Linear issue**, not a PR: what is missing, where the reader hits it, and the shape it should take. Drafting new content unattended is not this pass's job. A gap that is one paragraph inside an existing page can go straight into a PR, the same way a rewrite does.

## Once a week, the corpus check

On the first pass of the week, before picking targets, run the scanner over the whole corpus and look at what only shows up across files: the same sentence on two pages drafted together, the same worked example (`checkout`, `userId: 42`) recurring in unrelated sections, every page in a section opening on the same move. `references/ai-tells.md` closes on these. They read as one generated set even when every page passes alone, and no single-page review will ever catch them.

Two more, now that the corpus spans both audiences:

- **A term that split.** `pnpm content:lint --top 30` and look at the `U-15` findings together. One page calling a drain a sink is a slip. Four pages doing it means the docs and the skills taught different words, and the fix is a rule, not four rewrites.
- **A skill contradicting a docs page.** Same subject, two procedures. The skill wins on repository workflow, the docs win on public API, and either way one of them is wrong today.

## What this pass never does

- Rewrite a file nothing was found on. No finding, no edit.
- Dispatch a reviewer for something `--fix` already handles.
- Run `--fix` over the corpus. It takes the targets of this pass and refuses a bare sweep for that reason.
- Touch a file inside its cooldown, whoever changed it.
- Edit the landing page for voice or rhythm.
- Change a skill's procedure, bounds, or `description`. Those are proposals, in the PR body.
- Touch `apps/evi/agent/skills/`. Those are this pass's own instructions and they are outside the corpus for that reason.
- Open more than one PR, or a PR that is not a draft.
- Add a changeset for a change confined to `apps/*`.
- Widen its own scope because the group looked bad. The group will still be there tomorrow.
