import type { CallExpression, IdentifierReference, ImportDeclaration, ImportSpecifier, Node, ObjectExpression } from 'oxc-parser'
import { moveModules, referenceText } from '../../rename-modules'
import type { Codemod, CodemodContext, Edit, Span } from '../../types'
import { bindingCollector, mergeVisitors } from '../../visitors'

const ID = 'v3/posthog-events-drain-removed'
const MODULE = 'evlog/posthog'
const REMOVED = 'createPostHogEventsDrain'
const REPLACEMENT = 'createPostHogDrain'
const MODE = `mode: 'events'`

/** `PostHogEventsConfig` was an alias of `PostHogConfig`, so the type is a plain rename. */
const types = moveModules(ID, { [MODULE]: { to: MODULE, exports: { PostHogEventsConfig: 'PostHogConfig' } } })

/**
 * `createPostHogEventsDrain(options)` becomes `createPostHogDrain({ mode: 'events', ...options })`,
 * which is what the 2.x function returned.
 *
 * A binding is rewritten only when every use of it is a call. Passing the
 * function as a value or re-exporting it would silently switch it to logs
 * mode, so those are reported and the binding is left alone.
 */
export default {
  id: ID,
  needles: [REMOVED, 'PostHogEventsConfig'],
  create(ctx) {
    const declared = new Set<string>()
    const imported = new Set<string>()
    const specifiers: Array<{ declaration: ImportDeclaration, specifier: ImportSpecifier }> = []
    const namespaces = new Set<string>()
    let replacementLocal: string | undefined
    const references: Array<{ node: IdentifierReference, parent: Node | null }> = []
    const memberCalls: Array<{ property: Span, call: CallExpression | null, at: Node }> = []

    return mergeVisitors([
      types.create(ctx), bindingCollector(declared), {
        ImportDeclaration(node) {
          for (const specifier of node.specifiers) imported.add(specifier.local.name)
          if (node.source.value !== MODULE) return
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name)
            if (specifier.type !== 'ImportSpecifier') continue
            const name = specifier.imported.type === 'Literal' ? specifier.imported.value : specifier.imported.name
            if (name === REMOVED) specifiers.push({ declaration: node, specifier })
            if (name === REPLACEMENT) replacementLocal = specifier.local.name
          }
        },
        ExportNamedDeclaration(node) {
          if (node.source?.value !== MODULE) return
          for (const specifier of node.specifiers) {
            const name = specifier.local.type === 'Literal' ? specifier.local.value : specifier.local.name
            if (name === REMOVED) ctx.finding(specifier, `re-exports ${REMOVED}, which is removed: export ${REPLACEMENT} and pass \`${MODE}\` where it is called`)
          }
        },
        Identifier(node, parent) {
          references.push({ node: node as IdentifierReference, parent })
        },
        MemberExpression(node, parent) {
          if (node.computed || node.object.type !== 'Identifier' || node.property.type !== 'Identifier' || node.property.name !== REMOVED) return
          const call = parent?.type === 'CallExpression' && parent.callee === node ? parent : null
          if (namespaces.has(node.object.name)) memberCalls.push({ property: node.property, call, at: node })
        },
        onEnd() {
          for (const { property, call, at } of memberCalls) {
            if (!call) {
              ctx.finding(at, `${REMOVED} is removed and used here as a value: call ${REPLACEMENT}({ ${MODE} }) instead`)
              continue
            }
            const args = modeArgument(ctx, call)
            if (args) ctx.finding(call, `${REMOVED}() → ${REPLACEMENT}({ ${MODE} })`, [{ ...property, text: REPLACEMENT }, ...args])
          }

          for (const { declaration, specifier } of specifiers) {
            const local = specifier.local.name
            if (declared.has(local)) {
              ctx.finding(specifier, `${REMOVED} is removed, and \`${local}\` is also declared in this file: switch to ${REPLACEMENT}({ ${MODE} }) by hand`)
              continue
            }
            const calls: CallExpression[] = []
            const values: Node[] = []
            // `export { name }` visits `local` and `exported`, which share a span.
            const seen = new Set<number>([specifier.local.start])
            for (const { node, parent } of references) {
              if (node.name !== local || seen.has(node.start)) continue
              seen.add(node.start)
              if (parent?.type === 'CallExpression' && parent.callee === node) calls.push(parent)
              else if (parent?.type === 'ExportSpecifier' || referenceText(node, parent, local, local) !== null) values.push(node)
            }
            if (values.length > 0) {
              for (const value of values) ctx.finding(value, `${REMOVED} is removed and used here as a value or export: switch it to ${REPLACEMENT}({ ${MODE} }) by hand`)
              continue
            }
            const argEdits = calls.map(call => modeArgument(ctx, call))
            if (argEdits.some(edits => edits === null)) continue

            const aliased = specifier.local.start !== specifier.imported.start
            const edits: Edit[] = argEdits.flat() as Edit[]
            let callee = local
            if (aliased) {
              edits.push({ ...span(specifier.imported), text: REPLACEMENT })
            } else if (replacementLocal) {
              edits.push(removeSpecifier(ctx.source, declaration, specifier))
              callee = replacementLocal
            } else if (declared.has(REPLACEMENT) || imported.has(REPLACEMENT)) {
              edits.push({ ...span(specifier.imported), text: `${REPLACEMENT} as ${local}` })
            } else {
              edits.push({ ...span(specifier.imported), text: REPLACEMENT })
              callee = REPLACEMENT
            }
            if (callee !== local) for (const call of calls) edits.push({ ...span(call.callee), text: callee })
            ctx.finding(specifier, `${REMOVED}() → ${REPLACEMENT}({ ${MODE} })${calls.length === 1 ? '' : `, ${calls.length} calls`}`, edits)
          }
        },
      }
    ])
  },
} satisfies Codemod

function span(node: Span): Span {
  return { start: node.start, end: node.end }
}

/**
 * The edits that make `call`'s options carry `mode: 'events'`, keeping
 * anything a spread could set below it, as the 2.x function did. `null` when
 * the call cannot be rewritten, after reporting it.
 */
function modeArgument(ctx: CodemodContext, call: CallExpression): Edit[] | null {
  const [options] = call.arguments
  if (!options) return [{ start: call.end - 1, end: call.end - 1, text: `{ ${MODE} }` }]
  if (options.type === 'SpreadElement') {
    ctx.finding(call, `${REMOVED} is called with spread arguments: call ${REPLACEMENT}({ ${MODE}, ... }) by hand`)
    return null
  }
  if (options.type !== 'ObjectExpression') {
    return [{ start: options.start, end: options.start, text: '{ ...' }, { start: options.end, end: options.end, text: `, ${MODE} }` }]
  }
  return objectWithMode(ctx.source, options)
}

function objectWithMode(source: string, object: ObjectExpression): Edit[] {
  const mode = object.properties.find(property => property.type === 'Property' && !property.computed
    && ((property.key.type === 'Identifier' && property.key.name === 'mode') || (property.key.type === 'Literal' && property.key.value === 'mode')))
  if (mode?.type === 'Property') {
    return mode.value.type === 'Literal' && mode.value.value === 'events' ? [] : [{ ...span(mode.value), text: `'events'` }]
  }
  const [first] = object.properties
  const last = object.properties.at(-1)
  if (!first || !last) return [{ ...span(object), text: `{ ${MODE} }` }]
  const multiline = source.slice(object.start, object.end).includes('\n')
  const indent = (property: Span) => source.slice(source.lastIndexOf('\n', property.start) + 1, property.start)
  // After a spread, so the spread cannot switch the mode back, as `{ ...options, mode }` did in 2.x.
  if (object.properties.some(property => property.type === 'SpreadElement')) {
    return [{ start: last.end, end: last.end, text: multiline ? `,\n${indent(last)}${MODE}` : `, ${MODE}` }]
  }
  return [{ start: first.start, end: first.start, text: multiline ? `${MODE},\n${indent(first)}` : `${MODE}, ` }]
}

/** Delete `specifier` and its separating comma, or the whole declaration when it is the only one. */
function removeSpecifier(source: string, declaration: ImportDeclaration, specifier: ImportSpecifier): Edit {
  if (declaration.specifiers.length === 1) {
    const end = source[declaration.end] === '\n' ? declaration.end + 1 : declaration.end
    return { start: declaration.start, end, text: '' }
  }
  const after = /^\s*,\s*/.exec(source.slice(specifier.end))
  if (after) return { start: specifier.start, end: specifier.end + after[0].length, text: '' }
  const before = /,\s*$/.exec(source.slice(0, specifier.start))!
  return { start: specifier.start - before[0].length, end: specifier.end, text: '' }
}
