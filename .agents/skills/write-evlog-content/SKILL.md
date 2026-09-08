---
name: write-evlog-content
description: "Write, review, and rewrite any evlog content: a docs page, the landing, a blog post, a package README, a skill, an AGENTS.md, a changeset. Load before drafting or editing prose in apps/docs/content, before writing a blog post, before touching a SKILL.md or an AGENTS.md, and whenever content is reviewed for voice, accuracy, or AI-generated slop. Carries the evlog voice, the atomic rules, the terminology, the competitor dossiers, and the AI-tell corpus with the legitimate twin for each tell."
metadata:
  internal: true
---

# Writing evlog content

Everything needed to draft or judge evlog prose. Two roles use this skill and they must not be merged.

**Review** produces findings and a verdict. It never rewrites, never softens, never proposes wording.
**Rewrite** applies findings. It touches only what a finding names, and cites the rule or tell id for every change.

Splitting them is what keeps the loop honest. A reviewer that can rewrite talks itself into changes it cannot justify, and a rewriter that can re-judge its own output always passes.

## Structure

```
references/
  voice.md        the voice and the five tests. Load first, always
  rules/          atomic rules, one file per surface group
    universal.md    every surface
    docs.md         apps/docs/content
    blog.md         blog posts
    landing.md      0.landing.md and other marketing surfaces
    machine.md      skills and AGENTS.md, the surfaces an agent acts on
  ai-tells.md     the tell corpus, each tell with its legitimate twin
  terminology.md  the names evlog gave its own parts (U-15)
  landscape/      what pino, winston, consola, and OpenTelemetry actually do (U-12)
  surfaces/       what each surface owes its reader
    docs.md  blog.md  landing.md  readme.md  skill.md  agents.md  changeset.md
  samples.md      evlog pages that read right, and why. What the tells must not flag
  corrections.md  accumulated lessons from rejected rewrites. Grows over time
```

Load `voice.md` first. Then the rule file for the surface, `ai-tells.md` when reviewing, and the matching `surfaces/` file when drafting. Open `terminology.md` when a `U-15` candidate is in play and the relevant `landscape/` dossier before writing any sentence that names another logger. Do not load everything.

## The corpus

Everything evlog ships as prose, on both sides of the line:

| Read by | Surfaces | What decides quality |
| --- | --- | --- |
| People | docs pages, the landing, blog posts, the package READMEs | Whether the reader can act, and whether they believe the page |
| Agents | `.agents/skills/`, `skills/`, the `AGENTS.md` files | Whether an agent does the right thing having read only this |

The house rules cross the line: punctuation, terminology, accuracy, dead links. Rhythm does not. A skill whose four steps read as four parallel imperatives is a procedure, and the scanner leaves rhythm alone there. See `rules/machine.md`.

Two parts of that table are excluded from the scan. Evi's own operating skills under `apps/evi/agent/skills/` are outside the corpus because the pass that would rewrite them is the pass they instruct. This skill's own `references/` are outside it because they quote the prose they ban, worked pair by worked pair, and scanning them measures the examples. Both exclusions live in `scripts/content-lint/lib/surfaces.mjs`, and both mean the scanner will never tell you these files drifted. Read them yourself.

## Severity

- `critical` blocks publishing: a wrong code sample, a phantom API, a claim the source contradicts, a landing promise no page delivers.
- `standard` is fixed when the page is touched: voice, rhythm, structure, punctuation.

**A tell about rhythm is never critical on its own.** Epigram density, heading shape, bullet frames, and sentence uniformity describe how prose reads, and prose that reads a certain way has never broken anything.

Correctness takes precedence over the scan score. Verify behavioral claims against the relevant source revision, run examples presented as executable, and check that comparison sources support the exact claim and configuration. Dossiers are research starting points and can be wrong even when recently checked. Search for exceptions to absolute guarantees and check equivalent workloads before drawing benchmark conclusions. A factual fix remains necessary if its style score falls; judge the new candidates before changing the prose again.

Two entries in the tell corpus are not rhythm and do not follow that rule. `T-15` is drift: a symbol or entry point the package does not export, which is a fact the source settles and always critical. `T-13` is a house rule the maintainer decided, and one occurrence is a finding. They live in `ai-tells.md` because that is where the scanner's ids are documented, not because they are matters of taste.

## Reviewing

Run the scanner first, always:

```bash
pnpm content:lint apps/docs/content/2.learn/2.wide-events.md --json
```

It returns per-page metrics, phrase hits, and API-drift findings. With no path it ranks the whole corpus worst-first, which is how a pass picks its target, and `--surface` narrows it to one kind of page:

```bash
pnpm content:lint --top 10
pnpm content:lint --surface skill --top 5
pnpm content:lint --url https://example.com/post --as blog   # a page outside the repo
cat draft.md | pnpm content:lint --stdin                     # prose that is not a file yet
```

Some findings are fixed before anyone reads them. `pnpm content:lint <paths> --fix` applies the rules whose corrected text follows from the rule itself: a retired entry point, a term with one replacement, a link with a redirect behind it. Punctuation is not among them, so every dash reaches you. It re-scans afterwards and reverts any file that scored worse or that introduced a finding id the page did not have, so a fix that trades one problem for another never lands. Run it before reviewing, so a review spends its attention on what a codemod cannot decide.

Rates are compared per surface. A reference page and a skill file have different natural rhythms, and one median over both flatters whichever is looser. A `--url` scan drops every evlog-specific check: someone else's entry points, links, and vocabulary are theirs, so what comes back is how the page reads.

Every scan returns two lists. The findings are what tripped a counter. `modelChecks` is what no counter reached on that page, chosen for its surface and its shape: whether the claims carry a mechanism, whether the opening states a situation, whether a skill's `description` would route to it, whether the code runs. Answer all of them. A review that only works the findings reviews only what was measurable, and a page can satisfy every count while answering nothing.

Then, in order:

1. **Separate the rules from the rhythms.** A house rule (`U-14` punctuation, `T-13` assistant framing, `T-15` a retired entry point) is already decided: one occurrence is a finding. A rhythm (epigram density, uniform sentences, header lock) is a judgment call, and the scanner gives you the rate, not the answer.
2. **Put every rhythm candidate next to its twin.** Each tell in `ai-tells.md` ships `Reads generated` and `Reads legitimate`. Almost every one has a lawful twin in reference documentation: a required and optional field list is a complement set, three drains listed is a rule of three, uniform sentence length is the register of an API page. Say which side the candidate is nearer. If it is nearer the twin, drop it. If it genuinely sits between, keep it and name what made it survive.
3. **Check it against `samples.md`.** These are evlog pages that read right. The test that decides most borderline cases: does the line deliver a fact, a number, a mechanism, or a decision? A short closer that lands a measurement is voice. The same closer restating the paragraph is a tell.
4. **Verify what the scanner flagged as drift.** Every symbol in backticks that the scanner could not find in `packages/evlog/src` is either a doc that outran a rename or a false hit on prose. Read the source before writing the finding.
5. **Check every comparison against its dossier.** A `U-12` candidate means a sentence claims something about pino, winston, consola, or OpenTelemetry with nothing behind it. Open `landscape/<tool>.md`. If the claim is not in the dossier, it is unverified, and unverified is a finding whether or not the claim is true.
6. **Judge the structure yourself.** Header template lock, paragraph-rhythm uniformity, and a page that never lets the reader do anything are invisible to a scanner.

Every finding carries a rule id or a tell id, a verbatim excerpt, and one line on what it costs the reader. A finding that cites neither is taste, and taste does not ship.

Output:

```
## Content review: <path>

**Verdict**: pass | minor | significant | blocked

### Scan
<one line: score, the metrics that are evidence, drift count. Cite a number only when it argues.>

### Critical
- [id] excerpt, then what it breaks.

### Standard
- [id] excerpt, then what it costs.
```

Write `_None._` under an empty heading. `blocked` requires a critical finding. `significant` means two or more standard findings that compound, or one that reaches the lede or the title.

## Rewriting

A rewrite starts from a review, never from a page. Rules:

- Change only what a finding names. A page with three findings gets three edits.
- Never touch a code block unless a finding says the code is wrong, and then verify the fix against `packages/evlog/src` before writing it.
- Preserve MDC structure exactly: component blocks, prop blocks, `:br`, frontmatter keys and their order.
- Keep every link target. If a rewrite removes the sentence that held a link, place the link on the sentence that replaces it.
- Output the full file, not a diff, and list what changed with the id that justified it.
- **A page that passes review comes back unchanged.** No finding, no edit. Nothing forces a rewrite to happen.

Content is prose about a system that changes. When the review and the source disagree, the source wins and the finding becomes a doc fix, not a wording fix.

## Calibration

Two fixtures pin what this skill is worth: `scripts/content-lint/fixtures/generated.md`, saturated on purpose, and `written.md`, which carries the lawful twins. `scripts/content-lint/fixtures.test.mjs` fails if the distance between their scores closes, and `apps/evi/evals/content/` fails if a reviewer passes the first or finds fault with the second.

A change to the corpus, a rule, or a threshold runs both. A tell that cannot separate those two pages is not measuring anything.

## Keeping this skill true

The corpus and the rules are working documents. When a review flags something that should have passed, or the maintainer overrides a rule, the lesson goes in `corrections.md` the same day. When a tell only ever produces its own false positives on this corpus, delete it from `ai-tells.md` and from `scripts/content-lint/lib/corpus.mjs` in the same change. A tell nobody trusts is worse than no tell, because it trains the reviewer to skim the list.
