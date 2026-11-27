# evlog docs (next)

Proof of concept for the v3 docs: the evlog.dev landing, unchanged, on top of the [comark-docs](https://github.com/comarkdown/comark-docs) layer, with v2 and v3 served side by side.

| URL | Content | Read from |
| --- | --- | --- |
| `/` | v3, organised by product | `apps/docs-next/content` on this branch |
| `/v2` | v2, unchanged | `apps/docs/content` on `main` |

In development, `/v2` reads the local git repository at `main`, so it renders without checking `main` out. In production it reads GitHub, at the latest commit of `main` that touched `apps/docs/content`.

## Versions

The versions are listed once, in `versions` at the top of `nuxt.config.ts`. An entry with a `branch` and a `contentDir` is mounted at `/<id>`; the entry without is this app's own content.

The layer has no mounted versions, so the app adds them on top of what the layer does for branch previews:

- `app/utils/versions.ts` reads the version from the path. `/v2/<path>` has no route of its own: it matches the docs catch-all.
- `app/composables/useDocsContent.ts` wraps the layer's composable and answers `mode: 'version'`, `routeBase: '/v2'` for those paths, so navigation, links and page data come from `/api/content/v2`.
- `server/utils/mounted-versions.ts` builds the content instance of a version, with the layer's parser and sources, pinned to the commit its branch resolves to.
- `server/api/content/v2/` holds the data endpoints. A new mounted version needs the same two files under its own id.
- `app/composables/useSearch.ts` is the layer's composable with one more target, so the search of a `/v2` page reads the v2 index.

`/v2` redirects to the first v2 page. v2 pages are `noindex`, and stay out of the sitemap, `llms.txt` and the markdown routes.

## Run it

The app links a local checkout of the layer, expected at `../../../comark-docs-versions` next to this repository:

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
