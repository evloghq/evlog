# content-lint

Deterministic evidence for an evlog content review. It measures; it does not decide.

The doctrine it serves lives in [`.agents/skills/write-evlog-content/`](../../.agents/skills/write-evlog-content/SKILL.md). Every finding carries the id of a rule or a tell there, and that entry holds the legitimate twin that decides whether the candidate survives. A page whose prose is uniform because its content is uniform will trip several of these checks and be right to.

## Running it

```bash
pnpm content:lint                              # rank the whole corpus, worst first
pnpm content:lint --top 10                     # the ten files most worth a pass
pnpm content:lint --surface skill --top 5      # one surface only
pnpm content:lint apps/docs/content/2.learn/2.wide-events.md   # one file, with findings
pnpm content:lint --json                       # machine-readable, for an agent
pnpm content:lint --min-score 60               # exit 1 below the bar
pnpm content:lint --url https://… --as blog    # a page that is not in the repo
cat draft.md | pnpm content:lint --stdin       # prose that is not a file yet
```

## Fixing what is derivable

```bash
pnpm content:lint <paths…> --fix             # rewrite in place, report every change
pnpm content:lint <paths…> --fix --dry-run   # print what it would do, write nothing
```

A rule reaches `lib/fix.mjs` only when the corrected text follows from the rule rather than from taste:

| Rule | Fixed | Left to a reader |
| --- | --- | --- |
| `T-15` | `evlog/shared` → `evlog/toolkit`, `evlog/browser` → `evlog/http` | a page documenting the deprecation, which is skipped |
| `U-15` | `sink` → `drain`, `error registry` → `error catalog` | `child logger`, which does not slot into the same sentence |
| `U-16` | a link with a redirect behind it | a link with no destination |
| `U-14` | nothing | every dash. A dashed span is sometimes an appositive and sometimes a list, and commas wreck the second kind |

After writing, each file is re-scanned. If the score dropped or a new finding id appeared, the file is reverted and reported as unfixed — that check is the whole argument for running this before a reviewer sees the file. `--fix` refuses to run without explicit paths: a corpus-wide rewrite is a maintainer's decision.

`--url` fetches, drops nav, header, footer, and aside, prefers `<main>` then `<article>`, and turns what is left back into markdown so every check downstream is the one that runs on a docs page. A script-rendered page yields nothing and says so rather than reporting clean. An external scan drops the evlog-specific checks (`T-15`, `U-12`, `U-15`, link resolution): someone else's entry points, links, and vocabulary are theirs.

The baseline is always the whole corpus, never the selection: a single-file run returns what a full sweep would say about that file. Rates are compared within a surface, so a reference page is not measured against a blog post.

## The corpus

Defined in `lib/surfaces.mjs`, not in the caller:

| Surface | Files | Judged on |
| --- | --- | --- |
| `landing` `docs` `reference` `blog` | `apps/docs/content` | everything |
| `readme` | `packages/*/README.md` | everything |
| `skill` | `.agents/skills/`, `skills/` | house rules and drift only |
| `agents` | `AGENTS.md`, `apps/*/AGENTS.md` | house rules and drift only |

Rhythm checks are off on the last two. Those files are read by an agent that will act on them, and four parallel imperatives there are a procedure, not a template.

Three absences are deliberate: `apps/evi/agent/skills/` (the pass's own instructions), the doctrine's own `references/` (they quote the prose they ban), and the root `README.md` (a symlink onto the package one).

## What it measures

| Check | Id | How it fires |
| --- | --- | --- |
| Phrase corpus | T-01 T-04 T-08 T-09 T-13 T-15 | summed tell weight over a per-surface budget |
| Em and en dashes | U-14 | every occurrence, with the sentence holding it |
| Epigram closers | T-03 | short final sentences carrying no number, symbol, or link |
| Header template lock | T-06 | 90% of headings in one grammatical shape |
| Bullet frame lock | T-07 | 4+ bullets sharing an opener, or near-identical lengths |
| Register seam | T-11 | contraction density jumping between adjacent paragraphs |
| Uniform rhythm | T-12 | sentence-length variation below 0.35 |
| Unbacked section | T-14 | 80+ words with no code, link, number, or symbol |
| API drift | T-15 | an import or entry point the package does not export |
| Off-name term | U-15 | evlog's own concept under another tool's word |
| Unbacked comparison | U-12 | a claim about pino, winston, consola, or OTel with no number and no link |
| Dead internal link | U-16 | a `/path` with no page, or a relative link resolving to nothing on disk |

Surfaces carry different budgets. `0.landing.md` and `8.reference/` are held tightest on hollow vocabulary and loosest on rhythm; `2.learn/` and blog posts are the reverse.

## What it cannot measure, and says so

Alongside the findings, every scan returns `modelChecks`: the questions no threshold reaches on this page, conditioned on its surface and its shape. A page with code blocks is asked whether the samples run; a skill is asked whether its `description` would route to it; a page naming pino is pointed at the dossier. Nothing here is scored, and that is the point. The findings are what a counter caught, and this is the list of what the counters are blind to, handed to whoever reads next instead of left implicit.

The pass carries them through to `content_review` untouched, and the reviewer answers every one in its report.

## Keeping it from sliding back

```bash
pnpm content:lint --since origin/main
```

Scores every corpus file the branch changed against the same file on the base, and exits 1 when one comes back worse. Worse means a lower score, or a finding id that appears more often than it did: trading a dash for a hollow superlative costs the same and is not progress.

It is a ratchet rather than a floor on purpose. A fixed `--min-score` fails a new page written at 85 while a page that has sat at 60 since last year passes untouched, so the bar punishes whoever writes next instead of whoever wrote last.

Corpus-level findings are left out of the comparison. A page cannot answer `D-11` on its own: another page has to link to it.

The Test job runs this on every pull request.

## Calibration

`fixtures/generated.md` is saturated on purpose and `fixtures/written.md` carries the lawful twins. `fixtures.test.mjs` fails when the distance between their scores closes, in either direction. A tell that cannot separate those two files is measuring nothing, and the same pair backs the content evals in `apps/evi/evals/content/`.

## Design notes

**MDC-aware.** Frontmatter, code fences, and `---` prop blocks never reach the metrics, while prose *inside* a `::card` does. On the landing page that is all the prose there is.

**Two kinds of threshold.** A house rule fires on the first occurrence, because the decision is already made: no em dash, no assistant framing, no retired entry point. A rhythm is judged against the corpus itself, since what counts as elevated depends on how evlog already writes, with an absolute floor so a uniformly slack corpus cannot normalise itself.

**Drift by near-miss.** Docs legitimately name third-party APIs, so an unknown symbol in prose proves nothing. Only a symbol within two edits of a real export is reported, and only imports from an evlog entry point are checked strictly.

## Extending it

- A new phrase tell: add it to `lib/corpus.mjs` with a weight, and write its entry, with its legitimate twin, in `references/ai-tells.md`. The two must ship together, or the reviewer gets a candidate with nothing to judge it against.
- A new measurement: add it to `lib/metrics.mjs` (numbers and located candidates only), then decide when it fires in `lib/score.mjs`.
- A rule no string can match: it belongs in `lib/model-checks.mjs`, as a question with the id it answers to. That file is where a rule goes when the honest answer is "a reader has to decide this".
- A new surface: add it to `lib/surfaces.mjs` with its profile and its files, and write `references/surfaces/<name>.md` in the same change. A surface the scanner ranks and the doctrine cannot describe produces findings nobody can act on.
- Tests are colocated: `pnpm content:lint:test`, run in CI by the Test job.
