# evlog docs (next)

Proof of concept for the v3 docs: the evlog.dev landing, unchanged, on top of the [comark-docs](https://github.com/comarkdown/comark-docs) layer, with v2 and v3 served side by side.

| URL | Content | Read from |
| --- | --- | --- |
| `/` | v3, organised by product | `apps/docs-next/content` on this branch |
| `/v2` | v2, unchanged | `apps/docs/content` on `main` |

In development, `/v2` reads the local git repository at `main`, so it renders without checking `main` out.

## Run it

The layer's version support is not released yet. Until it is, the app links a local checkout of the layer's `feat/mounted-versions` branch, expected at `../../../comark-docs-versions` next to this repository:

```bash
cd ../../../comark-docs-versions && pnpm install && pnpm dev:prepare
cd - && pnpm install
pnpm --filter evlog-docs-next dev
```

`resolve.dedupe` in `nuxt.config.ts` exists for that link: without it, the layer's files load a second Vue and Nuxt, and the page never hydrates. It goes once the layer is a regular dependency.

## Layout

- `content/` holds the v3 pages: one section or page per product (Events, Errors, Drains, Map, Signals, Audit, Skills, Telemetry), then Integrations and Reference.
- `app/components/content/ProductFacts.vue` is the strip under each product title: import, package, status.
- The landing components, the content animations and `FrameworkTabs` are copied from `apps/docs`.
