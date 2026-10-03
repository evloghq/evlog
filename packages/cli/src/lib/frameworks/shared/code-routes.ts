import type { Node } from 'oxc-parser'
import { glob } from '../../glob'
import type { ParseFn, ParseResult } from '../../map/parse'
import { nodeLoc, parseFile, walkAst } from '../../map/parse'
import type { RawRouteEntry, ScanContext } from '../../map/types'
import { relativeFromRoot } from '../../map/utils'
import type { Framework } from '../index'
import type { MapAdapter } from '../types'

/**
 * Source roots to scan for `app.get('/path', …)`-style registrations.
 *
 * Code-first frameworks have no file-based router: routes live in ordinary
 * modules. Cover the common layouts without walking `node_modules`.
 */
const SOURCE_GLOBS = [
  'src/**/*.{ts,tsx,js,jsx}',
  'app/**/*.{ts,tsx,js,jsx}',
  'routes/**/*.{ts,tsx,js,jsx}',
  '*.{ts,tsx,js,jsx}',
] as const

export interface CodeRoutesOptions {
  framework: Framework
  /** Callee member → HTTP verb; `null` for a member that matches every method. */
  methods: ReadonlyMap<string, string | null>
  /** Member taking the method as its first argument: Hono's `app.on('GET', '/path', …)`. */
  on?: string
  /** Member taking one options object: Fastify's `app.route({ method, url, handler })`. */
  routeObject?: { member: string, method: string, path: string }
  /** evlog's middleware: the subpath it is imported from and the app members that register it. */
  middleware: { source: string, register: readonly string[] }
}

interface FoundRoute {
  method: string | null
  path: string
  line: number
}

/**
 * Pull a string path out of a call argument.
 *
 * Only string literals count: a computed path (`\`/users/${id}\``) is invisible
 * to the static scan, the same way Next skips dynamic segments it cannot name.
 */
function stringLiteral(node: Node | undefined | null): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof (node as { value: unknown }).value === 'string') {
    return (node as { value: string }).value
  }
  return null
}

/** The same, accepting the array spelling: `'GET'` and `['GET', 'POST']` both come back as a list. */
function stringLiterals(node: Node | undefined | null): string[] {
  if (!node) return []
  if (node.type === 'ArrayExpression') {
    const { elements } = node as { elements: (Node | null)[] }
    return elements.map(stringLiteral).filter((value): value is string => value !== null)
  }
  const single = stringLiteral(node)
  return single === null ? [] : [single]
}

/**
 * Whether a string looks like a route path.
 *
 * Used to tell `api.get('/users', …)` apart from `c.get('log')` or Express's
 * `app.get('view engine')`: the receiver name is useless (`app`, `api`,
 * `router`, `c`…), but a real route path starts with `/` (or is the catch-all
 * `*`), and a setting or context key never does.
 */
function isRoutePath(path: string): boolean {
  return path.startsWith('/') || path === '*'
}

/** Function-like node types that can be route handlers. */
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

function property(object: Node, key: string): Node | undefined {
  const { properties } = object as { properties: Node[] }
  for (const entry of properties) {
    if (entry.type !== 'Property') continue
    const { key: name, value } = entry as { key: Node, value: Node }
    if (name.type === 'Identifier' && name.name === key) return value
  }
  return undefined
}

/**
 * Find every `*.get('/path', …handlers)` registration in a parsed file.
 *
 * The receiver name does not matter (`app`, `api`, `router`): sub-apps and
 * routers are registered the same way. Two cheap shape checks keep `c.get('log')`
 * out: the first argument must look like a path, and the last argument must be
 * a handler. The handler is the last argument rather than the second so that
 * Express's `app.get('/x', auth, handler)` and Fastify's
 * `app.get('/x', { schema }, handler)` both count.
 */
function findRoutes(parsed: ParseResult, options: CodeRoutesOptions): FoundRoute[] {
  const found: FoundRoute[] = []

  walkAst(parsed.program, (node) => {
    if (node.type !== 'CallExpression') return
    const call = node as { callee: Node, arguments: Node[] }
    const { callee } = call
    if (callee.type !== 'MemberExpression') return

    const { property: member, computed } = callee as { property: Node, computed?: boolean }
    if (computed || member.type !== 'Identifier') return
    const { name } = member
    const line = () => nodeLoc(node, parsed.lines)?.line ?? 1

    if (name === options.on) {
      const methods = stringLiterals(call.arguments[0]).map(method => method.toUpperCase())
      const paths = stringLiterals(call.arguments[1]).filter(isRoutePath)
      if (methods.length === 0 || paths.length === 0 || call.arguments.length < 3) return
      for (const method of methods) {
        for (const path of paths) found.push({ method, path, line: line() })
      }
      return
    }

    if (name === options.routeObject?.member) {
      const [definition] = call.arguments
      if (definition?.type !== 'ObjectExpression') return
      const path = stringLiteral(property(definition, options.routeObject.path))
      if (!path || !isRoutePath(path)) return
      const methods = stringLiterals(property(definition, options.routeObject.method)).map(method => method.toUpperCase())
      for (const method of methods.length > 0 ? methods : [null]) found.push({ method, path, line: line() })
      return
    }

    if (!options.methods.has(name)) return
    const path = stringLiteral(call.arguments[0])
    if (!path || !isRoutePath(path) || call.arguments.length < 2 || !looksLikeHandler(call.arguments.at(-1))) return
    found.push({ method: options.methods.get(name) ?? null, path, line: line() })
  })

  return found
}

/** Local names bound to `evlog` from the integration's subpath, alias included. */
function middlewareNames(parsed: ParseResult, source: string): Set<string> {
  const names = new Set<string>()
  walkAst(parsed.program, (node) => {
    if (node.type !== 'ImportDeclaration') return
    const declaration = node as {
      source: { value: string }
      specifiers: Array<{ type: string, imported?: { name?: string }, local?: { name: string } }>
    }
    if (declaration.source.value !== source) return
    for (const specifier of declaration.specifiers) {
      if (specifier.imported?.name === 'evlog' && specifier.local) names.add(specifier.local.name)
    }
  })
  return names
}

/**
 * Whether the file registers evlog's middleware: `app.use(evlog())` for
 * middleware frameworks, `app.register(evlog)` for Fastify's plugin.
 */
function registersMiddleware(parsed: ParseResult, options: CodeRoutesOptions['middleware']): boolean {
  const names = middlewareNames(parsed, options.source)
  if (names.size === 0) return false

  const isMiddleware = (argument: Node): boolean => {
    if (argument.type === 'Identifier') return names.has((argument as unknown as { name: string }).name)
    if (argument.type !== 'CallExpression') return false
    const { callee } = argument as { callee: Node }
    return callee.type === 'Identifier' && names.has((callee as unknown as { name: string }).name)
  }

  let found = false
  walkAst(parsed.program, (node) => {
    if (found || node.type !== 'CallExpression') return
    const call = node as { callee: Node, arguments: Node[] }
    if (call.callee.type !== 'MemberExpression') return
    const { property: member, computed } = call.callee as { property: Node, computed?: boolean }
    if (computed || member.type !== 'Identifier' || !options.register.includes(member.name)) return
    found = call.arguments.some(isMiddleware)
  })
  return found
}

/**
 * Route discovery for a framework whose routes are method calls on an app
 * object. The per-request event only exists once the app itself registers
 * evlog's middleware, so the ambient/explicit capability is resolved per
 * project: ambient when the registration is found in the scanned sources,
 * explicit (nothing is emitted at all) when it is not.
 */
export function codeRoutesAdapter(options: CodeRoutesOptions): MapAdapter {
  const sourceFiles = (root: string) => glob(SOURCE_GLOBS, root)

  return {
    resolveRequestLogger(ctx: ScanContext) {
      const parse = ctx.parse ?? parseFile
      for (const file of sourceFiles(ctx.projectRoot)) {
        const parsed = parse(file)
        if (parsed && registersMiddleware(parsed, options.middleware)) return 'ambient'
      }
      return 'explicit'
    },
    // eslint-disable-next-line require-await -- satisfies the async MapAdapter contract
    async extractRoutes(ctx: ScanContext): Promise<RawRouteEntry[]> {
      const parse = ctx.parse ?? parseFile
      const routes: RawRouteEntry[] = []

      for (const file of sourceFiles(ctx.projectRoot)) {
        const parsed = parse(file)
        if (!parsed) continue
        const rel = relativeFromRoot(ctx.projectRoot, file)
        for (const route of findRoutes(parsed, options)) {
          routes.push({
            framework: options.framework,
            kind: 'api',
            method: route.method,
            path: route.path,
            file: rel,
            handler: { line: route.line, column: 0 },
          })
        }
      }

      return routes
    },
  }
}
