# Samples

Passages from evlog's own pages that read right, with the reason. Use them when a candidate finding is borderline: these are what the tell list must not flag.

Quotes are verbatim at the time of writing, and some of them still carry the em dashes that `U-14` now bans. That is what a corpus older than its rule looks like. The sample is here for what its sentence does, not for its punctuation, and a pass that touches one of these pages fixes the dash and updates the quote here.

---

## Opening on a cost, not a definition

`1.start/2.why-evlog.md`

> The cheapest moment to add structured logging is **before the first request**. By the time you have 200 routes, 40 background jobs, and a `console.log` per file, you're paying interest on a decision you never made.

General in shape and specific in content: three quantities and a named cost. This is the twin for T-09, the abstract truism cold open. The difference is that this opener could not be pasted onto another product's page.

---

## An admission that makes the rest believable

`1.start/2.why-evlog.md`

> The primitives are table stakes, every modern logger has some flavour of them. Where evlog earns its place on day 1 is everything wired around them, for problems you haven't had yet.

The page concedes the commodity part of the product before making its claim. `U-13` in practice. Quoted with the dash removed, which is what the fix looks like.

---

## A claim that survives substitution

`0.landing.md`, the `evlog map` card

> The first time most teams learn a handler logs nothing is mid-incident. Think Lighthouse, but for observability: a score for the context your app will give you when it breaks, and the exact list of fixes to raise it.

Replace `evlog` with any competitor and this stops being true, because it describes a specific command's output. The title above it, `One command. :br Every blind spot`, is the deliberate fragment rhythm of `L-05`, and it lands a distinct capability, which is what separates it from T-03.

---

## Showing the wrong shape first

`2.learn/2.wide-events.md`

The page prints six `logger.info` lines, names what is broken about them in four bullets, then shows the wide event that replaces them. `D-04` in practice. The concept never has to be argued for, because the reader has already recognized their own file.

---

## Register discipline on a reference page

`2.learn/2.wide-events.md`

> Wide events are the core concept behind evlog. Instead of scattering logs throughout your codebase, you accumulate context over any unit of work, whether a request, script, job, or workflow, and emit a single, comprehensive log event.

Second person, present tense, the system and the reader both acting. No superlative, no dash, no epigram. This is the baseline register. Most of the docs should sound like this, and a page that sounds livelier than this everywhere is worth a second look.

---

## What is missing from this file

No blog sample, because there is no blog yet. The first post that passes review gets added here, and until then blog review leans on `rules/blog.md` and this register.

---

## Opening on the result, not the mechanism

`5.use-cases/7.signals/01.overview.md`

> Your logs tell you a request returned 502. A signal tells you it was Stripe, that a retry would have worked, and that it is not worth waking anyone. Your logs tell you a checkout returned 200. A signal tells you the customer left without an order.

Two pairs, each one "what you have" against "what you get", on a request the reader has seen. No definition, no API name, no scenario to walk through. The next screen is a table of judged requests with three numbers read from it, and the install comes after. `D-13` in practice, and the maintainer's reference for what "make them want it" means: the reader sees the column before they see the function that produces it.
