import { readFileSync } from 'node:fs'
import type { Node, Program } from 'oxc-parser'
import { parseSource } from '../map/parse'

/**
 * Offset-based edits to an existing config file.
 *
 * Locate the node with oxc, splice text at its offsets, leave every other byte
 * alone. Nothing here reprints the AST — a config that comes back reformatted
 * is a worse outcome than a step the user finishes by hand.
 */
export interface ConfigFile {
  path: string
  source: string
  program: Program
}

type ObjectNode = Node & { type: 'ObjectExpression', properties: Node[] }
type ArrayNode = Node & { type: 'ArrayExpression', elements: (Node | null)[] }

function offsets(node: Node): { start: number, end: number } {
  const anyNode = node as unknown as { start: number, end: number }
  return { start: anyNode.start, end: anyNode.end }
}

/** Parse a config file for editing; `null` when unreadable or unparseable. */
export function readConfig(path: string): ConfigFile | null {
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const parsed = parseSource(path, source)
  if (!parsed || parsed.errors.length > 0) return null
  return { path, source, program: parsed.program }
}

function propertyName(prop: Node): string | null {
  if (prop.type !== 'Property') return null
  const { key } = prop as unknown as { key: Node }
  if (key.type === 'Identifier') return (key as unknown as { name: string }).name
  if (key.type === 'Literal') return String((key as unknown as { value: unknown }).value)
  return null
}

/** The exported object literal, wrapped (`defineNuxtConfig({…})`) or bare. */
export function findConfigObject(program: Program): ObjectNode | null {
  for (const statement of program.body as Node[]) {
    if (statement.type !== 'ExportDefaultDeclaration') continue
    const { declaration } = (statement as unknown as { declaration: Node })
    if (declaration.type === 'ObjectExpression') return declaration as ObjectNode
    if (declaration.type === 'CallExpression') {
      const [argument] = (declaration as unknown as { arguments: Node[] }).arguments
      if (argument?.type === 'ObjectExpression') return argument as ObjectNode
    }
  }
  return null
}

/** Property value on an object literal, by key. */
export function getProperty(object: ObjectNode, name: string): Node | null {
  for (const prop of object.properties) {
    if (propertyName(prop) === name) return (prop as unknown as { value: Node }).value
  }
  return null
}

/** Whether an object literal already declares `name`. */
export function hasProperty(object: ObjectNode, name: string): boolean {
  return object.properties.some(prop => propertyName(prop) === name)
}

/** Whether the file already imports anything from `specifier`. */
export function hasImportFrom(program: Program, specifier: string): boolean {
  return (program.body as Node[]).some((statement) => {
    if (statement.type !== 'ImportDeclaration') return false
    const { source } = (statement as unknown as { source: { value: string } })
    return source.value === specifier
  })
}

/** Textual on purpose: `'evlog/nuxt'` and `evlog({…})` are both "already wired". */
export function arrayMentions(source: string, array: ArrayNode, needle: string): boolean {
  return array.elements.some((element) => {
    if (!element) return false
    const { start, end } = offsets(element)
    return source.slice(start, end).includes(needle)
  })
}

/** Indentation of the line containing `offset`. */
function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1
  const match = source.slice(lineStart, offset).match(/^[\t ]*/)
  return match?.[0] ?? ''
}

/** One unit of indentation, as this file spells it (tabs vs. spaces). */
function indentUnit(source: string): string {
  const match = source.match(/\n([\t ]+)\S/)
  const found = match?.[1] ?? '  '
  return found.startsWith('\t') ? '\t' : ' '.repeat(Math.min(found.length, 4))
}

/** Text to insert at a byte offset — the only edit this module ever makes. */
export interface Splice {
  /** Byte offset in the original source. */
  at: number
  text: string
}

/**
 * Where a new sibling goes after `lastEnd`, and whether a comma is owed.
 *
 * Inserting at the end of the last element puts the new text *before* an
 * existing `,`, which produces `}, ,` — the point has to move past it.
 */
function afterLast(source: string, lastEnd: number, containerEnd: number): { at: number, needsComma: boolean } {
  const between = source.slice(lastEnd, containerEnd - 1)
  const comma = between.indexOf(',')
  const onlyWhitespaceBefore = comma !== -1 && between.slice(0, comma).trim().length === 0
  return onlyWhitespaceBefore
    ? { at: lastEnd + comma + 1, needsComma: false }
    : { at: lastEnd, needsComma: true }
}

/** Apply splices right to left so offsets stay valid; splices that share an offset apply in reverse, so the given order survives. */
export function applySplices(source: string, splices: Splice[]): string {
  return splices
    .map((splice, index) => ({ splice, index }))
    .sort((a, b) => b.splice.at - a.splice.at || b.index - a.index)
    .reduce((text, { splice }) => text.slice(0, splice.at) + splice.text + text.slice(splice.at), source)
}

/** Splice that appends `entry` as the last element of `array`. */
export function appendToArray(source: string, array: ArrayNode, entry: string): Splice {
  const { start, end } = offsets(array)
  const last = array.elements.filter(Boolean).at(-1)

  if (!last) {
    const inner = source.slice(start + 1, end - 1)
    // An array written on one line stays on one line.
    if (!inner.includes('\n')) return { at: end - 1, text: entry }
    const indent = indentAt(source, start) + indentUnit(source)
    return { at: end - 1, text: `${indent}${entry},\n${indentAt(source, start)}` }
  }

  const { at, needsComma } = afterLast(source, offsets(last).end, end)
  const multiline = source.slice(start, end).includes('\n')

  if (!multiline) return { at, text: `${needsComma ? ', ' : ' '}${entry}` }

  const indent = indentAt(source, offsets(last).start)
  return { at, text: `${needsComma ? ',' : ''}\n${indent}${entry}` }
}

/** Splice that appends `key: value` as the last property of `object`. */
export function appendProperty(source: string, object: ObjectNode, text: string): Splice {
  const { start, end } = offsets(object)
  const last = object.properties.at(-1)
  const indent = last ? indentAt(source, offsets(last).start) : indentAt(source, start) + indentUnit(source)

  if (!last) {
    const inner = source.slice(start + 1, end - 1)
    if (inner.trim().length === 0 && !inner.includes('\n')) {
      return { at: end - 1, text: `\n${indent}${text},\n${indentAt(source, start)}` }
    }
    return { at: end - 1, text: `${indent}${text},\n` }
  }

  const { at, needsComma } = afterLast(source, offsets(last).end, end)
  // Exactly one comma: the splice that follows a missing trailing comma owes the separator.
  return { at, text: needsComma ? `,\n${indent}${text}` : `\n${indent}${text},` }
}

/** Splice that adds an import statement after the last existing one. */
export function addImport(source: string, program: Program, statement: string): Splice {
  const imports = (program.body as Node[]).filter(node => node.type === 'ImportDeclaration')
  const last = imports.at(-1)
  if (last) return { at: offsets(last).end, text: `\n${statement}` }
  return { at: 0, text: `${statement}\n` }
}

export type { ArrayNode, ObjectNode }

/** The `createEvlog({ … })` options object — {@link findConfigObject} does not reach it. */
export function findCreateEvlogCall(program: Program): ObjectNode | null {
  let found: ObjectNode | null = null

  const visit = (node: Node): void => {
    if (found || !node || typeof node !== 'object') return

    if (node.type === 'CallExpression') {
      const call = node as unknown as { callee: Node, arguments: Node[] }
      const callee = call.callee as unknown as { type: string, name?: string }
      if (callee.type === 'Identifier' && callee.name === 'createEvlog') {
        const [argument] = call.arguments
        if (argument?.type === 'ObjectExpression') {
          found = argument as ObjectNode
          return
        }
      }
    }

    for (const value of Object.values(node as unknown as Record<string, unknown>)) {
      if (Array.isArray(value)) value.forEach(entry => visit(entry as Node))
      else if (value && typeof value === 'object' && 'type' in value) visit(value as Node)
    }
  }

  visit(program as unknown as Node)
  return found
}

/** Offset just past the last import statement — where a preamble belongs. */
export function importsEnd(source: string, program: Program): number {
  const imports = (program.body as Node[]).filter(node => node.type === 'ImportDeclaration')
  const last = imports.at(-1)
  return last ? offsets(last).end : 0
}
