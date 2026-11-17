import { isBrowser, isDev } from '../utils'

/** @internal Server-only snippet reader registered by Nitro plugin or initLogger. */
type SnippetReader = (file: string, line: number, contextLines?: number) => CodeSnippetLine[] | null

let snippetReader: SnippetReader | null = null

/**
 * Register a disk-backed snippet reader (Node.js integrations only).
 * @internal
 */
export function registerPrettyErrorSnippetReader(reader: SnippetReader | null): void {
  snippetReader = reader
}

/** Parsed V8 stack frame. */
export interface StackFrame {
  raw: string
  file?: string
  line?: number
  column?: number
  fn?: string
  /** True for application source (not node_modules / build output). */
  isApp: boolean
}

export interface CodeSnippetLine {
  line: number
  content: string
  isErrorLine: boolean
}

const SKIP_PATH_RE = /(?:^|[/\\])(?:node_modules|\.nuxt|\.next|\.output)(?:[/\\]|$)/
const SKIP_FRAME_PATH_RE = /(?:^|[/\\])(?:packages[/\\]evlog|evlog[/\\](?:dist|src))(?:[/\\]|$)/
const SKIP_FRAME_FN_RE = /^(?:createError|EvlogError|new EvlogError)$/

/** Decode a `file://` URL or path for display and snippet lookup. */
export function decodeFileUrl(file: string): string {
  if (file.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(file).pathname)
    } catch {
      return file.slice('file://'.length)
    }
  }
  return file
}

function isAppPath(file: string): boolean {
  const normalized = decodeFileUrl(file).replace(/\\/g, '/')
  if (normalized.startsWith('node:')) return false
  if (SKIP_PATH_RE.test(normalized)) return false
  if (isFrameworkRuntimePath(normalized)) return false
  return true
}

/**
 * Compact a stack trace for wide-event storage (drains, NDJSON).
 * Drops node_modules, build output, and evlog internals; keeps up to five useful frames.
 * Returns the stack unchanged when no app frame survives the filter.
 */
export function compactStackForStorage(stack: string | undefined, maxFrames = 5): string | undefined {
  if (!stack) return undefined

  const head = stack.split('\n')[0] ?? ''
  const frames = parseStackFrames(stack)
  const useful = frames.filter(f => f.file && f.line && f.isApp && !isInternalErrorFrame(f)).slice(0, maxFrames)

  if (useful.length === 0) return stack

  return [head, ...useful.map(f => f.raw)].join('\n')
}

/** `file:line:column`, the end of a frame line. */
const FRAME_LOCATION = /^(.+):(\d+):(\d+)$/

/**
 * Parse a V8 stack trace string into frames.
 */
export function parseStackFrames(stack: string | undefined): StackFrame[] {
  if (!stack) return []

  const lines = stack.split('\n')
  const frames: StackFrame[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('at ')) continue

    // The name ends at the first ` (`, found with indexOf: a lazy name group before a greedy
    // path group backtracks quadratically on a line that repeats ` (`, which an error message can carry.
    const open = trimmed.indexOf(' (', 4)
    const withFn = open !== -1 && trimmed.endsWith(')')
      ? trimmed.slice(open + 2, -1).match(FRAME_LOCATION)
      : null
    if (withFn) {
      const [, file, lineStr, colStr] = withFn
      frames.push({
        raw: trimmed,
        fn: trimmed.slice(3, open),
        file,
        line: Number(lineStr),
        column: Number(colStr),
        isApp: isAppPath(file!),
      })
      continue
    }

    const withoutFn = trimmed.slice(3).match(FRAME_LOCATION)
    if (withoutFn) {
      const [, file, lineStr, colStr] = withoutFn
      frames.push({
        raw: trimmed,
        file,
        line: Number(lineStr),
        column: Number(colStr),
        isApp: isAppPath(file!),
      })
    }
  }

  return frames
}

/** True for Next.js runtime internals (route-modules, next/dist, bundled next-server). */
export function isFrameworkRuntimePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return normalized.includes('route-modules/')
    || normalized.includes('webpack://next/')
    || normalized.includes('/next/dist/')
    || normalized.includes('/compiled/next-server/')
}

function isFrameworkRuntimeFrame(frame: StackFrame): boolean {
  if (!frame.file) return false
  return isFrameworkRuntimePath(decodeFileUrl(frame.file))
}

export function isInternalErrorFrame(frame: StackFrame): boolean {
  if (isFrameworkRuntimeFrame(frame)) return true
  if (frame.fn) {
    const fn = frame.fn.replace(/^async /, '')
    if (SKIP_FRAME_FN_RE.test(fn)) return true
  }
  if (!frame.file) return true
  const path = decodeFileUrl(frame.file).replace(/\\/g, '/')
  if (SKIP_FRAME_PATH_RE.test(path)) return true
  if (path.includes('.nuxt/')) return true
  if (path.includes('.next/')) return true
  return false
}

/**
 * Read source lines around a stack frame when a server snippet reader is registered.
 */
export function readCodeSnippet(
  file: string,
  line: number,
  contextLines = 2,
): CodeSnippetLine[] | null {
  if (!isDev() || isBrowser() || !snippetReader) return null
  const path = decodeFileUrl(file).replace(/\\/g, '/')
  if (path.includes('.next/') || path.includes('.nuxt/') || path.includes('.output/')) return null
  return snippetReader(file, line, contextLines)
}
