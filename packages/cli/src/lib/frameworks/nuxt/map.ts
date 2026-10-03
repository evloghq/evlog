import { basename } from 'node:path'
import type { ParseFn } from '../../map/parse'
import { findHandlerLocation, parseFile } from '../../map/parse'
import type { RawRouteEntry, ScanContext } from '../../map/types'
import type { MapAdapter } from '../types'
import { extractMethodFromFilename, relativeFromRoot, segmentsToPath, stripRouteFilename } from '../../map/utils'
import { glob } from '../../glob'

/**
 * Extensions Nitro serves a handler from.
 *
 * `.mjs` and `.cjs` are in the list because Nitro runs them exactly like a
 * `.ts` handler: a route written in either was invisible to the whole scan.
 */
const HANDLER_EXT = '{ts,js,mts,cts,mjs,cjs}'

/** A directory of file-based handlers, and the URL prefix its routes get. */
interface RouteRoot {
  dir: string
  prefix: string
}

/**
 * Where each framework keeps its handlers.
 *
 * Nuxt and raw Nitro differ by these paths and nothing else, so they share the
 * extraction below rather than each carrying a copy of it — the copies had
 * already started to drift.
 */
const API_ROOTS: Record<'nuxt' | 'nitro', readonly RouteRoot[]> = {
  nuxt: [{ dir: 'server/api', prefix: '/api' }, { dir: 'server/routes', prefix: '' }],
  nitro: [{ dir: 'api', prefix: '/api' }, { dir: 'routes', prefix: '' }],
}

const MIDDLEWARE_DIR: Record<'nuxt' | 'nitro', string> = {
  nuxt: 'server/middleware',
  nitro: 'middleware',
}

/**
 * Where Nuxt keeps file-based pages.
 *
 * Nuxt 4 defaults to `app/pages`; older layouts use `pages/` or `src/pages`.
 * Several can coexist in odd projects — scan every root that actually has
 * `.vue` files rather than picking one and leaving the others invisible.
 */
const PAGE_DIRS = ['app/pages', 'pages', 'src/pages'] as const

const CRON_GLOBS = [`server/tasks/**/*.${HANDLER_EXT}`]

/** What both Nitro-based adapters need to turn a file into an entry point. */
interface ExtractContext {
  root: string
  parse: ParseFn
  framework: 'nuxt' | 'nitro'
}

/** One page root and the `.vue` files already discovered under it. */
interface PageRoot {
  dir: string
  files: readonly string[]
}

/**
 * Page directories under `root` that contain at least one `.vue` file.
 * Returns the matched files with each directory so extractors do not glob twice.
 * Falls back to an empty `pages` root when nothing is present.
 */
function resolvePageRoots(root: string): readonly PageRoot[] {
  const found: PageRoot[] = []
  for (const dir of PAGE_DIRS) {
    const files = glob(`${dir}/**/*.vue`, root)
    if (files.length > 0) found.push({ dir, files })
  }
  return found.length > 0 ? found : [{ dir: 'pages', files: [] }]
}

function fileToApiRoute(file: string, apiRoot: RouteRoot, { root, parse, framework }: ExtractContext): RawRouteEntry {
  const rel = relativeFromRoot(root, file)
  const method = extractMethodFromFilename(basename(file))

  const parts = rel.slice(`${apiRoot.dir}/`.length).split('/')
  parts[parts.length - 1] = stripRouteFilename(parts.at(-1) ?? '')

  const parsed = parse(file)

  return {
    framework,
    kind: 'api',
    method,
    path: segmentsToPath(parts, apiRoot.prefix) || '/',
    file: rel,
    handler: parsed ? findHandlerLocation(parsed, ['defineEventHandler', 'eventHandler']) : null,
  }
}

function fileToPageRoute(file: string, root: string, pageDir: string): RawRouteEntry {
  const rel = relativeFromRoot(root, file)
  const prefix = `${pageDir}/`
  const segments = rel.startsWith(prefix)
    ? rel.slice(prefix.length).split('/')
    : rel.split('/')
  const last = segments.length - 1
  segments[last] = stripRouteFilename(segments[last] ?? '')
  const path = segmentsToPath(segments) || '/'

  return {
    framework: 'nuxt',
    kind: 'page',
    method: null,
    path,
    file: rel,
    handler: null,
  }
}

function fileToMiddlewareRoute(file: string, { root, parse, framework }: ExtractContext): RawRouteEntry {
  const rel = relativeFromRoot(root, file)
  const parsed = parse(file)
  const handler = parsed
    ? findHandlerLocation(parsed, ['defineEventHandler'])
    : null

  return {
    framework,
    kind: 'middleware',
    method: null,
    path: '*',
    file: rel,
    handler,
  }
}

/** A Nitro scheduled task — no request, but the same wide-event expectations. */
function fileToCronRoute(file: string, root: string, parse: ParseFn): RawRouteEntry {
  const rel = relativeFromRoot(root, file)
  const name = stripRouteFilename(basename(file))
  const parsed = parse(file)
  const handler = parsed
    ? findHandlerLocation(parsed, ['defineTask', 'defineEventHandler'])
    : null

  return {
    framework: 'nuxt',
    kind: 'cron',
    method: null,
    path: `/tasks/${name}`,
    file: rel,
    handler,
  }
}

/** Handlers and middleware, in whichever directories this framework serves them from. */
function extractServerRoutes(ctx: ScanContext, framework: 'nuxt' | 'nitro'): RawRouteEntry[] {
  const routes: RawRouteEntry[] = []
  const root = ctx.projectRoot
  const extract: ExtractContext = { root, parse: ctx.parse ?? parseFile, framework }

  for (const apiRoot of API_ROOTS[framework]) {
    for (const file of glob(`${apiRoot.dir}/**/*.${HANDLER_EXT}`, root)) {
      routes.push(fileToApiRoute(file, apiRoot, extract))
    }
  }

  for (const file of glob(`${MIDDLEWARE_DIR[framework]}/**/*.${HANDLER_EXT}`, root)) {
    routes.push(fileToMiddlewareRoute(file, extract))
  }

  return routes
}

/** Nuxt project: `server/api`, `server/routes`, `server/middleware`, `server/tasks` and pages. */
export const nuxtAdapter: MapAdapter = {
  // eslint-disable-next-line require-await -- satisfies the async MapAdapter contract
  async extractRoutes(ctx: ScanContext): Promise<RawRouteEntry[]> {
    const routes = extractServerRoutes(ctx, 'nuxt')
    const root = ctx.projectRoot
    const parse = ctx.parse ?? parseFile

    for (const { dir, files } of resolvePageRoots(root)) {
      for (const file of files) {
        routes.push(fileToPageRoute(file, root, dir))
      }
    }

    for (const pattern of CRON_GLOBS) {
      for (const file of glob(pattern, root)) {
        routes.push(fileToCronRoute(file, root, parse))
      }
    }

    return routes
  },
}

/** Raw Nitro project (no Nuxt): the same handlers, one directory level up. */
export const nitroAdapter: MapAdapter = {
  // eslint-disable-next-line require-await -- satisfies the async MapAdapter contract
  async extractRoutes(ctx: ScanContext): Promise<RawRouteEntry[]> {
    return extractServerRoutes(ctx, 'nitro')
  },
}
