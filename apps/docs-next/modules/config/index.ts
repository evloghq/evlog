import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { addServerPlugin, createResolver, defineNuxtModule, useLogger } from '@nuxt/kit'
import { defu } from 'defu'
import type { ModuleOptions as AgentDiscoveryOptions } from 'nuxt-agent-discovery'
import { resolve } from 'pathe'
import { getGitBranch, getGitEnv, getGitRoot, getLocalGitInfo } from '../../utils/git'
import { getPackageJsonMetadata, inferSiteURL, resolveContentDir } from './utils'

const logger = useLogger('docs')

export interface DocsOptions {
  /**
   * ISR TTL (seconds) for content page HTML and the global content indexes in production builds.
   * `false` disables the generated route rules; per-route rules in `routeRules` still apply.
   * @default 300
   */
  isr?: number | false
  /**
   * Content directory, relative to the **repository** root, not the app root. Derived by relativising
   * `<rootDir>/content` against the git root (app in `docs/` → `docs/content`). Set it when the build
   * has no `.git` to inspect and the app isn't at the repo root, or the GitHub source and edit links
   * resolve to a path that doesn't exist. Also settable as `NUXT_DOCS_CONTENT_DIR`.
   */
  contentDir?: string
}

export default defineNuxtModule<DocsOptions>({
  meta: {
    name: 'docs/config',
    configKey: 'docs',
  },
  defaults: {
    isr: 300,
  },
  async setup(options, nuxt) {
    const { rootDir } = nuxt.options

    // Untyped view: `site` (nuxt-site-config) and `appConfig` aren't typed until app.config is generated.
    const nuxtOptions = nuxt.options as typeof nuxt.options & {
      site?: { url?: string; name?: string; description?: string }
      appConfig: Record<string, Record<string, unknown> | undefined>
      mcp?: false | { name?: string; version?: string; route?: string }
      agentDiscovery?: AgentDiscoveryOptions
    }

    // This module is listed first in nuxt.config, so what is seeded below (`site`, `mcp`,
    // `agentDiscovery`) is in place before the modules that read it at setup. Static defaults still belong in
    // nuxt.config; only build-time discoveries (git, env, the consumer's content dir) are resolved here.

    const url = inferSiteURL()
    const meta = await getPackageJsonMetadata(rootDir)
    const gitInfo = getLocalGitInfo(rootDir) || getGitEnv()
    const branch = getGitBranch(rootDir)
    const siteName = nuxtOptions.site?.name || meta.name || gitInfo?.name || ''

    // Absolute (dev fs source) and git-root-relative (GitHub source, edit links).
    const gitRoot = getGitRoot(rootDir)
    const repoRoot = gitRoot || rootDir
    const { contentPath, contentDir, source: contentDirSource } = resolveContentDir({
      rootDir,
      gitRoot,
      explicit: options.contentDir || process.env.NUXT_DOCS_CONTENT_DIR,
    })

    // Without a git root, an app that *is* the repo root is indistinguishable from one in a subdirectory,
    // and a wrong guess surfaces only in production (dev reads `contentPath` absolutely). Warn rather
    // than fail: the assumption holds for the common single-app repo.
    if (contentDirSource === 'assumed') {
      logger.warn(
        `No git repository found above ${rootDir}, so the content directory is assumed to be ` +
          `"content" at the repository root.\n` +
          `  If this app lives in a subdirectory of its repo, the GitHub content source and "Edit this page" links ` +
          `will resolve to a path that does not exist in production.\n` +
          `  Set \`docs.contentDir\` (or NUXT_DOCS_CONTENT_DIR) to the repo-relative path, e.g. "docs/content".`
      )
    }

    nuxtOptions.site = defu(nuxtOptions.site, {
      url,
      name: siteName,
    }) as typeof nuxtOptions.site

    // nuxt-schema-org attaches this to every page as the publisher, and to the `Article` on a docs page
    // as its author. Without it the graph has no identity at all and both fields are simply absent.
    // A site declaring its own `schemaOrg` in nuxt.config wins, the same as `site` above, and `false`
    // disables the module outright. Seeded through a view of the shape a config carries: the module's
    // own type is the resolved one, with every key required, which no partial can satisfy.
    const schemaOrgOptions = nuxt.options as { schemaOrg?: false | { identity?: Record<string, unknown> } }
    if (schemaOrgOptions.schemaOrg !== false) {
      const schemaOrg: { identity?: Record<string, unknown> } = schemaOrgOptions.schemaOrg || {}
      schemaOrg.identity = schemaOrg.identity || { type: 'Organization', name: siteName, url }
      schemaOrgOptions.schemaOrg = schemaOrg
    }

    nuxtOptions.appConfig.seo = defu(nuxtOptions.appConfig.seo, {
      siteName,
    })

    nuxtOptions.appConfig.header = defu(nuxtOptions.appConfig.header, {
      title: siteName,
    })

    nuxtOptions.appConfig.github = defu(nuxtOptions.appConfig.github, {
      owner: gitInfo?.owner || '',
      name: gitInfo?.name || '',
      url: gitInfo?.url || '',
      branch,
      contentDir,
    })

    // Every field is overridable through `NUXT_DOCS_*`; the token also falls back to GITHUB_TOKEN at runtime.
    nuxt.options.runtimeConfig.docs = defu(nuxt.options.runtimeConfig.docs, {
      githubToken: '',
      // Feeds the OpenAPI document.
      version: meta.version || '0.0.0',
      github: {
        owner: gitInfo?.owner || '',
        repo: gitInfo?.name || '',
        branch,
      },
      contentDir,
      contentPath,
      repoRoot,
    })

    const rawMcpOptions = nuxtOptions.mcp
    const mcp = defu(rawMcpOptions || undefined, {
      name: `${siteName} Docs`,
      version: '1.0.0',
    })
    // `mcp: false` disables the toolkit, so the defaults must not be written back over it. The server
    // card below reads `rawMcpOptions` for the same reason.
    if (rawMcpOptions !== false) {
      nuxtOptions.mcp = mcp
    }

    // What nuxt-agent-discovery cannot know: the MCP server card describing the toolkit's endpoint under the same name.
    nuxtOptions.agentDiscovery = defu(nuxtOptions.agentDiscovery, {
      discovery: {
        mcpServerCard:
          rawMcpOptions === false
            ? false
            : {
              endpoint: mcp.route || '/mcp',
              name: mcp.name,
              version: mcp.version,
              ...(nuxtOptions.site?.description ? { description: nuxtOptions.site.description } : {}),
            },
      },
    }) as AgentDiscoveryOptions

    // A `.vue` page has no document behind it, so negotiation would answer a markdown 404 on a route
    // browsers serve as HTML. Every page route outside the content catch-all is excluded, which is what a
    // consumer app's own pages need: without this each one has to be listed in `excludePrefixes` by hand.
    //
    // Routes are only known at `pages:extend`, by which point nuxt-agent-discovery has resolved its
    // options and Nitro has deep-copied `runtimeConfig`, so the list exists twice: the one the Vercel
    // preset reads when it writes the route table, and Nitro's own, which the server bundle serializes.
    // Both get the exclusions or the CDN stops routing these paths while the origin still negotiates
    // them, and an agent gets a markdown 404 on a page browsers render. `nitro:init` runs first, so the
    // copy is in hand by the time the pages are.
    let nitroExcludePrefixes: string[] | undefined
    nuxt.hook('nitro:init', (nitro) => {
      nitroExcludePrefixes = (nitro.options.runtimeConfig.agentDiscovery as { excludePrefixes?: string[] } | undefined)?.excludePrefixes
    })

    nuxt.hook('pages:extend', (pages) => {
      const excludePrefixes = (nuxt.options.runtimeConfig.agentDiscovery as { excludePrefixes?: string[] } | undefined)?.excludePrefixes
      if (!excludePrefixes) {
        return
      }

      const excluded: string[] = []
      for (const page of pages) {
        // Up to the first dynamic segment, so `/blog/[slug]` excludes `/blog/`. The content catch-all
        // (`/:slug(.*)*`) and the homepage both reduce to `/`, which stays negotiable.
        const dynamic = page.path.search(/[:*(]/)
        const prefix = dynamic === -1 ? page.path : page.path.slice(0, dynamic)
        if (prefix === '/' || excluded.includes(prefix)) {
          continue
        }
        excluded.push(prefix)
      }

      // `pages:extend` runs again on every page change in dev, so both lists are additive and deduped.
      for (const list of [excludePrefixes, nitroExcludePrefixes]) {
        if (list) {
          list.push(...excluded.filter(prefix => !list.includes(prefix)))
        }
      }

      if (excluded.length) {
        logger.info(`Vue pages excluded from markdown negotiation: ${excluded.join(', ')}`)
      }
    })

    // `llms.txt` sections come from the content navigation at request time. Registered here rather than
    // scanned from `server/plugins/` so the hook runs ahead of the nuxt-agent-discovery bridge (see the plugin).
    addServerPlugin(createResolver(import.meta.url).resolve('./runtime/server/plugins/llms'))

    // The runtime parser and the build snapshot both parse with the site's highlighter.
    const highlighter = resolve(rootDir, 'highlighter.ts')
    nuxt.options.alias['#docs/highlighter'] = highlighter
    // A highlighter change changes the parsed output, so it gets its own content cache namespace.
    nuxt.options.runtimeConfig.docs.highlighterVersion = createHash('sha256').update(readFileSync(highlighter)).digest('hex').slice(0, 8)

    // Content sections need a redeploy to get their ISR rule.
    if (!nuxt.options.dev && options.isr !== false) {
      const isr = options.isr!
      const rules: Record<string, Record<string, unknown>> = {
        '/': { isr },
        // Raw markdown mirrors of every page, for agents.
        '/raw/**': { isr, robots: 'noindex' },
        // Global content indexes.
        '/llms.txt': { isr },
        '/llms-full.txt': { isr },
        '/sitemap.md': { isr },
        // Scanned from the app at build time, so they only change on deploy.
        '/.well-known/skills': { isr: true },
        '/.well-known/skills/**': { isr: true },
        // Per-commit artifacts hydrating the client-side search database.
        '/api/content/blob/*/manifest.json': { isr: true }, // Immutable since SHA-pinned
        '/api/content/blob/*/snapshot/*': { isr: true }, // Immutable since SHA-pinned
      }

      if (existsSync(contentPath)) {
        for (const entry of readdirSync(contentPath, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
          const slug = entry.name.replace(/^\d+\./, '').replace(/\.md$/i, '')
          if (!slug || slug === 'index') continue
          rules[`/${slug}`] = { isr }
          if (entry.isDirectory()) rules[`/${slug}/**`] = { isr }
        }
      }

      // Consumer-declared rules win per route.
      nuxt.options.routeRules = defu(nuxt.options.routeRules, rules) as typeof nuxt.options.routeRules
    }
  },
})
