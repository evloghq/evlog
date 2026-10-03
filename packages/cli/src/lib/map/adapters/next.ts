import { readFileSync } from 'node:fs'
import type { Node } from 'oxc-parser'
import type { ParseResult } from '../parse'
import {
  findHandlerLocation,
  findHttpMethodExports,
  hasDirective,
  nodeLoc,
  parseFile,
  walkAst,
} from '../parse'
import type { FrameworkAdapter, RawRouteEntry, ScanContext } from '../types'
import { indent, relativeFromRoot, segmentsToPath } from '../utils'
import { glob } from '../../glob'

/**
 * Where the App Router lives, `app/` or `src/app/`.
 *
 * Both page and route files count: an API-only project has no `page.*` at all,
 * and picking the wrong directory there makes every later glob come back empty.
 */
function resolveAppDir(root: string): string {
  for (const candidate of ['app', 'src/app']) {
    if (glob(`${candidate}/**/{page,route}.{tsx,jsx,ts,js}`, root).length > 0) {
      return candidate
    }
  }
  return 'app'
}

function routeDirFromFile(rel: string, appDir: string): string {
  const inner = rel.slice(`${appDir}/`.length)
  /* The leading separator is optional: `app/route.ts` has none, and leaving the
     filename in place would turn the root handler into `/route.ts`. */
  return inner.replace(/(?:^|\/)route\.(?:tsx?|jsx?)$/, '')
}

/**
 * Next.js App Router: `route.ts` handlers, `page.tsx`, middleware, `"use server"`
 * actions. No auto-imports — every evlog helper is imported explicitly, and
 * nothing is emitted until a handler opts in with `useLogger()` or `withEvlog()`.
 */
export const nextAdapter: FrameworkAdapter = {
  framework: 'next',
  requestLogger: 'explicit',
  loggerCall: 'const log = useLogger()',
  handlerShape(route, body) {
    return [`export async function ${route.method ?? 'POST'}(request: Request) {`, ...body.map(line => indent(1, line)), '}']
  },
  // eslint-disable-next-line require-await -- satisfies the async FrameworkAdapter contract
  async extractRoutes(ctx: ScanContext): Promise<RawRouteEntry[]> {
    const routes: RawRouteEntry[] = []
    const root = ctx.projectRoot
    const appDir = resolveAppDir(root)
    const parse = ctx.parse ?? parseFile

    for (const file of glob(`${appDir}/**/route.{ts,js,tsx,jsx}`, root)) {
      const rel = relativeFromRoot(root, file)
      const dir = routeDirFromFile(rel, appDir)
      const apiPath = segmentsToPath(dir.split('/')) || '/'

      const parsed = parse(file)
      if (!parsed) {
        routes.push({
          framework: 'next',
          kind: 'api',
          method: null,
          path: apiPath,
          file: rel,
          handler: null,
        })
        continue
      }

      const methods = findHttpMethodExports(parsed)
      if (methods.length === 0) {
        routes.push({
          framework: 'next',
          kind: 'api',
          method: null,
          path: apiPath,
          file: rel,
          handler: findHandlerLocation(parsed, []),
        })
      } else {
        for (const { method, line } of methods) {
          routes.push({
            framework: 'next',
            kind: 'api',
            method,
            path: apiPath,
            file: rel,
            handler: { line, column: 0 },
          })
        }
      }
    }

    for (const file of glob(`${appDir}/**/page.{tsx,jsx,ts,js}`, root)) {
      const rel = relativeFromRoot(root, file)
      const inner = rel.slice(`${appDir}/`.length)
      const dir = inner.replace(/^(.*\/)?page\.(tsx?|jsx?)$/, (_m, parent) => parent ?? '')
      const path = segmentsToPath(dir ? dir.split('/') : []) || '/'
      routes.push({
        framework: 'next',
        kind: 'page',
        method: null,
        path,
        file: rel,
        handler: null,
      })
    }

    for (const file of glob(['middleware.{ts,js}', 'src/middleware.{ts,js}'], root)) {
      const rel = relativeFromRoot(root, file)
      const parsed = parse(file)
      routes.push({
        framework: 'next',
        kind: 'middleware',
        method: null,
        path: '*',
        file: rel,
        handler: parsed
          ? findHandlerLocation(parsed, [])
          : null,
      })
    }

    for (const file of glob([`${appDir}/**/*.{ts,tsx,js,jsx}`, 'src/**/*.{ts,tsx,js,jsx}'], root)) {
      /* This glob covers the whole source tree, and almost none of it declares
         an action. The directive has to appear literally for Next to treat the
         module as one, so a substring test rules most files out before oxc. */
      if (!mentionsServerDirective(file)) continue
      const parsed = parse(file)
      if (!parsed || !hasDirective(parsed.program, 'use server')) continue
      const rel = relativeFromRoot(root, file)
      const exports = findServerActionExports(parsed)
      for (const exp of exports) {
        routes.push({
          framework: 'next',
          kind: 'server-action',
          method: 'POST',
          path: `action:${exp.name}`,
          file: rel,
          handler: { line: exp.line, column: 0 },
        })
      }
    }

    return routes
  },
}

/** Whether a file so much as mentions `use server`, read without parsing. */
function mentionsServerDirective(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').includes('use server')
  } catch {
    return false
  }
}

/**
 * Every action a `'use server'` module exposes.
 *
 * All four export spellings count, because Next treats every export of such a
 * module as a public endpoint: a missed one is an unscanned POST handler, not a
 * cosmetic gap.
 */
function findServerActionExports(parsed: ParseResult): Array<{ name: string, line: number }> {
  const exports: Array<{ name: string, line: number }> = []
  const lineOf = (node: Node | undefined): number => (node ? nodeLoc(node, parsed.lines)?.line ?? 1 : 1)

  walkAst(parsed.program, (node) => {
    if (node.type === 'ExportDefaultDeclaration') {
      const { declaration } = node as { declaration?: Node }
      if (declaration?.type !== 'FunctionDeclaration' && declaration?.type !== 'ArrowFunctionExpression') return
      const name = declaration.type === 'FunctionDeclaration' ? declaration.id?.name ?? 'default' : 'default'
      exports.push({ name, line: lineOf(node) })
      return
    }

    if (node.type !== 'ExportNamedDeclaration') return
    const decl = node as {
      source?: { value: string } | null
      specifiers?: Array<{ exported?: { type: string, name?: string, value?: string } }>
      declaration?: {
        type: string
        id?: { name: string }
        declarations?: Array<{ id: { type: string, name: string }, init?: { type: string } }>
      }
    }

    /* `export { createOrder }` and `export { handler as createOrder }`, but not
       `export { x } from './elsewhere'` — a re-export is another module's. */
    if (!decl.declaration && !decl.source) {
      for (const specifier of decl.specifiers ?? []) {
        const name = specifier.exported?.name ?? specifier.exported?.value
        if (name) exports.push({ name, line: lineOf(node) })
      }
      return
    }

    if (decl.declaration?.type === 'FunctionDeclaration' && decl.declaration.id?.name) {
      exports.push({ name: decl.declaration.id.name, line: lineOf(node) })
    }
    if (decl.declaration?.type === 'VariableDeclaration') {
      for (const d of decl.declaration.declarations ?? []) {
        if (d.id.type === 'Identifier' && d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')) {
          exports.push({ name: d.id.name, line: lineOf(d.init as Node) })
        }
      }
    }
  })
  return exports
}
