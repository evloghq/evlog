import type { Node, ObjectExpression } from 'oxc-parser'
import type { Codemod, Edit } from '../../types'

/** Entry → the option evlog 3 no longer reads on its exports. */
const RENAMED_OPTIONS: Readonly<Record<string, string>> = {
  'evlog/axiom': 'token',
  'evlog/better-stack': 'sourceToken',
}

/** Environment variables evlog 3 no longer reads → the ones it reads instead. */
const RENAMED_ENV: Readonly<Record<string, string>> = {
  AXIOM_TOKEN: 'AXIOM_API_KEY',
  NUXT_AXIOM_TOKEN: 'NUXT_AXIOM_API_KEY',
  BETTER_STACK_SOURCE_TOKEN: 'BETTER_STACK_API_KEY',
  NUXT_BETTER_STACK_SOURCE_TOKEN: 'NUXT_BETTER_STACK_API_KEY',
}

/**
 * The Axiom `token` and Better Stack `sourceToken` options become `apiKey`.
 *
 * - Object literals passed to a function imported from `evlog/axiom` or
 *   `evlog/better-stack` are rewritten. A config built elsewhere is reported,
 *   since its keys cannot be followed.
 * - `evlog: { axiom: { token } }` in a Nuxt config becomes `apiKey`.
 * - The old environment variables are reported, never rewritten: renaming the
 *   read in code without renaming the variable where it is set would drop the key.
 */
export default {
  id: 'v3/credential-aliases-removed',
  needles: [...Object.keys(RENAMED_OPTIONS), 'axiom', ...Object.keys(RENAMED_ENV)],
  create(ctx) {
    const locals = new Map<string, string>()
    const namespaces = new Map<string, string>()
    const calls: Array<{ callee: string, namespace: string | null, args: readonly Node[], at: Node }> = []

    const property = (object: ObjectExpression, key: string) => object.properties.find(entry =>
      entry.type === 'Property' && !entry.computed
      && ((entry.key.type === 'Identifier' && entry.key.name === key) || (entry.key.type === 'Literal' && entry.key.value === key)))

    const rename = (object: ObjectExpression, from: string, label: string) => {
      const entry = property(object, from)
      if (entry?.type !== 'Property') return
      if (property(object, 'apiKey')) {
        ctx.finding(entry, `${label} sets both \`${from}\` and \`apiKey\`: remove \`${from}\``)
        return
      }
      const edit: Edit = entry.shorthand
        ? { start: entry.start, end: entry.end, text: `apiKey: ${from}` }
        : { start: entry.key.start, end: entry.key.end, text: 'apiKey' }
      ctx.finding(entry, `${label}: \`${from}\` → \`apiKey\``, [edit])
    }

    return {
      ImportDeclaration(node) {
        const from = typeof node.source.value === 'string' ? node.source.value : ''
        if (!RENAMED_OPTIONS[from]) return
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') namespaces.set(specifier.local.name, from)
          else if (specifier.type === 'ImportSpecifier') locals.set(specifier.local.name, from)
        }
      },
      CallExpression(node) {
        const { callee } = node
        if (callee.type === 'Identifier') calls.push({ callee: callee.name, namespace: null, args: node.arguments, at: node })
        else if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.property.type === 'Identifier') {
          calls.push({ callee: callee.property.name, namespace: callee.object.name, args: node.arguments, at: node })
        }
      },
      Property(node) {
        if (node.computed || node.key.type !== 'Identifier' || node.key.name !== 'evlog' || node.value.type !== 'ObjectExpression') return
        const axiom = property(node.value, 'axiom')
        if (axiom?.type === 'Property' && axiom.value.type === 'ObjectExpression') rename(axiom.value, 'token', 'evlog.axiom')
      },
      MemberExpression(node) {
        if (node.computed || node.property.type !== 'Identifier') return
        const to = RENAMED_ENV[node.property.name]
        if (to) ctx.finding(node, `${node.property.name} is no longer read: rename the variable to ${to} here and where it is set (.env files, deployment settings)`)
      },
      Literal(node) {
        const to = typeof node.value === 'string' ? RENAMED_ENV[node.value] : undefined
        if (to) ctx.finding(node, `${node.value} is no longer read: rename the variable to ${to} here and where it is set (.env files, deployment settings)`)
      },
      onEnd() {
        for (const call of calls) {
          const entry = call.namespace ? namespaces.get(call.namespace) : locals.get(call.callee)
          if (!entry) continue
          const from = RENAMED_OPTIONS[entry]!
          const label = call.namespace ? `${call.namespace}.${call.callee}()` : `${call.callee}()`
          for (const arg of call.args) {
            if (arg.type === 'ObjectExpression') rename(arg, from, label)
            else if (arg.type === 'Identifier' && call.callee.startsWith('create')) {
              ctx.finding(arg, `${label} takes a config built elsewhere: if it sets \`${from}\`, rename it to \`apiKey\``)
            }
          }
        }
      },
    }
  },
} satisfies Codemod
