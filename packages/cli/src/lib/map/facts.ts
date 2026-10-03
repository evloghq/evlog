import type { Node } from 'oxc-parser'
import type { ParseResult } from './parse'
import { walkAst } from './parse'
import type { HandlerLocation } from './types'

/**
 * Everything the rules are allowed to know about one file.
 *
 * All AST decoding lives here, in a single pass, so that rules never walk the
 * tree themselves. That is deliberate: hand-rolled node spelunking scattered
 * across rules is what makes a static analyser fragile, because each rule ends
 * up with its own slightly different idea of what "a call to log.set()" means.
 * One place to get it right, one place to fix when it is wrong.
 */
export interface FileFacts {
  /** Local binding → import source, e.g. `useLogger` → `evlog`. */
  imports: Map<string, string>
  /** Names declared in this file — used to detect shadowing of auto-imports. */
  localDeclarations: Set<string>
  calls: readonly CallFact[]
  throws: readonly ThrowFact[]
  catches: readonly CatchFact[]
  /** Network calls (`fetch`, `$fetch`, `useFetch`, `axios.*`, …). */
  network: readonly CallFact[]
  /**
   * Network calls with no error affordance around them.
   *
   * Guarding is resolved per call rather than per file: an unrelated `try` at
   * the top of a page used to satisfy the whole rule, so a page could pass with
   * its actual data fetch left unhandled.
   */
  unguardedNetwork: readonly CallFact[]
  /** Where an evlog logger is created, if it is. */
  loggerInit: HandlerLocation | null
  /** Identifiers holding an evlog logger — `const log = useLogger(event)`. */
  loggerBindings: ReadonlySet<string>
  /**
   * evlog wrappers used here, e.g. `withEvlog`, `withAudit`.
   *
   * These instrument the event without the handler ever naming a logger, which
   * is exactly how evlog documents its Next.js integration — so a rule that
   * only looks for `useLogger()` would flag evlog's own recommended code.
   */
  evlogWrappers: ReadonlySet<string>
  /** evlog entrypoints imported here, e.g. `evlog`, `evlog/ai`. */
  evlogImports: ReadonlySet<string>
  /**
   * evlog names this file re-exports, or `*` for `export * from 'evlog'`.
   *
   * Re-exporting evlog through a local module is how its own Next.js docs read
   * (`import { useLogger } from '@/lib/evlog'`), so a scan that only trusted the
   * literal source `evlog` scored that recommended shape as uninstrumented.
   */
  reexportsEvlog: ReadonlySet<string>
  /** Object keys and member names seen anywhere — cheap PII surface. */
  names: ReadonlySet<string>
  /** `createError({ … })` calls with enough literal detail to compare. */
  inlineErrors: readonly InlineErrorFact[]
  /** Catalog names declared here — `billing` for `defineErrorCatalog('billing', …)`. */
  catalogsDeclared: readonly string[]
  /** Calls on a known evlog logger, e.g. `loggerCalls('audit')`. */
  loggerCalls: (member: string) => readonly CallFact[]
  /** Calls by normalized callee name, e.g. `callsTo('createError')`. */
  callsTo: (name: string) => readonly CallFact[]
}

export interface CallFact {
  /** Normalized callee: `useLogger`, `log.set`, `console.error`. */
  name: string
  /** Trailing member for member calls (`set`), else the identifier. */
  member: string
  /** Receiver identifier for member calls (`log`), else `null`. */
  receiver: string | null
  /**
   * Root identifier of the callee chain — `log` in `log.audit?.deny()`.
   *
   * Separate from `receiver`, which is only the immediate object: without this,
   * a nested or optional chain loses track of who the call is really on.
   */
  root: string | null
  /** Member names from the root — `['audit', 'deny']` for `log.audit?.deny()`. */
  chain: readonly string[]
  line: number
  /** Byte offset of the call, used to place it inside an error guard. */
  start: number
  /** Keys of the first argument when it is an object literal. */
  props: ReadonlySet<string>
}

export interface ThrowFact {
  kind: 'plain-error' | 'create-error' | 'other'
  /** Keys passed to `createError({ … })`. */
  props: ReadonlySet<string>
  line: number
}

/**
 * One `createError({ … })` call, identified by its literal payload.
 *
 * The signature exists so the same error can be recognised in two different
 * files. That is the only honest reason to bring up error catalogs: an error
 * written once is fine where it is, whereas the same error written out in three
 * handlers is a catalog entry waiting to happen.
 */
export interface InlineErrorFact {
  /** Literal status/code/message/why, normalized. Empty when nothing compares. */
  signature: string
  /** Short human label, e.g. `402 Card declined`. */
  label: string
  line: number
}

export interface CatchFact {
  line: number
  isEmpty: boolean
  /** Logs, rethrows, or returns — i.e. the error is not silently dropped. */
  handled: boolean
}

/**
 * Factories that hand back a wide-event logger.
 *
 * evlog's `log` export is not one of them — it is the simple logging API and
 * has no `set` or `audit`.
 */
const LOGGER_FACTORIES = ['useLogger', 'createLogger', 'createRequestLogger', 'initLogger']

/**
 * evlog wrappers that instrument a handler on the caller's behalf.
 *
 * `withEvlog` creates the request logger (evlog's documented Next.js pattern);
 * `withAudit` writes audit fields onto the ambient one.
 */
const EVLOG_WRAPPERS = ['withEvlog', 'withAudit']

/** Network entry points worth an event when they fail. */
const NETWORK_CALLS = [
  'fetch',
  '$fetch',
  'useFetch',
  'useLazyFetch',
  'useAsyncData',
  'useLazyAsyncData',
  'ofetch',
]

const NETWORK_RECEIVERS = ['axios', 'http', 'https']

/** Statement shapes inside a `catch` that count as handling the error. */
const HANDLING_MEMBERS = ['error', 'warn', 'set', 'audit', 'captureException']

/** Calls that put an error affordance around whatever they wrap. */
const ERROR_GUARD_MEMBERS = ['catch', 'onError', 'catchError']

/** Half-open `[start, end)` byte range of source that guards against a failure. */
type GuardRange = readonly [number, number]

function nodeRange(node: Node): GuardRange {
  const { start, end } = node as unknown as { start: number, end: number }
  return [start, end]
}

function isEvlogSource(source: string | undefined | null): boolean {
  return source === 'evlog' || (source?.startsWith('evlog/') ?? false)
}

/**
 * How a local module is keyed when matching an import to a re-exporting file.
 *
 * The same module is written `@/lib/evlog`, `~/lib/evlog` and `../../lib/evlog`
 * depending on where it is imported from, and resolving those properly means
 * reading `tsconfig` path aliases, Nuxt aliases and Vite aliases — three sources
 * of truth that can each be wrong. The last meaningful segment is stable across
 * all of them: `evlog` for `lib/evlog.ts`, and the directory name for an
 * `index.ts`, which is how such a module is imported anyway.
 */
export function moduleKey(specifier: string): string {
  const segments = specifier
    .replace(/\.(?:m|c)?[jt]sx?$/, '')
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.' && segment !== '..')

  const last = segments[segments.length - 1]
  if (last === 'index') return segments[segments.length - 2] ?? 'index'
  return last ?? specifier
}

/** Properties whose literal values make one error distinguishable from another. */
const ERROR_IDENTITY_KEYS = ['status', 'statusCode', 'code', 'message', 'why']

function literalValue(node: Node | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal') {
    const { value } = node as { value: unknown }
    return value === null || value === undefined ? null : String(value)
  }
  /* A template literal with no interpolation is just a string. */
  if (node.type === 'TemplateLiteral') {
    const template = node as { expressions: Node[], quasis: Array<{ value: { cooked?: string | null } }> }
    if (template.expressions.length > 0) return null
    return template.quasis[0]?.value.cooked ?? null
  }
  return null
}

/** Literal properties of an object literal, by key. */
function literalProps(node: Node | undefined): Map<string, string> {
  const props = new Map<string, string>()
  if (!node || node.type !== 'ObjectExpression') return props
  for (const prop of (node as { properties: Node[] }).properties) {
    if (prop.type !== 'Property') continue
    const { key, value } = prop as { key: Node, value: Node }
    const name = key.type === 'Identifier'
      ? key.name
      : key.type === 'Literal' ? String((key as { value: unknown }).value) : null
    if (name === null) continue
    const literal = literalValue(value)
    if (literal !== null) props.set(name, literal)
  }
  return props
}

/**
 * Identity of a `createError({ … })` payload.
 *
 * Only literals count: an error built from variables cannot be compared across
 * files, and guessing would produce false matches — which in a suggestion means
 * pointing at code that has nothing in common.
 */
function errorIdentity(argument: Node | undefined): InlineErrorFact | null {
  const props = literalProps(argument)
  const identity = ERROR_IDENTITY_KEYS
    .filter(key => props.has(key))
    .map(key => `${key}=${props.get(key)!}`)
  if (identity.length === 0) return null

  const status = props.get('status') ?? props.get('statusCode')
  const text = props.get('code') ?? props.get('message') ?? props.get('why')
  const label = [status, text].filter(Boolean).join(' ')

  return { signature: identity.join('|'), label: label.length > 0 ? label : identity[0]!, line: 0 }
}

function objectKeys(node: Node | undefined): Set<string> {
  const keys = new Set<string>()
  if (!node || node.type !== 'ObjectExpression') return keys
  for (const prop of (node as { properties: Node[] }).properties) {
    if (prop.type !== 'Property') continue
    const { key } = prop as { key: Node }
    if (key.type === 'Identifier') keys.add(key.name)
    if (key.type === 'Literal') keys.add(String((key as { value: unknown }).value))
  }
  return keys
}

type CalleeShape = Pick<CallFact, 'name' | 'member' | 'receiver' | 'root' | 'chain'>

/** Strip the wrapper oxc puts around an optional chain (`a?.b()`). */
/**
 * Strip the wrappers that sit between a name and its value.
 *
 * `req.context.log as RequestLogger` is the spelling evlog's own TanStack Start
 * guide uses, and a cast that hides the member chain is enough to make the
 * handler look uninstrumented.
 */
function unwrapChain(node: Node): Node {
  let current = node
  while (true) {
    switch (current.type) {
      case 'ChainExpression':
      case 'ParenthesizedExpression':
        current = (current as { expression: Node }).expression
        break
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
        current = (current as { expression: Node }).expression
        break
      default:
        return current
    }
  }
}

/**
 * Where a framework parks the request logger, read as a member chain.
 *
 * Not every integration hands the logger back from a factory: evlog's Nitro
 * plugin puts it on the request context, so the documented TanStack Start and
 * h3 handlers reach it with `req.context.log` and never call `useLogger()`.
 * Reading only factories scored those handlers as dark events while they were
 * calling `log.set()` on every request.
 */
const CONTEXT_LOGGER_PATH = ['context', 'log'] as const

/** Whether `chain` contains `context.log` as consecutive members. */
function hasContextLoggerPath(chain: readonly string[]): boolean {
  return chain.some(
    (name, index) => name === CONTEXT_LOGGER_PATH[0] && chain[index + 1] === CONTEXT_LOGGER_PATH[1],
  )
}

/**
 * Whether a member path ends on the logger the integration parks on the request
 * object: `req.log` for Express, `request.log` for Fastify. Taken at face value
 * like `context.log`, for the same asymmetry of costs.
 */
function endsWithRequestLogger(path: readonly string[], member: string | undefined): boolean {
  return member !== undefined && path.length > 0 && path.at(-1) === member
}

/**
 * Whether a call is made on that logger: `req.log.set(…)`. The member has to
 * sit before the invoked one, so `console.log(…)` and `logger.log(…)`, where
 * `log` is the call itself, never count.
 */
function callsRequestLogger(call: Pick<CallFact, 'root' | 'chain'>, member: string | undefined): boolean {
  if (member === undefined || call.root === 'console') return false
  const index = call.chain.indexOf(member)
  return index !== -1 && index < call.chain.length - 1
}

/**
 * Hono's `c.get('log')` (and the same shape on any context object).
 *
 * Not a member path: the key is a call argument. Taken at face value like
 * `context.log` — there is no import to check, and missing it would score
 * every idiomatic Hono handler as a dark event.
 */
function isContextGetLog(node: Node): boolean {
  if (node.type !== 'CallExpression') return false
  const call = node as { callee: Node, arguments: Node[] }
  if (call.callee.type !== 'MemberExpression') return false
  const member = call.callee as { property: Node, computed?: boolean }
  if (member.computed || member.property.type !== 'Identifier' || member.property.name !== 'get') {
    return false
  }
  const [key] = call.arguments
  return key?.type === 'Literal' && (key as { value: unknown }).value === 'log'
}

/** Member names of `node`, root first — `['context', 'log']` for `req.context.log`. */
function memberPath(node: Node): string[] {
  const path: string[] = []
  let current = unwrapChain(node)
  while (current.type === 'MemberExpression') {
    const { property, object } = current as { property: Node, object: Node }
    if (property.type !== 'Identifier') return []
    path.unshift(property.name)
    current = unwrapChain(object)
  }
  return path
}

/**
 * Bindings a declaration pattern introduces.
 *
 * Only the shapes that appear in evlog's own setup are handled: a plain name and
 * a flat object pattern. Anything deeper would be guesswork.
 */
function patternNames(id: Node): string[] {
  if (id.type === 'Identifier') return [id.name]
  if (id.type !== 'ObjectPattern') return []

  const names: string[] = []
  for (const property of (id as { properties: Node[] }).properties) {
    if (property.type !== 'Property') continue
    const { value, key } = property as { value: Node, key: Node }
    if (value.type === 'Identifier') names.push(value.name)
    else if (key.type === 'Identifier') names.push(key.name)
  }
  return names
}

/** Local name `key` is bound to by an object pattern, honouring renames. */
function destructuredAs(id: Node, key: string): string | null {
  if (id.type !== 'ObjectPattern') return null
  for (const property of (id as { properties: Node[] }).properties) {
    if (property.type !== 'Property') continue
    const { key: propertyKey, value } = property as { key: Node, value: Node }
    if (propertyKey.type !== 'Identifier' || propertyKey.name !== key) continue
    if (value.type === 'Identifier') return value.name
  }
  return null
}

/**
 * Decode a call's callee into names.
 *
 * Walks the whole member chain so `log.audit?.deny()` is still recognised as a
 * call on `log`: matching only the immediate object misses it, and an
 * unrecognised audit call means the report claims an audited route is not.
 */
function describeCallee(rawCallee: Node): CalleeShape | null {
  const callee = unwrapChain(rawCallee)

  if (callee.type === 'Identifier') {
    return { name: callee.name, member: callee.name, receiver: null, root: null, chain: [callee.name] }
  }
  if (callee.type !== 'MemberExpression') return null

  const chain: string[] = []
  let current = callee as Node
  while (true) {
    current = unwrapChain(current)
    if (current.type !== 'MemberExpression') break
    const { property } = (current as { property: Node })
    if (property.type !== 'Identifier') return null
    chain.unshift(property.name)
    current = (current as { object: Node }).object
  }

  const member = chain.at(-1)
  if (member === undefined) return null
  const root = current.type === 'Identifier' ? current.name : null
  const receiver = chain.length === 1 ? root : (chain.at(-2) ?? null)

  return {
    name: [root, ...chain].filter(Boolean).join('.'),
    member,
    receiver,
    root,
    chain,
  }
}

function isNetworkCall(call: CallFact): boolean {
  if (NETWORK_CALLS.includes(call.member)) return true
  return call.receiver !== null && NETWORK_RECEIVERS.includes(call.receiver)
}

/**
 * Whether a statement inside a `catch` block does something with the error.
 *
 * Nested bodies count: `catch (e) { if (retryable(e)) log.warn(e); else throw e }`
 * is a handled error however deep the branch sits, and reading only the direct
 * children reported that catch as swallowing everything.
 */
function statementHandlesError(statement: Node): boolean {
  if (statement.type === 'ThrowStatement' || statement.type === 'ReturnStatement') return true

  switch (statement.type) {
    case 'BlockStatement':
      return (statement as { body: Node[] }).body.some(statementHandlesError)
    case 'IfStatement': {
      const { consequent, alternate } = statement as { consequent: Node, alternate?: Node | null }
      return statementHandlesError(consequent) || (!!alternate && statementHandlesError(alternate))
    }
    case 'SwitchStatement':
      return (statement as { cases: Array<{ consequent: Node[] }> }).cases
        .some(branch => branch.consequent.some(statementHandlesError))
    case 'TryStatement': {
      const { block, handler, finalizer } = statement as {
        block: Node
        handler?: { body: Node } | null
        finalizer?: Node | null
      }
      return statementHandlesError(block)
        || (!!handler && statementHandlesError(handler.body))
        || (!!finalizer && statementHandlesError(finalizer))
    }
    default:
      break
  }

  if (statement.type !== 'ExpressionStatement') return false

  let { expression } = (statement as { expression: Node })
  if (expression.type === 'AwaitExpression') {
    expression = (expression as { argument: Node }).argument
  }
  if (expression.type !== 'CallExpression') return false

  const described = describeCallee((expression as { callee: Node }).callee)
  if (!described) return false
  if (described.root === 'console') return true
  return described.chain.some(name => HANDLING_MEMBERS.includes(name))
}

/**
 * Collect the facts for one parsed file in a single AST pass.
 *
 * @param options.evlogAutoImports - evlog identifiers the framework injects
 * without an import (Nuxt/Nitro). An auto-import only counts when the file does
 * not declare the same name itself, so a local `function useLogger()` stub is
 * not mistaken for evlog's.
 * @param options.evlogBarrels - local modules that re-export evlog, keyed by
 * {@link moduleKey}, with the names each one forwards. Collected once per scan so
 * that a handler importing from `@/lib/evlog` is credited without this function
 * ever touching the filesystem.
 */
export function buildFileFacts(
  parsed: ParseResult,
  options: {
    evlogAutoImports?: readonly string[]
    evlogBarrels?: ReadonlyMap<string, ReadonlySet<string>>
    requestLoggerMember?: string
  } = {},
): FileFacts {
  const { lines } = parsed
  const imports = new Map<string, string>()
  const localDeclarations = new Set<string>()
  const calls: CallFact[] = []
  const throwFacts: ThrowFact[] = []
  const catchFacts: CatchFact[] = []
  const inlineErrors: InlineErrorFact[] = []
  const catalogsDeclared: string[] = []
  const reexportsEvlog = new Set<string>()
  const names = new Set<string>()
  /** Resolved after the pass: needs imports and declarations to be complete. */
  const loggerCandidates: Array<{ binding: string | null, factory: string, line: number }> = []
  /** Loggers read off the request context — no import to resolve them against. */
  const contextLoggers: Array<{ binding: string, line: number }> = []
  /** Exported bindings whose value comes from a call — resolved after the pass. */
  const exportedFromFactory: Array<{ names: readonly string[], factory: string }> = []
  /** Source spans in which a failure is caught, handled or surfaced. */
  const guards: GuardRange[] = []

  walkAst(parsed.program, (node) => {
    switch (node.type) {
      case 'ImportDeclaration': {
        const declaration = node as {
          source: { value: string }
          specifiers: Array<{ type: string, local?: { name: string } }>
        }
        for (const specifier of declaration.specifiers) {
          if (specifier.local) imports.set(specifier.local.name, declaration.source.value)
        }
        break
      }

      case 'ExportNamedDeclaration': {
        const exported = node as {
          source?: { value: string } | null
          specifiers?: Array<{ exported?: { name?: string } }>
          declaration?: Node | null
        }

        if (exported.source) {
          if (!isEvlogSource(exported.source.value)) break
          for (const specifier of exported.specifiers ?? []) {
            if (specifier.exported?.name) reexportsEvlog.add(specifier.exported.name)
          }
          break
        }

        /* `export const { useLogger, withEvlog } = createEvlog({ … })` — evlog's
           documented Next.js setup. Whether the factory is really evlog's can
           only be answered once the imports are known, so it waits. */
        if (exported.declaration?.type !== 'VariableDeclaration') break
        for (const declarator of (exported.declaration as { declarations: Node[] }).declarations) {
          const { id, init } = declarator as { id: Node, init?: Node }
          if (init?.type !== 'CallExpression') continue
          const factory = describeCallee((init as { callee: Node }).callee)
          if (!factory) continue
          exportedFromFactory.push({ names: patternNames(id), factory: factory.member })
        }
        break
      }

      case 'ExportAllDeclaration': {
        const declaration = node as { source?: { value: string } | null }
        if (isEvlogSource(declaration.source?.value)) reexportsEvlog.add('*')
        break
      }

      case 'FunctionDeclaration':
      case 'ClassDeclaration': {
        const { id } = (node as { id?: { name: string } })
        if (id?.name) localDeclarations.add(id.name)
        break
      }

      case 'VariableDeclarator': {
        const declarator = node as { id: Node, init?: Node }
        /* Destructuring binds names too: without this, `const { useLogger } =
           createStub()` shadows the auto-import unnoticed and the file gets
           credited with evlog's logger when it declared its own. */
        for (const name of patternNames(declarator.id)) {
          localDeclarations.add(name)
        }
        if (!declarator.init) break

        let init = unwrapChain(declarator.init)
        if (init.type === 'AwaitExpression') init = unwrapChain((init as { argument: Node }).argument)

        /* `const log = req.context.log` and `const { log } = req.context`: the
           logger comes off the request, not out of a factory. */
        if (init.type === 'MemberExpression') {
          const path = memberPath(init)
          const line = lines.lineAt((init as unknown as { start: number }).start)
          if (hasContextLoggerPath(path) || endsWithRequestLogger(path, options.requestLoggerMember)) {
            for (const name of patternNames(declarator.id)) {
              contextLoggers.push({ binding: name, line })
            }
          } else if (path.at(-1) === CONTEXT_LOGGER_PATH[0]) {
            const binding = destructuredAs(declarator.id, CONTEXT_LOGGER_PATH[1])
            if (binding) contextLoggers.push({ binding, line })
          }
        }

        if (init.type === 'CallExpression') {
          const described = describeCallee((init as { callee: Node }).callee)
          if (described && LOGGER_FACTORIES.includes(described.member)) {
            loggerCandidates.push({
              binding: declarator.id.type === 'Identifier' ? declarator.id.name : null,
              factory: described.member,
              line: lines.lineAt((init as unknown as { start: number }).start),
            })
          }
          /* `const log = c.get('log')` — Hono's documented accessor. */
          if (isContextGetLog(init)) {
            const line = lines.lineAt((init as unknown as { start: number }).start)
            for (const name of patternNames(declarator.id)) {
              contextLoggers.push({ binding: name, line })
            }
          }
        }

        /* `const { data, error } = await useFetch(…)` — the failure is bound
           rather than caught, which is Nuxt's shape for handling it. */
        if (destructuredAs(declarator.id, 'error')) guards.push(nodeRange(node))
        break
      }

      case 'TryStatement': {
        guards.push(nodeRange((node as { block: Node }).block))
        break
      }

      case 'CallExpression': {
        const described = describeCallee((node as { callee: Node }).callee)
        if (!described) break
        const [firstArgument] = (node as { arguments: Node[] }).arguments
        const { start } = (node as unknown as { start: number })
        const line = lines.lineAt(start)
        calls.push({ ...described, line, start, props: objectKeys(firstArgument) })

        /* `fetch(…).catch(…)` — the guard spans the call it is chained onto. */
        if (ERROR_GUARD_MEMBERS.includes(described.member)) guards.push(nodeRange(node))

        if (described.member === 'createError') {
          const identity = errorIdentity(firstArgument)
          if (identity) inlineErrors.push({ ...identity, line })
        }
        if (described.member === 'defineErrorCatalog') {
          const name = literalValue(firstArgument)
          if (name !== null) catalogsDeclared.push(name)
        }
        break
      }

      case 'ThrowStatement': {
        const { argument } = (node as { argument: Node | null })
        if (!argument) break
        const line = lines.lineAt((node as unknown as { start: number }).start)

        if (argument.type === 'NewExpression') {
          const { callee } = argument as { callee: Node }
          const isPlain = callee.type === 'Identifier' && callee.name === 'Error'
          throwFacts.push({ kind: isPlain ? 'plain-error' : 'other', props: new Set(), line })
          break
        }
        if (argument.type === 'CallExpression') {
          const described = describeCallee((argument as { callee: Node }).callee)
          if (described?.member === 'createError') {
            const [firstArgument] = (argument as { arguments: Node[] }).arguments
            throwFacts.push({ kind: 'create-error', props: objectKeys(firstArgument), line })
            break
          }
        }
        throwFacts.push({ kind: 'other', props: new Set(), line })
        break
      }

      case 'CatchClause': {
        const statements = (node as { body: { body: Node[] } }).body.body
        catchFacts.push({
          line: lines.lineAt((node as unknown as { start: number }).start),
          isEmpty: statements.length === 0,
          handled: statements.some(statementHandlesError),
        })
        break
      }

      case 'MemberExpression': {
        const { property } = (node as { property: Node })
        if (property.type === 'Identifier') names.add(property.name)
        break
      }

      case 'Property': {
        const { key } = node as { key: Node }
        if (key.type === 'Identifier') names.add(key.name)
        if (key.type === 'Literal') names.add(String((key as { value: unknown }).value))
        break
      }

      default:
        break
    }
  })

  /*
   * Whether a name refers to evlog's export, now that imports and local
   * declarations are both known.
   *
   * An explicit import wins: `import { useLogger } from './my-logger'` is not
   * evlog's, even in a project where evlog auto-imports that name. A local
   * declaration beats an auto-import for the same reason.
   */
  const evlogAutoImports = options.evlogAutoImports ?? []
  const { evlogBarrels } = options
  const resolvesToEvlog = (name: string): boolean => {
    const source = imports.get(name)
    if (source !== undefined) {
      if (isEvlogSource(source)) return true
      /* A local module counts only for the names it actually forwards, so a
         hand-written `./my-logger` stub is still not evlog's. */
      const forwarded = evlogBarrels?.get(moduleKey(source))
      return forwarded !== undefined && (forwarded.has(name) || forwarded.has('*'))
    }
    return evlogAutoImports.includes(name) && !localDeclarations.has(name)
  }

  const loggerBindings = new Set<string>()
  let loggerInit: HandlerLocation | null = null
  for (const candidate of loggerCandidates) {
    if (!resolvesToEvlog(candidate.factory)) continue
    loggerInit ??= { line: candidate.line, column: 0 }
    if (candidate.binding) loggerBindings.add(candidate.binding)
  }
  /* Taken at face value: there is no import to check a context read against, and
     the cost of the two errors is not symmetric — crediting a rare non-evlog
     `context.log` is harmless, while missing evlog's own documented shape tells
     a correctly instrumented handler that it is a dark event. */
  for (const contextLogger of contextLoggers) {
    loggerInit ??= { line: contextLogger.line, column: 0 }
    loggerBindings.add(contextLogger.binding)
  }
  /*
   * evlog's `log` export is deliberately not treated as a request logger: it is
   * the simple logging API (`log.info`, `log.error`) with no `set` or `audit`,
   * so it emits standalone lines rather than contributing to the request's wide
   * event.
   */
  if (!loggerInit) {
    const bare = calls.find(call => LOGGER_FACTORIES.includes(call.member) && resolvesToEvlog(call.member))
    if (bare) loggerInit = { line: bare.line, column: 0 }
  }
  /* `event.context.log.set({ … })` — used straight off the request, never bound. */
  if (!loggerInit) {
    const inline = calls.find(call => hasContextLoggerPath(call.chain) || callsRequestLogger(call, options.requestLoggerMember))
    if (inline) loggerInit = { line: inline.line, column: 0 }
  }

  for (const { names: exportedNames, factory } of exportedFromFactory) {
    if (!resolvesToEvlog(factory)) continue
    for (const name of exportedNames) reexportsEvlog.add(name)
  }

  const evlogImports = new Set<string>()
  for (const source of imports.values()) {
    if (isEvlogSource(source)) evlogImports.add(source)
  }

  const evlogWrappers = new Set<string>()
  for (const call of calls) {
    if (EVLOG_WRAPPERS.includes(call.member) && resolvesToEvlog(call.member)) {
      evlogWrappers.add(call.member)
    }
  }

  const network = calls.filter(isNetworkCall)
  const unguardedNetwork = network.filter(
    call => !guards.some(([start, end]) => call.start >= start && call.start < end),
  )

  return {
    imports,
    localDeclarations,
    calls,
    throws: throwFacts,
    catches: catchFacts,
    network,
    unguardedNetwork,
    loggerInit,
    loggerBindings,
    evlogWrappers,
    evlogImports,
    reexportsEvlog,
    names,
    inlineErrors,
    catalogsDeclared,
    /* Matches anywhere in the chain so `log.audit()` and `log.audit?.deny()`
       both count as audit calls, and reads the logger straight off the request
       context for handlers that never bind it — `req.context.log.set({ … })`. */
    loggerCalls: member => calls.filter((call) => {
      if (!call.chain.includes(member)) return false
      if (call.root !== null && loggerBindings.has(call.root)) return true
      return hasContextLoggerPath(call.chain) || callsRequestLogger(call, options.requestLoggerMember)
    }),
    callsTo: name => calls.filter(call => call.member === name),
  }
}
