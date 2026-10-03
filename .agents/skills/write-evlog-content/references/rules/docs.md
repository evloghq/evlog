# Docs rules

Apply to `apps/docs/content/`. Load alongside `universal.md`.

---

**D-01 · One page answers one intent** · `standard`

Rule: a page has a single question it exists to answer, stated in its `description` frontmatter. Material that answers a different question belongs on the page that owns it, behind a link.
Why: pages that grow by accretion get skimmed, and the reader stops finding the answer that was there.

---

**D-02 · The description is the answer, not the label** · `standard`

Rule: `description:` in frontmatter states what the reader gets, in a full sentence. It is the search result and the LLM summary.
Bad: `description: Documentation for the sampling feature.`
Better: `description: Drop low-importance events at emit time and force-keep slow requests and errors, so your bill scales with signal instead of traffic.`
Why: it is the highest-leverage sentence on the page and the one most often written last.
Length: between 50 and 160 characters. A search result shows about 160, so anything past that is a sentence nobody finishes reading, and anything under 50 pays for a slot it does not use. The scanner measures both.
Note: this applies to pages that serve a route. A `SKILL.md` description is a routing decision for an agent (`M-06`) and is long on purpose.

---

**D-03 · Prose before code, always** · `standard`

Rule: a code block is preceded by the sentence that says what it does and when you would reach for it. A page never opens on a block.
Why: readers scan code first and then look up for the reason. If the reason is below, they leave with the wrong mental model.

---

**D-04 · Show the failure, not only the success** · `standard`

Rule: where a feature exists because something goes wrong, the page shows the wrong shape before the right one: the scattered logs before the wide event, the opaque error before the structured one.
Why: this is how evlog's own strongest pages work, and it is what makes the API feel inevitable instead of arbitrary.

---

**D-05 · MDC structure is content, not decoration** · `critical`

Rule: `::callout`, `::card-group`, `::code-group`, `::prompt`, `::steps` carry meaning. A callout holds the exception the reader will hit. A card group holds a set the reader chooses from. Do not convert prose into components for texture, and never leave a component with a body that would read the same as a paragraph.
Why: every component costs vertical space, and a decorative one pushes the answer below the fold.

---

**D-06 · No HTML comments in Vue templates or MDC blocks** · `critical`

Rule: repo-wide. `<!-- -->` never appears in a `<template>` block or inside MDC content.

---

**D-07 · Options are tables, not prose** · `standard`

Rule: a set of configuration options with types and defaults is a table. Prose describing each option in sequence is a table someone refused to write.
Why: nobody reads an options list linearly, and a table makes a missing default visible.

---

**D-08 · Link laterally, once** · `standard`

Rule: when a page names a concept another page owns, link it on first mention and not again. Every page names at least one next step.
Why: the docs are a graph the reader navigates by curiosity. A page with no outbound link is a dead end, and a page with the same link six times is noise.

---

**D-09 · Frontmatter stays intact through a rewrite** · `critical`

Rule: keys, order, `navigation.icon`, and `links:` entries survive an edit unchanged unless a finding names them. Icons and link colors are design decisions.

---

**D-10 · The page matches the code it documents** · `critical`

Rule: symbols, option names, defaults, and error codes are verified against `packages/evlog/src` at review time. A rename in the package is a docs bug the moment it ships.
Why: this is the only class of docs defect that silently converts a correct reader into a wrong one.

---

**D-11 · Every page is suggested by another page** · `standard`

Rule: at least one other page links to this one in prose, a table, or a card. The navigation is not a substitute: it lists what exists, it does not tell a reader when they need it.
Why: `voice.md` promises that the docs suggest the next move rather than waiting to be searched. A page nothing points at is a page that only answers a search someone already knew how to run.
Note: the scanner reads links from prose, from table cells, and from `to:` / `href:` props in MDC components, so a card group counts. A section index is exempt, since the navigation is how it is meant to be reached, and a page linking to its own route does not count as being suggested.

---

**D-12 · An anchor points at a heading that exists** · `critical`

Rule: every `#fragment` in a link resolves to a heading on the page it targets, whether that page is this one or another.
Why: a renamed heading takes its anchor with it, and nothing reports the break. The link still resolves, the page still loads, and the reader lands at the top of a long page having been promised a section.
Note: the fragment is slugged the way the renderer does it, which removes punctuation rather than collapsing it. `Drain & Enrichers` anchors as `drain--enrichers` and `The ratchet: --baseline` as `the-ratchet---baseline`, both carrying the extra dash the removed character left behind. Links to another host carry someone else's fragments and are left alone.

---

**D-13 · The result comes before the explanation** · `standard`

Rule: the first screen of a page shows what the reader gets: an output, a query result, a number from a real run. The mechanism, the install and the options follow it. A problem is named only as the reason the result matters, never as the opening on its own.
Bad: a page that opens with a scenario, then the API, then the options, and shows the first output in the fourth section.
Better: the demo's output table in the second paragraph, three numbers read from it, then "Add your first signal".
Why: a reader who does not know evlog decides on the first screen whether the page is for them. A problem they recognise keeps them reading; a result they want makes them try it. Only the second one converts.

---

**D-14 · One path in the core, every knob in one place** · `standard`

Rule: the quick start follows a single framework and a single command. Other frameworks sit behind a `::collapsible` or a `::code-group` tab. Options, defaults, counters and env vars live on one reference page per feature, tabbed by object with `::tabs`, and the prose pages link to it once instead of carrying their own option tables.
Why: a core path with three branches reads as three products. A reader looking for a default should know which page has it before they search, and a table repeated across three pages drifts across three pages.
