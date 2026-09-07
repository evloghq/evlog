import type { Node } from 'oxc-parser'
import { globSync } from 'tinyglobby'
import type { ParseFn, ParseResult } from '../parse'
import { nodeLoc, parseFile, walkAst } from '../parse'
import type { FrameworkAdapter, RawRouteEntry, ScanContext } from '../types'
import { relativeFromRoot } from '../utils'
import { elysiaReceiverContext, isElysiaRouteReceiver } from './route-receivers'

/**
 * Elysia route methods → HTTP verb.
 *
 * `all` has no single verb (matches every method), so it lands as `method: null`.
 * `use` / `listen` / `onError` are not entry points and are ignored.
 */
const ROUTE_METHODS: ReadonlyMap<string, string | null> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['head', 'HEAD'],
  ['all', null],
])

/**
 * Source roots to scan for `.get('/path', …)`-style registrations.
 *
 * Elysia has no file-based router: routes live in ordinary modules. Cover the
 * common layouts without walking `node_modules`.
 */
const SOURCE_GLOBS = [
  'src/**/*.{ts,tsx,js,jsx}',
  'app/**/*.{ts,tsx,js,jsx}',
  'routes/**/*.{ts,tsx,js,jsx}',
  '*.{ts,tsx,js,jsx}',
] as const

/** Every file the adapter reads — the globs overlap, so deduplicate. */
function sourceFiles(root: string): string[] {
  return [...new Set(globSync([...SOURCE_GLOBS], { cwd: root, absolute: true }))]
}

interface FoundRoute {
  method: string | null
  path: string
  line: number
}

/** Pull a string path out of the first call argument. */
function stringLiteral(node: Node | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof (node as { value: unknown }).value === 'string') {
    return (node as { value: string }).value
  }
  return null
}

/**
 * Whether a string looks like an Elysia route path.
 *
 * Used to tell `.get('/users', …)` apart from unrelated `.get()` calls: a real
 * route path starts with `/` (or is the catch-all `*`), and a context key never
 * does.
 */
function isRoutePath(path: string): boolean {
  return path.startsWith('/') || path === '*'
}

/** Function-like node types that can be Elysia route handlers. */
const HANDLER_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'Identifier',
])

/**
 * Whether the node looks like an Elysia route handler rather than an options
 * object. Accepts functions, named handlers, and static string responses
 * (`.get('/ping', 'pong')`). This tells `.get('/users', handler)` apart from
 * HTTP client calls like `axios.get('/users', { headers })`.
 */
function looksLikeHandler(node: Node | undefined): boolean {
  if (!node) return false
  if (HANDLER_TYPES.has(node.type)) return true
  return node.type === 'Literal' && typeof (node as { value: unknown }).value === 'string'
}

/**
 * Find every `.get('/path', handler)` / `.post(…)` call in a parsed file.
 *
 * Elysia registers routes through chained calls; the receiver name does not
 * matter (`app`, `api`, `new Elysia()`). Two cheap shape checks keep unrelated
 * `.get()` calls out: the first argument must look like a path, and there must
 * be a handler after it.
 */
function findElysiaRoutes(parsed: ParseResult): FoundRoute[] {
  const found: FoundRoute[] = []
  const receivers = elysiaReceiverContext(parsed)

  walkAst(parsed.program, (node) => {
    if (node.type !== 'CallExpression') return
    const call = node as { callee: Node, arguments: Node[] }
    const { callee } = call
    if (callee.type !== 'MemberExpression') return

    const member = callee as { object: Node, property: Node, computed?: boolean }
    const { property, computed } = member
    if (computed) return
    if (property.type !== 'Identifier') return

    const { name } = property
    if (!ROUTE_METHODS.has(name)) return
    if (!isElysiaRouteReceiver(member.object, receivers)) return

    const path = stringLiteral(call.arguments[0])
    if (!path || !isRoutePath(path) || !looksLikeHandler(call.arguments[1])) return

    const loc = nodeLoc(node, parsed.lines)
    found.push({
      method: ROUTE_METHODS.get(name) ?? null,
      path,
      line: loc?.line ?? 1,
    })
  })

  return found
}

function extractFromFile(file: string, root: string, parse: ParseFn): RawRouteEntry[] {
  const rel = relativeFromRoot(root, file)
  const parsed = parse(file)
  if (!parsed) return []

  return findElysiaRoutes(parsed).map(route => ({
    framework: 'elysia' as const,
    kind: 'api' as const,
    method: route.method,
    path: route.path,
    file: rel,
    handler: { line: route.line, column: 0 },
  }))
}

/** Local names bound to `evlog` from `evlog/elysia`, alias included. */
function evlogPluginNames(parsed: ParseResult): Set<string> {
  const names = new Set<string>()
  walkAst(parsed.program, (node) => {
    if (node.type !== 'ImportDeclaration') return
    const declaration = node as {
      source: { value: string }
      specifiers: Array<{ type: string, imported?: { name?: string }, local?: { name: string } }>
    }
    if (declaration.source.value !== 'evlog/elysia') return
    for (const specifier of declaration.specifiers) {
      if (specifier.imported?.name === 'evlog' && specifier.local) names.add(specifier.local.name)
    }
  })
  return names
}

/** Whether the file registers evlog's plugin: `.use(evlog())`. */
function registersEvlogPlugin(parsed: ParseResult): boolean {
  const names = evlogPluginNames(parsed)
  if (names.size === 0) return false

  let found = false
  walkAst(parsed.program, (node) => {
    if (found || node.type !== 'CallExpression') return
    const call = node as { callee: Node, arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') return
    const { property, computed } = call.callee as { property: Node, computed?: boolean }
    if (computed || property.type !== 'Identifier' || property.name !== 'use') return
    found = call.arguments.some((argument) => {
      if (argument.type !== 'CallExpression') return false
      const { callee } = argument as { callee: Node }
      return callee.type === 'Identifier' && names.has((callee as unknown as { name: string }).name)
    })
  })
  return found
}

/**
 * Elysia: scan source for `.get/post/…('/path', …)` registrations.
 *
 * No auto-imports — `{ log }` / `useLogger()` come from `evlog/elysia`. Unlike
 * Nuxt or Nitro, the per-request event only exists once the app itself calls
 * `.use(evlog())`, so the ambient/explicit capability is resolved per project:
 * ambient when the plugin is registered somewhere in the scanned sources,
 * explicit (nothing is emitted at all) when it is not.
 */
export const elysiaAdapter: FrameworkAdapter = {
  framework: 'elysia',
  requestLogger: 'explicit',
  resolveRequestLogger(ctx: ScanContext): 'ambient' | 'explicit' {
    const parse = ctx.parse ?? parseFile
    for (const file of sourceFiles(ctx.projectRoot)) {
      const parsed = parse(file)
      if (parsed && registersEvlogPlugin(parsed)) return 'ambient'
    }
    return 'explicit'
  },
  // eslint-disable-next-line require-await -- satisfies the async FrameworkAdapter contract
  async extractRoutes(ctx: ScanContext): Promise<RawRouteEntry[]> {
    const parse = ctx.parse ?? parseFile
    const routes: RawRouteEntry[] = []

    for (const file of sourceFiles(ctx.projectRoot)) {
      routes.push(...extractFromFile(file, ctx.projectRoot, parse))
    }

    return routes
  },
}
