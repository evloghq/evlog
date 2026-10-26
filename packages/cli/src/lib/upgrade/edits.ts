import type { Edit, Span } from './types'

/**
 * Delete `specifier` from an import or export list, with its separating comma.
 * A specifier on a line of its own takes the line with it; the only specifier
 * takes the whole statement and its line break.
 */
export function removeSpecifier(source: string, statement: Span & { specifiers: readonly Span[] }, specifier: Span): Edit {
  if (statement.specifiers.length === 1) {
    const end = source[statement.end] === '\n' ? statement.end + 1 : statement.end
    return { start: statement.start, end, text: '' }
  }
  const lineStart = source.lastIndexOf('\n', specifier.start - 1) + 1
  const ownLine = /^[ \t]*,?[ \t]*\n/.exec(source.slice(specifier.end))
  if (ownLine && source.slice(lineStart, specifier.start).trim() === '') {
    return { start: lineStart, end: specifier.end + ownLine[0].length, text: '' }
  }
  const after = /^\s*,\s*/.exec(source.slice(specifier.end))
  if (after) return { start: specifier.start, end: specifier.end + after[0].length, text: '' }
  const before = /,\s*$/.exec(source.slice(0, specifier.start))!
  return { start: specifier.start - before[0].length, end: specifier.end, text: '' }
}
