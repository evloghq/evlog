import type { Node } from 'oxc-parser'
import { globSync } from 'tinyglobby'
import type { ParseFn, ParseResult } from '../parse'
import { nodeLoc, parseFile, walkAst } from '../parse'
import type { FrameworkAdapter, RawRouteEntry, ScanContext } from '../types'
import { indent, relativeFromRoot } from '../utils'

/**
 * Hono route methods → HTTP verb.
 *
 * `all` has no single verb (matches every method), so it lands as `method: null`.
 * `use` / `route` / `onError` are not entry points and are ignored.
 */
const ROUTE_METHODS: ReadonlyMap<string, string | null> = new Map([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['all', null],
])

/** Verbs with an `app.<verb>()` shorthand — anything else registers via `app.on()`. */
const SHORTHAND_VERBS: ReadonlySet<string> = new Set(
  [...ROUTE_METHODS.values()].filter((verb): verb is string => verb !== null),
)

/**
 * Source roots to scan for `app.get('/path', …)`-style registrations.
 *
 * Hono has no file-based router: routes live in ordinary modules. Cover the
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

/**
 * Pull a string path out of the first (or second, for `app.on`) call argument.
 *
 * Only string literals count: a computed path (`\`/users/${id}\``) is invisible
 * to the static scan, the same way Next skips dynamic segments it cannot name.
 */
function stringLiteral(node: Node | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof (node as { value: unknown }).value === 'string') {
    return (node as { value: string }).value
  }
  return null
}

/**
 * The same, accepting `app.on`'s array spelling: `'GET'` and `['GET', 'POST']`
 * both come back as a list, anything else as an empty one.
 */
function stringLiterals(node: Node | undefined): string[] {
  if (!node) return []
  if (node.type === 'ArrayExpression') {
    const { elements } = node as { elements: (Node | null)[] }
    return elements.map(element => stringLiteral(element ?? undefined)).filter((value): value is string => value !== null)
  }
  const single = stringLiteral(node)
  return single === null ? [] : [single]
}

/**
 * Whether a string looks like a Hono route path.
 *
 * Used to tell `api.get('/users', …)` apart from `c.get('log')`: the receiver
 * name is useless (`app`, `api`, `routes`, `c`…), but a real route path starts
 * with `/` (or is the catch-all `*`), and a context key never does.
 */
function isRoutePath(path: string): boolean {
  return path.startsWith('/') || path === '*'
}

/** Function-like node types that can be Hono route handlers. */
const HANDLER_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'Identifier',
])

/**
 * Whether the node looks like a route handler (function) rather than an options
 * object. This tells `app.get('/users', handler)` apart from HTTP client calls
 * like `axios.get('/users', { headers })`.
 */
function looksLikeHandler(node: Node | undefined): boolean {
  if (!node) return false
  return HANDLER_TYPES.has(node.type)
}

/**
 * Find every `*.get('/path', handler)` / `*.post(…)` call in a parsed file.
 *
 * The receiver name does not matter (`app`, `api`, `routes`): Hono sub-apps are
 * registered the same way. Two cheap shape checks keep `c.get('log')` out:
 * the first argument must look like a path, and there must be a handler after it.
 * `app.on(…)` is the one spelling where the method is an argument rather than
 * the callee, and it takes arrays on both sides: `app.on(['PUT', 'DELETE'],
 * ['/a', '/b'], …)` registers every combination.
 */
function findHonoRoutes(parsed: ParseResult): FoundRoute[] {
  const found: FoundRoute[] = []

  walkAst(parsed.program, (node) => {
    if (node.type !== 'CallExpression') return
    const call = node as { callee: Node, arguments: Node[] }
    const { callee } = call
    if (callee.type !== 'MemberExpression') return

    const { property, computed } = callee as { property: Node, computed?: boolean }
    if (computed) return
    if (property.type !== 'Identifier') return

    const { name } = property

    if (name === 'on') {
      const methods = stringLiterals(call.arguments[0]).map(method => method.toUpperCase())
      const paths = stringLiterals(call.arguments[1]).filter(isRoutePath)
      if (methods.length === 0 || paths.length === 0 || call.arguments.length < 3) return
      const loc = nodeLoc(node, parsed.lines)
      for (const method of methods) {
        for (const path of paths) {
          found.push({ method, path, line: loc?.line ?? 1 })
        }
      }
      return
    }

    if (!ROUTE_METHODS.has(name)) return
    const path = stringLiteral(call.arguments[0])
    /* Path + handler function: `c.get('log')` has neither a `/…` path nor a
       second argument, and `axios.get('/users', { headers })` passes an object
       rather than a function, so both are filtered without tracking bindings. */
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

  return findHonoRoutes(parsed).map(route => ({
    framework: 'hono' as const,
    kind: 'api' as const,
    method: route.method,
    path: route.path,
    file: rel,
    handler: { line: route.line, column: 0 },
  }))
}

/** Local names bound to `evlog` from `evlog/hono`, alias included. */
function evlogMiddlewareNames(parsed: ParseResult): Set<string> {
  const names = new Set<string>()
  walkAst(parsed.program, (node) => {
    if (node.type !== 'ImportDeclaration') return
    const declaration = node as {
      source: { value: string }
      specifiers: Array<{ type: string, imported?: { name?: string }, local?: { name: string } }>
    }
    if (declaration.source.value !== 'evlog/hono') return
    for (const specifier of declaration.specifiers) {
      if (specifier.imported?.name === 'evlog' && specifier.local) names.add(specifier.local.name)
    }
  })
  return names
}

/** Whether the file registers evlog's middleware: `app.use(evlog())`. */
function registersEvlogMiddleware(parsed: ParseResult): boolean {
  const names = evlogMiddlewareNames(parsed)
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
 * Hono: scan source for `app.get/post/…('/path', …)` registrations.
 *
 * No auto-imports — `useLogger` / `c.get('log')` come from `evlog/hono`. Unlike
 * Nuxt or Nitro, the per-request event only exists once the app itself calls
 * `app.use(evlog())`, so the ambient/explicit capability is resolved per
 * project: ambient when the middleware is registered somewhere in the scanned
 * sources, explicit (nothing is emitted at all) when it is not.
 */
export const honoAdapter: FrameworkAdapter = {
  framework: 'hono',
  requestLogger: 'explicit',
  loggerCall: 'const log = useLogger()',
  handlerShape(route, body) {
    /* `app.on('PURGE', …)` routes have no `app.purge()` shorthand to suggest. */
    const open = route.method === null || SHORTHAND_VERBS.has(route.method)
      ? `app.${(route.method ?? 'all').toLowerCase()}('${route.path}', async (c) => {`
      : `app.on('${route.method}', '${route.path}', async (c) => {`
    return [open, ...body.map(line => indent(1, line)), '})']
  },
  resolveRequestLogger(ctx: ScanContext): 'ambient' | 'explicit' {
    const parse = ctx.parse ?? parseFile
    for (const file of sourceFiles(ctx.projectRoot)) {
      const parsed = parse(file)
      if (parsed && registersEvlogMiddleware(parsed)) return 'ambient'
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
