import type { Node, Program } from 'oxc-parser'
import { patternNames } from './facts'
import type { ParseResult, SourceRange } from './parse'
import { nodeRange, walkAst } from './parse'

/**
 * The part of a file one entry point runs.
 *
 * A file that declares several entry points is otherwise read whole for each
 * of them, and one instrumented handler vouches for every other one in it.
 */
export interface Reach {
  /** Whether `node` is code the entry point runs. */
  covers: (node: Node) => boolean
  /** Names read in that code: which imports and globals the handler uses. */
  references: ReadonlySet<string>
}

/** What the file declares at its top level, by name: functions, classes and variables. */
function topLevelDeclarations(program: Program): Map<string, SourceRange> {
  const declared = new Map<string, SourceRange>()
  for (const statement of program.body as Node[]) {
    const exported = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
    const node = (exported ? (statement as { declaration?: Node | null }).declaration : statement) ?? statement
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      const { id } = node as { id?: { name: string } | null }
      if (id) declared.set(id.name, nodeRange(node))
    }
    if (node.type !== 'VariableDeclaration') continue
    for (const declarator of (node as { declarations: Node[] }).declarations) {
      for (const name of patternNames((declarator as { id: Node }).id)) declared.set(name, nodeRange(declarator))
    }
  }
  return declared
}

/** Whether an identifier names a property (`a.name`, `{ name: 1 }`) and not a binding. */
function isPropertyName(node: Node, parent: Node | null): boolean {
  if (parent?.type === 'MemberExpression') {
    const member = parent as { property: Node, computed?: boolean }
    return member.property === node && !member.computed
  }
  if (parent?.type === 'Property') {
    const property = parent as { key: Node, computed?: boolean }
    return property.key === node && !property.computed
  }
  return false
}

interface FileIndex {
  declared: Map<string, SourceRange>
  /** Every name the file reads, in source order. */
  identifiers: Array<{ name: string, start: number }>
}

/* One index per parsed file: a file with fifty routes is asked for fifty reaches. */
const indexes = new WeakMap<ParseResult, FileIndex>()

function indexOf(parsed: ParseResult): FileIndex {
  let index = indexes.get(parsed)
  if (!index) {
    const identifiers: FileIndex['identifiers'] = []
    walkAst(parsed.program, (node, parent) => {
      if (node.type !== 'Identifier' || isPropertyName(node, parent)) return
      identifiers.push({ name: node.name, start: nodeRange(node)[0] })
    })
    index = { declared: topLevelDeclarations(parsed.program), identifiers }
    indexes.set(parsed, index)
  }
  return index
}

/**
 * Follow an entry point from where it is written to what it runs in this file.
 *
 * The handler is rarely the whole story: `app.get('/orders', requireUser,
 * listOrders)` names two functions declared elsewhere in the file, and those
 * call helpers of their own. Every top-level declaration the code names is
 * followed, and what that declaration names in turn. Code in another file is
 * out of reach, as it is for a file with a single entry point.
 *
 * @param scope - Where the entry point is written: the route registration, the
 * exported function, the method's handler.
 */
export function handlerReach(parsed: ParseResult, scope: SourceRange): Reach {
  const { declared, identifiers } = indexOf(parsed)

  const ranges: SourceRange[] = [scope]
  const references = new Set<string>()
  /* `ranges` grows while it is read: a declaration joins it the first time
     code already in reach names it. */
  for (const [start, end] of ranges) {
    for (const identifier of identifiers) {
      if (identifier.start < start || identifier.start >= end || references.has(identifier.name)) continue
      references.add(identifier.name)
      const declaration = declared.get(identifier.name)
      if (declaration) ranges.push(declaration)
    }
  }

  return {
    covers: (node) => {
      const [at] = nodeRange(node)
      return ranges.some(([start, end]) => at >= start && at < end)
    },
    references,
  }
}
