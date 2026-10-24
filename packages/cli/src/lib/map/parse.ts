import { readFileSync } from 'node:fs'
import { parseSync } from 'oxc-parser'
import type { Comment, Node, Program } from 'oxc-parser'
import type { HandlerLocation } from './types'

export interface ParseResult {
  program: Program
  source: string
  errors: string[]
  /** Byte offset → line resolver for this source. */
  lines: LineIndex
  /** Comments, kept for `evlog-map-disable` directives. */
  comments: readonly Comment[]
}

/**
 * Offset → position lookup for one source file.
 *
 * Built once per file and shared by every consumer: resolving a line by
 * counting newlines from the start of the file is O(offset), which turns
 * quadratic once you ask for thousands of node positions.
 */
export interface LineIndex {
  lineAt: (offset: number) => number
  locAt: (offset: number) => HandlerLocation
}

export function createLineIndex(source: string): LineIndex {
  const starts: number[] = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1)
  }

  /** Index of the line containing `offset`, by binary search over line starts. */
  function indexOf(offset: number): number {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (starts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low
  }

  return {
    lineAt: offset => indexOf(offset) + 1,
    locAt: (offset) => {
      const index = indexOf(offset)
      return { line: index + 1, column: offset - starts[index]! }
    },
  }
}

/** Parse a route file (Vue `<script>` extracted first) into an oxc AST + source. */
export function parseFile(filePath: string): ParseResult | null {
  let source: string
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  return parseSource(filePath, source)
}

/** Reads and parses one path. */
export type ParseFn = (filePath: string) => ParseResult | null

/**
 * A {@link parseFile} that touches each path once, for the length of one scan.
 *
 * The adapter parses a file to find its handler and the scan parses it again to
 * derive its facts — and Next emits one entry per exported method, so a
 * `route.ts` with GET, POST and DELETE went through oxc four times.
 *
 * Scoped to a scan rather than the module: a cache that outlives the run would
 * serve stale ASTs to the next one.
 */
export function createParseCache(): ParseFn {
  const seen = new Map<string, ParseResult | null>()
  return (filePath) => {
    if (!seen.has(filePath)) seen.set(filePath, parseFile(filePath))
    return seen.get(filePath) ?? null
  }
}

/**
 * Parse source that is already in memory.
 *
 * Split out from {@link parseFile} so rules can be tested against inline code
 * without touching the filesystem — `filePath` is only used to pick the
 * dialect and to label parse errors.
 */
export function parseSource(filePath: string, source: string): ParseResult | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  let code = source

  if (ext === 'vue') {
    const extracted = extractVueScript(source)
    if (!extracted) return null
    code = extracted
  }

  const result = parseSync(filePath, code, {
    sourceType: 'module',
    lang: ext === 'tsx' || ext === 'jsx' ? 'tsx' : 'ts',
  })

  return {
    program: result.program,
    source: code,
    errors: result.errors.map(e => e.message),
    lines: createLineIndex(code),
    comments: result.comments,
  }
}

/**
 * Extract a Vue `<script>` block, padded with the newlines that preceded it.
 *
 * The padding keeps every reported line number aligned with the `.vue` file the
 * user will open, instead of being relative to the script block.
 */
function extractVueScript(source: string): string | null {
  const block = matchVueScript(source)
  if (!block) return null
  const before = source.slice(0, block.index).split('\n').length - 1
  return '\n'.repeat(before) + block.code
}

/** The `<script setup>` block of a Vue file, else its `<script>`, with the offset its code starts at. */
export function matchVueScript(source: string): { code: string, index: number } | null {
  const scriptSetup = source.match(/<script[^>]*setup[^>]*>([\s\S]*?)<\/script>/i)
  if (scriptSetup?.[1] !== undefined && scriptSetup.index !== undefined) {
    return { code: scriptSetup[1], index: scriptSetup.index + scriptSetup[0].indexOf('>') + 1 }
  }
  const plain = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
  if (plain?.[1] !== undefined && plain.index !== undefined) {
    return { code: plain[1], index: plain.index + plain[0].indexOf('>') + 1 }
  }
  return null
}

export type VisitorFn = (node: Node, parent: Node | null) => void

/** Walk every node in an oxc AST subtree, depth-first. */
export function walkAst(node: Node, visitor: VisitorFn, parent: Node | null = null): void {
  visitor(node, parent)
  for (const key of Object.keys(node as unknown as Record<string, unknown>)) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (!value) continue
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && 'type' in child) {
          walkAst(child as Node, visitor, node)
        }
      }
    } else if (typeof value === 'object' && value !== null && 'type' in value) {
      walkAst(value as Node, visitor, node)
    }
  }
}

/**
 * Real source position of a node.
 *
 * `lines` is required on purpose: the previous signature made it optional and
 * fell back to `{ line: 1 }`, so every caller that forgot it silently reported
 * findings on line 1.
 */
export function nodeLoc(node: Node, lines: LineIndex): HandlerLocation | null {
  if ('start' in node && typeof node.start === 'number') {
    return lines.locAt(node.start)
  }
  if ('loc' in node && node.loc && typeof node.loc === 'object') {
    const loc = node.loc as { start?: { line?: number, column?: number } }
    if (loc.start?.line !== undefined) {
      return { line: loc.start.line, column: loc.start.column ?? 0 }
    }
  }
  return null
}

export function isCallNamed(node: Node, names: string[]): node is Node & { type: 'CallExpression', callee: Node } {
  if (node.type !== 'CallExpression') return false
  const { callee } = (node as { callee: Node })
  if (callee.type === 'Identifier') {
    return names.includes(callee.name)
  }
  if (callee.type === 'MemberExpression') {
    const prop = (callee as { property: Node }).property
    if (prop.type === 'Identifier') {
      return names.includes(prop.name)
    }
  }
  return false
}

export function findHandlerLocation(parsed: ParseResult, patterns: string[]): HandlerLocation | null {
  let found: HandlerLocation | null = null
  walkAst(parsed.program, (node) => {
    if (found) return
    if (isCallNamed(node, patterns)) {
      const loc = nodeLoc(node, parsed.lines)
      if (loc) {
        found = loc
      }
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const loc = nodeLoc(node, parsed.lines)
      if (loc) found = loc
    }
  })
  return found
}

export function hasDirective(program: Program, directive: string): boolean {
  let found = false
  walkAst(program, (node) => {
    if (node.type === 'ExpressionStatement') {
      const expr = (node as { expression: Node }).expression
      if (expr.type === 'Literal' && (expr as { value: unknown }).value === directive) {
        found = true
      }
    }
  })
  return found
}

export function findHttpMethodExports(parsed: ParseResult): Array<{ method: string, line: number }> {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  const found: Array<{ method: string, line: number }> = []
  walkAst(parsed.program, (node) => {
    if (node.type === 'ExportNamedDeclaration') {
      const decl = node as { declaration?: Node, specifiers?: Array<{ exported: Node }> }
      if (decl.declaration?.type === 'FunctionDeclaration') {
        const fn = decl.declaration as { id?: { name: string } }
        if (fn.id?.name && methods.includes(fn.id.name)) {
          const loc = nodeLoc(node, parsed.lines)
          found.push({ method: fn.id.name, line: loc?.line ?? 1 })
        }
      }
      if (decl.declaration?.type === 'VariableDeclaration') {
        const varDecl = decl.declaration as { declarations: Array<{ id: Node, init?: Node }> }
        for (const d of varDecl.declarations) {
          if (d.id.type === 'Identifier' && methods.includes(d.id.name) && d.init) {
            const loc = nodeLoc(d.init, parsed.lines)
            found.push({ method: d.id.name, line: loc?.line ?? 1 })
          }
        }
      }
      /* `export { handler as GET }` — a legitimate way to write a route
         handler, and the only one where the method name never appears on a
         declaration. */
      for (const specifier of decl.specifiers ?? []) {
        const exported = specifier.exported as { type: string, name?: string, value?: string }
        const name = exported.type === 'Identifier' ? exported.name : exported.value
        if (!name || !methods.includes(name)) continue
        const loc = nodeLoc(specifier.exported, parsed.lines)
        found.push({ method: name, line: loc?.line ?? 1 })
      }
    }
  })
  return found
}
