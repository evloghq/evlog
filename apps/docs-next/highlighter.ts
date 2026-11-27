import type { ElementNode, Node as ComarkNode } from 'comark'
import { defineComarkPlugin } from 'comark'
import { rangiCodeBlocks } from 'comark/plugins/rangi'
import { geistTheme } from './utils/geist'

// Rangi rules: [pattern, token type, sub-rules or a language to tokenize the match with].
// Token types index rangi's TOKENS list.
const DELETED = 0
const VAR = 2
const KWD = 4
const CMNT = 6
const INSERT = 7
const FUNC = 9
const BOOL = 10
const NUM = 11
const OPER = 12
const STR = 13
const BRACKET = 15

const str = [/(["'`])(\\[^]|(?!\1)[^\r\n\\])*\1?/g, STR]
const num = [/\b\d+(\.\d+)?([a-z]+)?\b/g, NUM]
const bracket = [/[{}[\]()]/g, BRACKET]

// Loki's query language: a stream selector, then a pipeline.
const logql = [
  [/#.*/g, CMNT],
  str,
  [/\b(json|logfmt|regexp|pattern|unpack|line_format|label_format|unwrap|drop|keep|decolorize|by|without|offset|bool|on|ignoring|group_left|group_right)\b/g, KWD],
  [/\b[a-z_]+(?=\s*\()/g, FUNC],
  [/\b[a-zA-Z_][\w]*(?=\s*(=~|!~|!=|=|>=|<=|>|<))/g, VAR],
  [/\[\d+[smhdwy]\]/g, NUM],
  num,
  [/\|=|\|~|!=|!~|=~|>=|<=|==|\||[=<>+\-*/%^]/g, OPER],
  bracket,
]

// Kusto, which Axiom's APL follows.
const kusto = [
  [/\/\/.*/g, CMNT],
  str,
  [/\b[a-z_][\w]*(?=\s*\()/g, FUNC],
  [/\b(where|summarize|project|project-away|extend|by|order|sort|take|limit|top|count|distinct|join|on|union|let|as|asc|desc|and|or|not|in|has|has_cs|contains|startswith|endswith|matches|regex|between|parse|mv-expand|render|search)\b/g, KWD],
  [/\b(true|false|null)\b/g, BOOL],
  num,
  [/==|!=|=~|!~|>=|<=|[=<>+\-*/%|]/g, OPER],
  bracket,
]

// A `+` or `-` line keeps its marker colour and the rest is highlighted as code.
const diff = [
  [/^-.*/gm, , [[/^-/g, DELETED], [/(?<=^-).+/g, , 'ts']]],
  [/^\+.*/gm, , [[/^\+/g, INSERT], [/(?<=^\+).+/g, , 'ts']]],
  [/^[ \t].*/gm, , 'ts'],
]

const languages = {
  logql,
  kusto,
  kql: kusto,
  apl: kusto,
  diff,
  patch: diff,
  // Output and diagrams: no colour, where rangi's plain grammar colours quoted strings.
  text: [],
  txt: [],
  plain: [],
}

type Pre = ['pre', Record<string, unknown>, ElementNode]

function isPre(node: ComarkNode): node is Pre {
  return Array.isArray(node) && node[0] === 'pre' && Array.isArray(node[2]) && node[2][0] === 'code'
}

function markerOf(line: ComarkNode[]): 'add' | 'del' | undefined {
  const [first] = line
  const text = typeof first === 'string' ? first : Array.isArray(first) ? first[2] : undefined
  if (typeof text !== 'string') return undefined
  if (text.startsWith('+')) return 'add'
  if (text.startsWith('-')) return 'del'
}

// Rangi leaves a diff's tokens unwrapped, separated by newlines; each line gets a span so it can carry a background.
function wrapDiffLines(pre: Pre) {
  const [, , code] = pre
  const children = code.slice(2) as ComarkNode[]
  if (children.some(child => Array.isArray(child) && String((child[1] as { class?: string })?.class).split(' ').includes('line'))) return
  const lines: ComarkNode[][] = [[]]
  for (const child of children) {
    if (child === '\n') lines.push([])
    else lines.at(-1)!.push(child)
  }
  const wrapped: ComarkNode[] = []
  lines.forEach((line, i) => {
    const marker = markerOf(line)
    const attrs = marker ? { class: `line diff-${marker}` } : { class: 'line', style: 'display: inline' }
    wrapped.push(['span', attrs, ...line] as ComarkNode)
    if (i < lines.length - 1) wrapped.push('\n')
  })
  pre[2] = ['code', code[1], ...wrapped] as ElementNode
}

function visit(node: ComarkNode, fn: (pre: Pre) => void) {
  if (!Array.isArray(node)) return
  if (isPre(node)) return fn(node)
  for (const child of node.slice(2)) visit(child as ComarkNode, fn)
}

export default defineComarkPlugin(() => ({
  name: 'evlog-rangi',
  async post(state) {
    state.tree = await rangiCodeBlocks(state.tree, { theme: geistTheme, languages })
    for (const node of state.tree.nodes) {
      visit(node, (pre) => {
        if (['diff', 'patch'].includes(String(pre[1].language))) wrapDiffLines(pre)
      })
    }
  },
}))()
