import type { ExportSpecifier, IdentifierReference, ImportSpecifier, ModuleExportName, Node } from 'oxc-parser'
import type { Codemod, Edit, Span } from './types'
import { bindingCollector, mergeVisitors } from './visitors'

/** Where a module moved, and which of its exports were renamed on the way. */
export interface ModuleMove {
  to: string
  /** Old export name → new export name. */
  exports?: Readonly<Record<string, string>>
}

/**
 * A codemod that moves imports from one evlog entry to another.
 *
 * Every move is applied against the original source in one pass, so a table
 * that moves `a` to `b` and `b` to `a` swaps them instead of moving one twice.
 *
 * - Static imports, re-exports and `import()` types are rewritten, renamed
 *   exports included.
 * - A non-aliased renamed import is renamed everywhere it is referenced in the
 *   file. When the old or the new name is already bound elsewhere in the file,
 *   the import is aliased instead (`createHttpDrain as createBrowserDrain`) and
 *   the rest of the file is left alone.
 * - A move whose `to` is the module itself only renames exports: the specifier
 *   is kept, and imports that use no renamed export are not reported.
 * - Dynamic `import()`, `require()` and `import.meta.resolve()` are rewritten
 *   when the module has no renamed exports, and reported otherwise: the names
 *   read off the result cannot be followed.
 * - Any other string equal to a moved module is reported.
 */
export function moveModules(id: string, moves: Readonly<Record<string, ModuleMove>>): Codemod {
  const renamedNames = new Set(Object.values(moves).flatMap(move => Object.keys(move.exports ?? {})))

  return {
    id,
    needles: Object.keys(moves),
    create(ctx) {
      const consumed = new Set<number>()
      const declared = new Set<string>()
      const imported = new Set<string>()
      const namespaces = new Map<string, Readonly<Record<string, string>>>()
      const references: Array<{ node: IdentifierReference, parent: Node | null }> = []
      const localExports: ExportSpecifier[] = []
      const pending: Array<{ at: Span, message: string, edits: Edit[], renames: Array<{ specifier: ImportSpecifier, from: string, to: string }> }> = []

      const retarget = (literal: Span, from: string, to: string): Edit[] => {
        consumed.add(literal.start)
        return from === to ? [] : [{ start: literal.start + 1, end: literal.end - 1, text: to }]
      }
      const moveOf = (node: Node | null | undefined): { literal: Span, from: string, move: ModuleMove } | null => {
        if (node?.type !== 'Literal' || typeof node.value !== 'string') return null
        const move = moves[node.value]
        return move ? { literal: node, from: node.value, move } : null
      }
      const describe = (from: string, move: ModuleMove, renamed: readonly string[]) =>
        [...(from === move.to ? [] : [`${from} → ${move.to}`]), ...renamed.map(name => `${name} → ${move.exports?.[name]}`)].join(', ')
      const dynamic = ({ literal, from, move }: { literal: Span, from: string, move: ModuleMove }) => {
        if (from === move.to) {
          consumed.add(literal.start)
          return
        }
        if (move.exports) {
          consumed.add(literal.start)
          ctx.finding(literal, `${from} moved to ${move.to} with renamed exports (${describe(from, move, Object.keys(move.exports))}): update this dynamic import by hand`)
          return
        }
        ctx.finding(literal, describe(from, move, []), retarget(literal, from, move.to))
      }
      return mergeVisitors([
        bindingCollector(declared), {
          ImportDeclaration(node) {
            for (const specifier of node.specifiers) imported.add(specifier.local.name)
            const found = moveOf(node.source)
            if (!found) return
            const { literal, from, move } = found
            const edits = retarget(literal, from, move.to)
            const renames: Array<{ specifier: ImportSpecifier, from: string, to: string }> = []
            const renamed: string[] = []
            for (const specifier of node.specifiers) {
              if (specifier.type === 'ImportNamespaceSpecifier' && move.exports) namespaces.set(specifier.local.name, move.exports)
              if (specifier.type !== 'ImportSpecifier') continue
              const name = exportName(specifier.imported)
              const to = move.exports?.[name]
              if (!to) continue
              renamed.push(name)
              if (specifier.local.start === specifier.imported.start) renames.push({ specifier, from: name, to })
              else edits.push({ start: specifier.imported.start, end: specifier.imported.end, text: to })
            }
            pending.push({ at: node, message: describe(from, move, renamed), edits, renames })
          },
          MemberExpression(node) {
            if (node.computed || node.object.type !== 'Identifier' || node.property.type !== 'Identifier') return
            const to = namespaces.get(node.object.name)?.[node.property.name]
            if (to) ctx.finding(node, `${node.object.name}.${node.property.name} → ${node.object.name}.${to}`, [{ start: node.property.start, end: node.property.end, text: to }])
          },
          ExportNamedDeclaration(node) {
            const found = moveOf(node.source)
            if (!found) {
              if (!node.source) localExports.push(...node.specifiers)
              return
            }
            const { literal, from, move } = found
            const edits = retarget(literal, from, move.to)
            const renamed: string[] = []
            for (const specifier of node.specifiers) {
              const name = exportName(specifier.local)
              const to = move.exports?.[name]
              if (!to) continue
              renamed.push(name)
              const keepsName = specifier.local.start === specifier.exported.start
              edits.push({ start: specifier.local.start, end: specifier.local.end, text: keepsName ? `${to} as ${name}` : to })
            }
            if (edits.length > 0) ctx.finding(node, describe(from, move, renamed), edits)
          },
          ExportAllDeclaration(node) {
            const found = moveOf(node.source)
            if (!found) return
            const { literal, from, move } = found
            if (move.exports) {
              consumed.add(literal.start)
              ctx.finding(node, `re-exports everything from ${from}, which moved to ${move.to} with renamed exports (${describe(from, move, Object.keys(move.exports))}): this changes what the file exports, so update it by hand`)
              return
            }
            const edits = retarget(literal, from, move.to)
            if (edits.length > 0) ctx.finding(node, describe(from, move, []), edits)
          },
          TSImportType(node) {
            const found = moveOf(node.source)
            if (!found) return
            const { literal, from, move } = found
            const edits = retarget(literal, from, move.to)
            const qualifier = node.qualifier?.type === 'Identifier' ? node.qualifier : null
            const to = qualifier ? move.exports?.[qualifier.name] : undefined
            if (qualifier && to) edits.push({ start: qualifier.start, end: qualifier.end, text: to })
            if (edits.length > 0) ctx.finding(node, describe(from, move, qualifier && to ? [qualifier.name] : []), edits)
          },
          ImportExpression(node) {
            const found = moveOf(node.source)
            if (found) dynamic(found)
          },
          CallExpression(node) {
            const { callee } = node
            const resolves = (callee.type === 'Identifier' && callee.name === 'require')
            || (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'resolve'
              && ((callee.object.type === 'Identifier' && callee.object.name === 'require') || callee.object.type === 'MetaProperty'))
            const found = resolves ? moveOf(node.arguments[0]) : null
            if (found) dynamic(found)
          },
          Literal(node) {
            if (typeof node.value !== 'string' || consumed.has(node.start) || !moves[node.value] || moves[node.value]!.to === node.value) return
            ctx.finding(node, `"${node.value}" appears in a string, not an import: check whether it should become "${moves[node.value]!.to}"`)
          },
          Identifier(node, parent) {
            if (renamedNames.has(node.name)) references.push({ node: node as IdentifierReference, parent })
          },
          onEnd() {
            const edited = new Set<number>()
            const once = (edit: Edit, into: Edit[]) => {
              if (edited.has(edit.start)) return
              edited.add(edit.start)
              into.push(edit)
            }
            for (const entry of pending) {
              for (const { specifier, from, to } of entry.renames) {
                if (declared.has(from) || declared.has(to) || imported.has(to)) {
                  entry.edits.push({ start: specifier.imported.start, end: specifier.imported.end, text: `${to} as ${from}` })
                  continue
                }
                entry.edits.push({ start: specifier.imported.start, end: specifier.imported.end, text: to })
                for (const { node, parent } of references) {
                  if (node.name !== from) continue
                  const text = referenceText(node, parent, from, to)
                  if (text !== null) once({ start: node.start, end: node.end, text }, entry.edits)
                }
                for (const specifierOut of localExports) {
                  if (exportName(specifierOut.local) !== from) continue
                  const keepsName = specifierOut.local.start === specifierOut.exported.start
                  once({ start: specifierOut.local.start, end: specifierOut.local.end, text: keepsName ? `${to} as ${from}` : to }, entry.edits)
                }
              }
              if (entry.edits.length > 0) ctx.finding(entry.at, entry.message, entry.edits)
            }
          },
        }
      ])
    },
  }
}

function exportName(name: ModuleExportName): string {
  return name.type === 'Literal' ? name.value : name.name
}

/**
 * What a reference to a renamed import becomes, or `null` when the identifier
 * is not a reference to it (a property name, a key, a label).
 */
export function referenceText(node: IdentifierReference, parent: Node | null, from: string, to: string): string | null {
  if (!parent) return to
  switch (parent.type) {
    case 'MemberExpression':
      return parent.property === node && !parent.computed ? null : to
    case 'Property':
      if (parent.shorthand) return parent.value === node ? `${from}: ${to}` : null
      return parent.key === node && !parent.computed ? null : to
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'TSPropertySignature':
    case 'TSMethodSignature':
      return parent.key === node && !parent.computed ? null : to
    case 'TSQualifiedName':
      return parent.right === node ? null : to
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'TSImportType':
      return null
    default:
      return to
  }
}
