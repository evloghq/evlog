import type { VNode, VNodeArrayChildren } from 'vue'

type Children = VNode['children'] | VNodeArrayChildren[number]

/** The text a slot's nodes render, read through the slots of the components among them. */
export function nodeText(nodes: Children): string {
  if (typeof nodes === 'string' || typeof nodes === 'number') return String(nodes)
  if (Array.isArray(nodes)) return nodes.map(nodeText).join('')
  if (!nodes || typeof nodes !== 'object') return ''
  if ('children' in nodes) return nodeText(nodes.children as Children)
  return typeof nodes.default === 'function' ? nodeText(nodes.default()) : ''
}

/**
 * A table's first column names the row. A name stays on one line; a sentence wraps, so it does not
 * take the width the other columns need.
 */
export function isRowName(text: string) {
  return text.trim().length <= 24
}

/**
 * Code is kept on one line, so it never breaks at a slash or a hyphen. Code that is a phrase, long
 * and with spaces, would take a table column's width that way, so in a table it wraps at its spaces.
 */
export function isPhrase(text: string) {
  const code = text.trim()
  return code.length > 24 && code.includes(' ')
}
