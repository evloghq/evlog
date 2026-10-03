# evlog docs (Docus site)

Read the root `AGENTS.md` first. This file only adds docs-specific rules.

## Nuxt UI components in MDC

Nuxt UI ships the components this site renders inside markdown. Use them as the module exposes them, and never rename or re-skin one from the outside.

- **Call the component by its MDC tag, not by its Vue name.** `@nuxt/ui` registers a tag map (`mdc.components.map` in its module): `::accordion`, `::accordion-item`, `::callout`, `::card-group`, `::code-group`, `::collapsible`, `::field`, `::steps`, `::tabs`. Writing `::prose-accordion` reaches the same globally-registered component by accident and is wrong: the tag map is the public surface, the `Prose*` names are Nuxt UI internals.
- **Only pass props the prose wrapper declares.** The wrappers are thin and expose a small set (`ProseAccordion` takes `type`, `class`, `ui`). Anything else lands on the underlying component through attribute fall-through, which happens to work until the wrapper grows a root element. Read the component in `node_modules/@nuxt/ui/dist/runtime/components/prose/` before inventing an attribute.
- **Style a component through its own `ui` prop or `app.config.ts`**, never by wrapping it in a bordered box. An accordion already draws its dividers; a parent that adds a border and a background is fighting the theme and will drift from it.
- **A component carries meaning, not texture.** An accordion holds answers the reader chooses between. Do not fold prose that already reads fine into a component, and never restate on a page something the same page says a few paragraphs above.

## Framework tabs

A group of snippets keyed by framework uses `::framework-tabs`, not `::code-group`. Same body: one fence per framework, the framework in the bracket label (`[Nuxt]`, `[Nitro]`, `[Hono]`, `[lib/evlog.ts (Next.js)]`), the file path as a leading `// path` comment. Nuxt and Nitro are two fences even when the body is identical: the reader picks one name, not a pair. The component (`app/components/content/FrameworkTabs.vue`) renders a single picker, not a tab strip, so a group can hold every integration without wrapping. It resolves each label through `app/utils/frameworks.ts` for the colour logo, and the choice is a cookie (`useFramework`) shared by every group on the site and read on the server, so the first paint already shows the chosen framework. A label naming no framework still renders, without a logo, and viewing it does not change the site-wide choice. A single fence headed by a framework name (`[Nuxt (auto-imported)]`) goes through the same registry in `app/components/prose/Pre.vue`. New integration: add it to the registry with its `logos:` mark, or a colour SVG in `app/assets/icons/` when the collection lacks one. Never tint a monochrome icon to fake a brand colour.

Nothing else goes inside the group. A `::callout` between two fences closes the group at its own `::` and the fences after it fall out as loose blocks.

`::code-group` stays for everything else: package managers, input/output pairs, before/after.

## Structured data

JSON-LD carries the facts that are **not** already in the page text: the license, the price, the application category. Never restate the page's own prose in it. Copy is crawlable where it is written, so a second copy in a `.vue` file buys nothing and drifts.

**The identity is configuration.** `seo.schema` in `app.config.ts` says what the site *is*; Docus emits it from `useSeo` as one linked graph, alongside `WebSite` on the landing and `Article` + `BreadcrumbList` on every docs page. A product node written by hand competes with that graph instead of extending it. What the config cannot express (the license, the author) goes in a node reusing the same `@id`, so it merges into the identity rather than declaring a second product.

`app/pages/index.vue` replaces the Docus landing template, so it calls `useSeo({ type: 'website' })` itself. Drop that call and the site silently loses its identity graph, its canonical, and its OG tags.

The landing's `FAQPage` is read back from the accordion the page renders, never written by hand. It buys no rich result, since Google restricted those to government and health sites in 2023, and it stays for the answer engines that do read it.

## Interactive doc components

A component the reader operates (`LogCostCalculator`) is not a looping animation and does not follow the rules below: it has no timeline, and it is as tall as its controls need. Two rules do carry over: it must not shift the layout while the reader uses it, and it stays inside `sm:` breakpoints.

What is specific to it: **a component that computes a number shows where the number came from.** Measured constants carry the measurement in a comment and on screen, third-party figures carry the date they were read, and any rate that can go stale is an input the reader can overwrite rather than a claim the page makes.

## Doc animation components (`app/components/content/`)

MDC animation components (e.g. `EnricherChain`, `DrainFanOut`, `StreamBus`) follow a strict set of rules:

- **Fixed outer size, always.** The component must occupy the same height and width from t=0 to the end of the loop. Layout below the animation must not shift while the user reads the page.
- **Pre-allocate every slot.** Lines, rows, frames, buffer cells must all exist in the DOM from the start. Animate `opacity`, `color`, `transform`, never `max-height: 0 → N`, never conditional `v-if` on structural elements.
- **Use `useTimedSequence`** from `~/composables/useTimedSequence` for the timeline. Honor `prefers-reduced-motion` by snapping to the final state.
- **Wrap in `<Motion>` from `motion-v`** with `not-prose my-8` and an `IntersectionObserver` so the animation starts when scrolled into view.
- **Header bar** with status pill + play/pause + restart buttons (mirror `DrainFanOut.vue`).
- **Compact by default**: `text-[10px]` for body, `text-[9px]` for footers/labels, `leading-tight` or `leading-snug`, `py-1.5` / `py-2` headers/footers, `space-y-0.5` or none, `gap-1.5` or smaller. The doc page width (sidebar + TOC) is narrow; aim for a final height under ~280px.
- Use `<div>` (not `<ol>/<li>`) for repeating slots. List elements collide with grid layout in Docus.
- **No viewport-dependent layout shift.** Stick to a single column at any width or use `sm:` for the optional split, never `lg:` (the doc content area never reaches the `lg:` breakpoint).

## Capture hooks (`data-section`)

Every landing section and every MDC content component carries `data-section="<its MDC tag>"` on its root element: `LandingHero.vue` renders `data-section="landing-hero"`, `DrainFanOut.vue` renders `data-section="drain-fan-out"`.

- **A new section component adds its hook in the same commit.** The value is the kebab-case MDC tag the markdown already uses, so the two never have to be reconciled.
- **The hook exists because utility classes cannot identify a section.** Eleven landing sections render the identical `section.py-24.md:py-32`; a screenshot tool handed that selector frames the wrong one, or silently frames the top of the page.
- **It is a tooling hook, not an anchor.** Add an `id` when a section deserves a real URL fragment. Keep the two separate: an `id` gets renamed for reader-facing reasons, `data-section` follows the component.
