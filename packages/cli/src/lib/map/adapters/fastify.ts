import type { Node } from 'oxc-parser'
import { globSync } from 'tinyglobby'
import type { ParseFn, ParseResult } from '../parse'
import { nodeLoc, parseFile, walkAst } from '../parse'
import type { FrameworkAdapter, RawRouteEntry, ScanContext } from '../types'
import { relativeFromRoot } from '../utils'
import { fastifyReceiverContext, isFastifyRouteReceiver } from './route-receivers'

/**
 * Fastify route methods → HTTP verb.
 *
 * `all` has no single verb (matches every method), so it lands as `method: null`.
 * `register` / `listen` are not entry points; `route({ … })` is handled separately.
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
 * Source roots to scan for `app.get('/path', …)`-style registrations.
 *
 * Fastify has no file-based router: routes live in ordinary modules. Cover the
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
 * Whether a string looks like a Fastify route path.
 *
 * Used to tell `app.get('/users', …)` apart from unrelated `.get()` calls: a
 * real route path starts with `/` (or is the catch-all `*`), and a context key
 * never does.
 */
function isRoutePath(path: string): boolean {
  return path.startsWith('/') || path === '*'
}

/** Function-like node types that can be Fastify route handlers. */
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

/** Fastify options object spelling: `{ handler: fn }`. */
function handlerFromOptions(node: Node | undefined): Node | undefined {
  if (!node || node.type !== 'ObjectExpression') return undefined
  const { properties } = node as { properties: Node[] }
  for (const prop of properties) {
    if (prop.type !== 'Property') continue
    const { key, value } = prop as { key: Node, value: Node }
    if (key.type !== 'Identifier' || key.name !== 'handler') continue
    if (!looksLikeHandler(value)) return undefined
    return value
  }
  return undefined
}

/** Resolve a route handler from Fastify's shorthand overloads. */
function resolveRouteHandler(args: Node[]): Node | undefined {
  const [, second, third] = args
  if (looksLikeHandler(second)) return second
  const fromOptions = handlerFromOptions(second)
  if (fromOptions) return fromOptions
  if (looksLikeHandler(third)) return third
  return undefined
}

/** Read a property value from a route options object. */
function objectProperty(node: Node | undefined, property: string): Node | undefined {
  if (!node || node.type !== 'ObjectExpression') return undefined
  const { properties } = node as { properties: Node[] }
  for (const prop of properties) {
    if (prop.type !== 'Property') continue
    const { key, value } = prop as { key: Node, value: Node }
    if (key.type !== 'Identifier' || key.name !== property) continue
    return value
  }
  return undefined
}

/** Read a string property from a route options object. */
function stringProperty(node: Node | undefined, property: string): string | null {
  return stringLiteral(objectProperty(node, property))
}

/**
 * String literals from a node: `'GET'` or `['GET', 'POST']`.
 *
 * Fastify accepts both spellings on `method`. Anything non-literal is dropped.
 */
function stringLiterals(node: Node | undefined): string[] {
  if (!node) return []
  if (node.type === 'ArrayExpression') {
    const { elements } = node as { elements: (Node | null)[] }
    return elements
      .map(element => stringLiteral(element ?? undefined))
      .filter((value): value is string => value !== null)
  }
  const single = stringLiteral(node)
  return single === null ? [] : [single]
}

/**
 * `app.route({ method, url, handler })` — the full Fastify route declaration.
 *
 * `method` may be a string or an array of strings; each value becomes its own
 * entry so multi-method routes are scored separately.
 */
function routesFromOptions(node: Node | undefined): Array<{ method: string, path: string }> {
  if (!node || node.type !== 'ObjectExpression') return []
  const url = stringProperty(node, 'url') ?? stringProperty(node, 'path')
  const methods = stringLiterals(objectProperty(node, 'method')).map(method => method.toUpperCase())
  if (!url || !isRoutePath(url) || methods.length === 0 || !handlerFromOptions(node)) return []
  return methods.map(method => ({ method, path: url }))
}

/**
 * Find every `*.get('/path', handler)` / `*.post(…)` call in a parsed file.
 *
 * The receiver name does not matter (`app`, `fastify`, `server`): encapsulated
 * instances register the same way. Two cheap shape checks keep unrelated `.get()`
 * calls out: the first argument must look like a path, and there must be a
 * handler after it.
 */
function findFastifyRoutes(parsed: ParseResult): FoundRoute[] {
  const found: FoundRoute[] = []
  const receivers = fastifyReceiverContext(parsed)

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

    if (name === 'route') {
      if (!isFastifyRouteReceiver(member.object, receivers)) return
      const routes = routesFromOptions(call.arguments[0])
      if (routes.length === 0) return
      const loc = nodeLoc(node, parsed.lines)
      for (const route of routes) {
        found.push({
          method: route.method,
          path: route.path,
          line: loc?.line ?? 1,
        })
      }
      return
    }

    if (!ROUTE_METHODS.has(name)) return
    if (!isFastifyRouteReceiver(member.object, receivers)) return

    const path = stringLiteral(call.arguments[0])
    if (!path || !isRoutePath(path) || !resolveRouteHandler(call.arguments)) return

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

  return findFastifyRoutes(parsed).map(route => ({
    framework: 'fastify' as const,
    kind: 'api' as const,
    method: route.method,
    path: route.path,
    file: rel,
    handler: { line: route.line, column: 0 },
  }))
}

/** Local names bound to `evlog` from `evlog/fastify`, alias included. */
function evlogPluginNames(parsed: ParseResult): Set<string> {
  const names = new Set<string>()
  walkAst(parsed.program, (node) => {
    if (node.type !== 'ImportDeclaration') return
    const declaration = node as {
      source: { value: string }
      specifiers: Array<{ type: string, imported?: { name?: string }, local?: { name: string } }>
    }
    if (declaration.source.value !== 'evlog/fastify') return
    for (const specifier of declaration.specifiers) {
      if (specifier.imported?.name === 'evlog' && specifier.local) names.add(specifier.local.name)
    }
  })
  return names
}

/** Whether the file registers evlog's plugin: `app.register(evlog, …)`. */
function registersEvlogPlugin(parsed: ParseResult): boolean {
  const names = evlogPluginNames(parsed)
  if (names.size === 0) return false

  let found = false
  walkAst(parsed.program, (node) => {
    if (found || node.type !== 'CallExpression') return
    const call = node as { callee: Node, arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') return
    const { property, computed } = call.callee as { property: Node, computed?: boolean }
    if (computed || property.type !== 'Identifier' || property.name !== 'register') return
    const [plugin] = call.arguments
    if (plugin?.type !== 'Identifier') return
    found = names.has((plugin as unknown as { name: string }).name)
  })
  return found
}

/**
 * Fastify: scan source for `app.get/post/…('/path', …)` registrations.
 *
 * No auto-imports — `useLogger` / `request.log` come from `evlog/fastify`.
 * Unlike Nuxt or Nitro, the per-request event only exists once the app itself
 * calls `app.register(evlog)`, so the ambient/explicit capability is resolved
 * per project: ambient when the plugin is registered somewhere in the scanned
 * sources, explicit (nothing is emitted at all) when it is not.
 */
export const fastifyAdapter: FrameworkAdapter = {
  framework: 'fastify',
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
