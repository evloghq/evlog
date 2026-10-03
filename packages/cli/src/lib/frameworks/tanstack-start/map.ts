import { basename } from 'node:path'
import type { Node } from 'oxc-parser'
import type { ParseFn, ParseResult } from '../../map/parse'
import { findHandlerLocation, nodeLoc, parseFile, walkAst } from '../../map/parse'
import type { RawRouteEntry, ScanContext } from '../../map/types'
import type { MapAdapter } from '../types'
import { relativeFromRoot, segmentsToPath, stripExtension } from '../../map/utils'
import { glob } from '../../glob'

function extractTanstackRoutes(file: string, root: string, parse: ParseFn): RawRouteEntry[] {
  const rel = relativeFromRoot(root, file)
  if (rel.includes('__root')) return []

  const segments = stripExtension(rel.replace(/^src\/routes\//, '')).split('/')
  const path = segmentsToPath(segments) || '/'
  const parsed = parse(file)
  const routes: RawRouteEntry[] = []

  if (!parsed) {
    routes.push({
      framework: 'tanstack-start',
      kind: 'page',
      method: null,
      path,
      file: rel,
      handler: null,
    })
    return routes
  }

  const hasServerHandlers = detectServerHandlers(parsed)
  if (hasServerHandlers.length > 0) {
    for (const { method, line } of hasServerHandlers) {
      routes.push({
        framework: 'tanstack-start',
        kind: 'api',
        method,
        path,
        file: rel,
        handler: { line, column: 0 },
      })
    }
  } else if (path.startsWith('/api/') || isApiStem(file)) {
    routes.push({
      framework: 'tanstack-start',
      kind: 'api',
      method: null,
      path,
      file: rel,
      handler: findHandlerLocation(parsed, ['createServerFn']),
    })
  } else {
    routes.push({
      framework: 'tanstack-start',
      kind: 'page',
      method: null,
      path,
      file: rel,
      handler: null,
    })
  }

  return routes
}

/**
 * Whether the filename itself says "API", as a whole word.
 *
 * A substring test reads `capital.tsx` and `rapid-list.tsx` as API routes, and
 * every check that follows is then asked of a page.
 */
function isApiStem(file: string): boolean {
  return stripExtension(basename(file)).split(/[.\-_]/).includes('api')
}

/**
 * HTTP methods TanStack Start recognises on a route's `methods` object.
 *
 * Case matters: the framework only honours the uppercase form, so folding the
 * key would turn any `{ get: … }` or `{ delete: … }` in the module — a form
 * config, an options object — into a fabricated API entry point.
 */
const METHOD_KEYS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function detectServerHandlers(parsed: ParseResult): Array<{ method: string, line: number }> {
  const handlers: Array<{ method: string, line: number }> = []
  walkAst(parsed.program, (node) => {
    if (node.type !== 'Property') return
    const prop = node as { key: { type: string, name?: string }, value: { type: string } }
    if (prop.key.type === 'Identifier') {
      const key = prop.key.name
      if (key && METHOD_KEYS.includes(key)) {
        if (prop.value.type === 'ArrowFunctionExpression' || prop.value.type === 'FunctionExpression') {
          const loc = nodeLoc(prop.value as Node, parsed.lines)
          handlers.push({ method: key, line: loc?.line ?? 1 })
        }
      }
    }
  })
  return handlers
}

/**
 * TanStack Start: `src/routes/**` file-based routes, API vs page via HTTP method
 * props / `createServerFn`. No auto-imports — evlog helpers must be imported.
 */
export const tanstackStartAdapter: MapAdapter = {
  // eslint-disable-next-line require-await -- satisfies the async MapAdapter contract
  async extractRoutes(ctx: ScanContext): Promise<RawRouteEntry[]> {
    const routes: RawRouteEntry[] = []
    const root = ctx.projectRoot
    const parse = ctx.parse ?? parseFile

    for (const file of glob('src/routes/**/*.{ts,tsx}', root)) {
      routes.push(...extractTanstackRoutes(file, root, parse))
    }

    return routes
  },
}
