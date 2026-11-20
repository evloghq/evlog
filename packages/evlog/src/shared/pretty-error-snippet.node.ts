import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CodeSnippetLine } from './stack-frames'
import { decodeFileUrl } from './stack-frames'

/**
 * Read source lines around a stack frame from disk (Node.js only).
 */
export function readCodeSnippetFromDisk(
  file: string,
  line: number,
  contextLines = 2,
): CodeSnippetLine[] | null {
  const decoded = decodeFileUrl(file)
  let content: string
  try {
    content = readFileSync(decoded, 'utf8')
  } catch {
    try {
      content = readFileSync(resolve(process.cwd(), decoded), 'utf8')
    } catch {
      return null
    }
  }

  const lines = content.split('\n')
  const start = Math.max(0, line - contextLines - 1)
  const end = Math.min(lines.length, line + contextLines)
  const snippet: CodeSnippetLine[] = []

  for (let i = start; i < end; i++) {
    snippet.push({
      line: i + 1,
      content: lines[i] ?? '',
      isErrorLine: i + 1 === line,
    })
  }

  return snippet.length > 0 ? snippet : null
}
