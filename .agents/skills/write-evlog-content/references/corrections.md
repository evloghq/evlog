# Corrections

Lessons from rewrites that were rejected, and from findings that turned out to be wrong. This file grows; nothing else in the skill does.

Add an entry when a review flags something that should have passed, when a rewrite regressed a page, or when the maintainer overrides a rule. One entry, four lines, no narrative.

```
## <date> · <rule or tell id> · <one-line title>
Flagged: what the review said.
Actual: why it was wrong, or what the maintainer wanted instead.
Applies to: the surfaces or pages this holds for.
```

An entry that repeats itself three times is a rule that needs changing, not a correction that needs restating.

---

## 2026-08-15 · T-06 · A shared template is not a mould

Flagged: 51 pages, "all N headings are noun". The adapter and framework pages carry Installation, Quick Start, Configuration, Troubleshooting and Next Steps by design.
Actual: a page set written to one shape is not a page written from a mould. A reader comparing Axiom and Datadog wants to land on the same section twice, and 14 of those headings are linked by anchor from elsewhere in the docs.
Applies to: any directory of sibling pages. `scripts/content-lint/lib/score.mjs` now subtracts the headings a page shares with three or more siblings before judging the shape of what is left, which took the finding count from 51 to 47. The 47 that remain each have ten or more headings of their own, all nouns, and those are real.

## 2026-08-15 · T-07 · Four bullets is not enough to see a mould

Flagged: four lists, all four lawful. Controlled variables on the benchmark page (`Same output mode`, `Same warmup`, `Same tooling`, `Same machine`), a decision matrix (`Pick evlog over pino`, `over winston`, `over consola`, `Stay on pino`), a pitfalls list, and a list of example consumers.
Actual: at four items a 75% share is three bullets, which is what parallel content looks like when it is doing its job. The tell is uniformity imposed on content that is not uniform, and four items cannot show that.
Applies to: every surface. `score.mjs` now needs five items. Two other openers were leaving by construction rather than by voice and are stripped first: an ordinal in a numbered list, and the `code` placeholder a symbol or a code-labelled link leaves behind.

## 2026-08-15 · U-15 · A codemod rewrote the rule that defines it

Flagged: nothing. This was found by reading.
Actual: the corpus-wide `--fix` sweep replaced `sink` with `drain` inside `terminology.md` itself, so the table of words to avoid listed `drain`, and `universal.md`'s worked pair read `Bad: "Register the drain"`. The rule told a reviewer to reject the correct word.
Applies to: any codemod. `corpusFiles` already excludes this directory, and the guard that enforces it landed after that sweep ran. Never point `--fix` at a path by hand; pass the corpus and let the exclusions do their job.

## 2026-08-15 · U-15 · `transport` is not evlog's word to reclaim

Flagged: 13 pages using `transport`.
Actual: all 13 were lawful. pino's transports in a migration section, the HTTP transport that carries browser logs, HyperDX's own exporter, and `not a transport` meaning "not a delivery mechanism". The rule cannot tell evlog's drain from the transport layer by reading one line.
Applies to: the scanner only. `terminology.md` still prefers `drain`, and a reviewer should still say so. `sink` and `exporter` stay in the table, since neither has a lawful second meaning here.

## 2026-08-15 · T-03 · A closer ending on a colon introduces something

Flagged: `Never log:`, `This enables:`, `In the Sentry dashboard:`.
Actual: a short final sentence ending on a colon is the sentence of the table or list below it, not a flourish. Six of eight candidates were this.
Applies to: every surface. `metrics.mjs` no longer counts a closer that ends on a colon.

## 2026-08-15 · T-06 · A numbered sequence is not a mould

Flagged: pages whose headings read `1. Route filtering`, `2. Logger creation`, `3. Emit`.
Actual: the steps of one procedure share a shape because they are one procedure. `ai-tells.md` already named the ordered guide as the twin; the scanner did not know it.
Applies to: any heading opening with a number or `Step N`. `metrics.mjs` classifies those as `sequence` and `T-06` ignores that shape, which took the count from 44 to 35.

## 2026-08-15 · U-14 · Punctuation is never mechanical

Flagged: a codemod replacing `A — B — C` with `A, B, C`.
Actual: 25 of 38 replacements turned a parenthetical list into a sentence whose subject was followed by four bare nouns. The correct mark depends on whether the dashed span is an appositive, a list, a cause, or a second thought, and only a reader can tell.
Applies to: every surface. The rule now ranks the replacements and the codemod does not touch punctuation at all.

## 2026-08-15 · U-15 · A term attached to its owner belongs to the owner

Flagged: `exporter` on the HyperDX and eve pages.
Actual: every occurrence named someone else's part. An `otlphttp` exporter is a key in a collector config and PostHog's exporter is PostHog's. Renaming either to `drain` would send a reader looking for a config key that does not exist.
Applies to: every term in `terminology.md`. `corpus.mjs` drops a hit whose paragraph names a product evlog documents, the same shape as the exception the alternatives already had, with the collector and the adapter vendors added to the list.

## 2026-08-15 · T-03 · A card body is a caption

Flagged: `Zero config.` closing a `::card` on the frameworks overview.
Actual: a card is a link tile and its body is sized to the tile, so every one of them ends on a short line. Counting them measures the component, not the page's rhythm.
Applies to: `::card` on every surface. `metrics.mjs` leaves card bodies out of the eligible population.

## 2026-08-15 · T-06 · A page that lists is allowed parallel headings

Flagged: `Exit codes`, `The JSON contract`, `The map file`, `Monorepos` on the CLI pages, and 19 other pages of the same shape.
Actual: `ai-tells.md` already named the twin, parallel headings over parallel entries, and in the file that looks like a section holding a table or a fence and almost no prose. The tell is a mould over sections that argue.
Applies to: every surface. `metrics.mjs` measures the share of sections that list, and `T-06` drops at 0.6 or above, which cleared 20 pages.

## 2026-08-15 · U-14 · A bullet is prose

Flagged: nothing, for a year. The rule only ever read headings and paragraphs, so 276 dashes sat in list items untouched, most of them in the `Next steps` list at the bottom of a page.
Actual: 159 were a bold term glossed after a dash, which the corpus elsewhere writes with a colon. The remaining 117 put a full clause after the dash and need a reader.
Applies to: list items on every surface. Table cells stay out: a cell is a fragment and a dash between two of its parts is layout.

## 2026-08-15 · U-14 · A dash between two numbers is a range

Flagged: `~30–80 lines of glue`.
Actual: an en dash between two numbers is the mark that reads as a range, and no comma, colon or period replaces it. The rule was never about that dash.
Applies to: every surface. `metrics.mjs` ignores a dash with a digit on each side.

## 2026-08-15 · T-06 · A question does not need its mark, and the verb list was too short

Flagged: `Where the byte counts come from`, `Which number moves your bill`, `Try it against your numbers`, `Ask it from your editor`, and 8 pages of the same kind.
Actual: the classifier only saw a question when the heading ended on `?`, and its verb list held 42 words while the corpus writes with far more. Both made a page of answers look like a page of nouns.
Applies to: every surface. `classifyHeading` reads an interrogative opener as a question, and the verb list grew to 89. Words that are evlog's own nouns first (`log`, `route`, `stream`, `trace`, `filter`, `drain`) are kept out of it, since counting `## Route filtering` as an imperative would weaken the rule rather than correct it.

## 2026-08-15 · U-12 · `without X` is a condition, not a comparison

Flagged: `Without \`setup\`, OpenTelemetry export is untouched`.
Actual: the sentence states what evlog does when an option is absent. `without` and `instead of` only compare what directly follows them, and here that is `setup`, not the alternative named after the comma.
Applies to: every surface. `corpus.mjs` reports those two words only when the alternative is their object, and leaves the unconditional comparatives alone.

## 2026-08-15 · T-11 · A seam is a stitch, not a page

Flagged: two paragraphs 87 and 141 lines apart, on a page whose other paragraphs offered no contraction to count.
Actual: the metric walked the paragraphs that had opportunities and called any two of them adjacent. Two registers at opposite ends of a page are not what a stitch looks like; the tell is a passage dropped into another one.
Applies to: every surface. `metrics.mjs` only reports a seam between paragraphs at most three apart on the page.

## 2026-08-15 · U-14 · Two hyphens are an em dash

Flagged: nothing. `--` between spaces reached nothing at all, and the README carried five of them.
Actual: `is auto-imported -- no import needed` is the same mark written with the keys at hand. Table cells and fenced code keep theirs, since `evlog-map-disable-next-line wide-event -- reason` is the CLI's own syntax.
Applies to: prose on every surface.

## 2026-08-15 · D-12 · Renaming a heading breaks the links to it

Flagged: nothing. Three anchors across two pages pointed at headings this branch had renamed, and one had been dead since before it.
Actual: a broken fragment reports no error anywhere. The page loads, the link resolves, and the reader arrives at the top of it. The scanner checked no anchor at all, and the audit written by hand only compared cross-page links, so same-page ones stayed invisible twice.
Applies to: `apps/docs/content/`. `reach.mjs` now resolves every fragment against the headings of the page it targets. Rename a heading and the link is a second edit, not an optional one.

## 2026-09-10 · U-04, D-01 · Accuracy should preserve the product promise

Flagged: introductory claims and migration copy were rewritten as implementation constraints; two search entry pages repeated onboarding and reference material.
Actual: keep a confident, benefit-led introduction, correct unsupported claims, and put detailed limits where the reader makes that decision. Give each guide a distinct task and contextual links from the existing documentation.
Applies to: introductory pages, product summaries, and new documentation guides. A factual correction does not require turning marketing copy into a warning.
