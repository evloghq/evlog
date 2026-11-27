# evlog docs (next)

The v3 docs: the evlog.dev landing and the v3 pages, rendered with Nuxt UI and [Comark](https://github.com/comarkdown/comark), with v2 and v3 served side by side.

| URL | Content | Read from |
| --- | --- | --- |
| `/` | v3, organised by product | `apps/docs-next/content` on this branch |
| `/v2` | v2, unchanged | `apps/docs/content` on `main` |

In development, `/v2` reads the local git repository at `main`, so it renders without checking `main` out. In production it reads GitHub, at the latest commit of `main` that touched `apps/docs/content`.

## Versions

The versions are listed once, in `versions` at the top of `nuxt.config.ts`. An entry with a `branch` and a `contentDir` is mounted at `/<id>`; the entry without is this app's own content.

Mounted versions work like this:

- `app/utils/versions.ts` reads the version from the path. `/v2/<path>` has no route of its own: it matches the docs catch-all.
- `app/composables/useDocsContent.ts` answers `mode: 'version'`, `routeBase: '/v2'` for those paths, so navigation, links and page data come from `/api/content/v2`.
- `server/utils/mounted-versions.ts` builds the content instance of a version, with the app's parser and sources, pinned to the commit its branch resolves to.
- `server/api/content/v2/` holds the data endpoints. A new mounted version needs the same two files under its own id.
- `app/composables/useSearch.ts` has a `version` target, so the search of a `/v2` page reads the v2 index.

`/v2` redirects to the first v2 page. v2 pages are `noindex`, and stay out of the sitemap, `llms.txt` and the markdown routes.

## Run it

```bash
pnpm install
pnpm --filter evlog-docs-next dev
```

## Agents and search engines

- Every page answers markdown to `Accept: text/markdown`, and at `/raw/<path>.md` and `<path>.md` (`nuxt-agent-discovery`).
- `/llms.txt` and `/llms-full.txt` list the v3 pages in sidebar order (`nuxt-llms`, `modules/config/runtime/server/plugins/llms.ts`).
- `/mcp` is an MCP server with tools to list, read and search the pages (`@nuxtjs/mcp-toolkit`, `server/mcp/tools/`).
- Canonical URLs, Open Graph, JSON-LD, `sitemap.xml` and `robots.txt` come from the Nuxt SEO modules; the sitemap lists the content pages through `server/api/__sitemap__/urls.get.ts`.

## Layout

- `content/` holds the v3 pages: one section or page per product (Events, Errors, Drains, Map, Signals, Audit, Skills, Telemetry), then Integrations and Reference.
- `app/components/content/ProductFacts.vue` is the strip under each product title: import, package, status.
- The landing components, the content animations and `FrameworkTabs` are copied from `apps/docs`.
