import type { ExportNamedDeclaration, ExportSpecifier, ImportDeclaration, ImportSpecifier, ModuleExportName, Node } from 'oxc-parser'
import { removeSpecifier } from '../../edits'
import type { Codemod, Edit, Span } from '../../types'

const ID = 'v3/logger-storage-moved'
const FROM = 'evlog/toolkit'
const TO = 'evlog/toolkit/storage'
const NAME = 'createLoggerStorage'
const MOVED = `${NAME}: ${FROM} → ${TO}`

type Statement = ImportDeclaration | ExportNamedDeclaration
type Specifier = ImportSpecifier | ExportSpecifier

/**
 * `createLoggerStorage` is exported from `evlog/toolkit/storage` only.
 *
 * - An import or re-export of it from `evlog/toolkit` is retargeted when it is
 *   the only name. Otherwise the name moves to an existing statement from
 *   `evlog/toolkit/storage`, or to a new one right below.
 * - `import('evlog/toolkit').createLoggerStorage` types are retargeted.
 * - A namespace read, a dynamic import or `require()` in a file that uses the
 *   name, and `export *` from `evlog/toolkit`, are reported.
 */
export default {
  id: ID,
  needles: [NAME, `'${FROM}'`, `"${FROM}"`],
  create(ctx) {
    const { source } = ctx
    const moving = new Map<Statement, Specifier[]>()
    const targets = new Map<string, Statement>()
    const namespaces = new Set<string>()

    const keyword = (statement: Statement) => statement.type === 'ImportDeclaration'
      ? (statement.importKind === 'type' ? 'import type' : 'import')
      : (statement.exportKind === 'type' ? 'export type' : 'export')
    const named = (statement: Statement): readonly Specifier[] => statement.type === 'ImportDeclaration'
      ? statement.specifiers.filter((specifier): specifier is ImportSpecifier => specifier.type === 'ImportSpecifier')
      : statement.specifiers
    const nameOf = (specifier: Specifier) => exportName(specifier.type === 'ImportSpecifier' ? specifier.imported : specifier.local)
    const localOf = (specifier: Specifier) => specifier.type === 'ImportSpecifier' ? specifier.local.name : exportName(specifier.exported)
    const retarget = (literal: Span): Edit => ({ start: literal.start + 1, end: literal.end - 1, text: TO })

    const statement = (node: Statement) => {
      if (!node.source) return
      if (node.source.value === TO) {
        if (named(node).length > 0) targets.set(keyword(node), node)
        return
      }
      if (node.source.value !== FROM) return
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name)
        if (specifier.type !== 'ImportDefaultSpecifier' && specifier.type !== 'ImportNamespaceSpecifier' && nameOf(specifier) === NAME) {
          moving.set(node, [...(moving.get(node) ?? []), specifier])
        }
      }
    }

    return {
      ImportDeclaration: statement,
      ExportNamedDeclaration: statement,
      ExportAllDeclaration(node) {
        if (node.source.value !== FROM) return
        ctx.finding(node, `re-exports everything from ${FROM}, which no longer includes ${NAME}: add \`export { ${NAME} } from '${TO}'\` if consumers need it`)
      },
      TSImportType(node) {
        const literal = node.source as Node
        if (literal.type !== 'Literal' || literal.value !== FROM) return
        if (node.qualifier?.type === 'Identifier' && node.qualifier.name === NAME) ctx.finding(node, MOVED, [retarget(literal)])
      },
      MemberExpression(node) {
        if (node.computed || node.object.type !== 'Identifier' || !namespaces.has(node.object.name) || node.property.name !== NAME) return
        ctx.finding(node, `${NAME} is no longer exported from ${FROM}: import it from ${TO}`)
      },
      ImportExpression(node) {
        if (isModule(node.source) && source.includes(NAME)) ctx.finding(node, `${NAME} is no longer exported from ${FROM}: if this import reads it, import ${TO} instead`)
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require' || !isModule(node.arguments[0]) || !source.includes(NAME)) return
        ctx.finding(node, `${NAME} is no longer exported from ${FROM}: if this require reads it, require ${TO} instead`)
      },
      onEnd() {
        for (const [node, specifiers] of moving) {
          const all = named(node)
          if (specifiers.length === all.length && node.specifiers.length === all.length) {
            ctx.finding(node, MOVED, [retarget(node.source!)])
            continue
          }
          if (specifiers.length > 1) {
            ctx.finding(node, `${NAME} is listed more than once: move it to ${TO} by hand`)
            continue
          }
          const specifier = specifiers[0]!
          const edits = [removeSpecifier(source, node, specifier)]
          const target = targets.get(keyword(node))
          if (target?.source && named(target).some(existing => localOf(existing) === localOf(specifier))) {
            ctx.finding(specifier, MOVED, edits)
            continue
          }
          const text = source.slice(specifier.start, specifier.end)
          if (target) {
            const last = named(target).at(-1)!
            edits.push({ start: last.end, end: last.end, text: `, ${text}` })
          } else {
            const quote = source[node.source!.start]
            const semicolon = source[node.end - 1] === ';' ? ';' : ''
            edits.push({ start: node.end, end: node.end, text: `\n${keyword(node)} { ${text} } from ${quote}${TO}${quote}${semicolon}` })
          }
          ctx.finding(specifier, MOVED, edits)
        }
      },
    }
  },
} satisfies Codemod

function isModule(node: Node | null | undefined): boolean {
  return node?.type === 'Literal' && node.value === FROM
}

function exportName(name: ModuleExportName): string {
  return name.type === 'Literal' ? name.value : name.name
}
