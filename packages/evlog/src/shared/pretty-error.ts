import { colors, escapeControlChars, isBrowser, isDev } from '../utils'
import type { ResolvedPrettyError } from './dev-terminal'
import type { CodeSnippetLine, StackFrame } from './stack-frames'
import { decodeFileUrl, isInternalErrorFrame, parseStackFrames, readCodeSnippet } from './stack-frames'

/** Pretty-print tree node for error sections. */
export interface PrettyErrorTreeEntry {
  key: string
  value: string
  /** Optional ANSI color for the value (server only). */
  valueColor?: string
  children?: string[]
}

export interface NormalizedErrorContext {
  message: string
  name?: string
  code?: string
  why?: string
  fix?: string
  link?: string
  status?: number
  stack?: string
  cause?: string
}

export type PrettyErrorOptions = Partial<ResolvedPrettyError> & {
  /** Project root for relative paths in snippets. @default process.cwd() */
  cwd?: string
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key]
  return typeof val === 'string' && val.length > 0 ? val : undefined
}

function pickNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const val = obj[key]
  return typeof val === 'number' ? val : undefined
}

function extractGuidance(data: Record<string, unknown>): Pick<NormalizedErrorContext, 'code' | 'why' | 'fix' | 'link'> {
  return {
    code: pickString(data, 'code'),
    why: pickString(data, 'why'),
    fix: pickString(data, 'fix'),
    link: pickString(data, 'link'),
  }
}

export function normalizeErrorContext(error: unknown): NormalizedErrorContext | null {
  if (error === null || error === undefined) return null

  if (typeof error === 'string') {
    return { message: error }
  }

  if (!isPlainObject(error)) {
    return { message: String(error) }
  }

  const message = pickString(error, 'message')
    ?? pickString(error, 'statusText')
    ?? pickString(error, 'statusMessage')
    ?? 'Unknown error'

  const result: NormalizedErrorContext = {
    message,
    name: pickString(error, 'name'),
    code: pickString(error, 'code'),
    why: pickString(error, 'why'),
    fix: pickString(error, 'fix'),
    link: pickString(error, 'link'),
    status: pickNumber(error, 'status') ?? pickNumber(error, 'statusCode'),
    stack: pickString(error, 'stack'),
  }

  const { data, cause } = error
  if (isPlainObject(data)) {
    const guidance = extractGuidance(data)
    if (!result.code) result.code = guidance.code
    if (!result.why) result.why = guidance.why
    if (!result.fix) result.fix = guidance.fix
    if (!result.link) result.link = guidance.link
  }

  if (cause instanceof Error) {
    result.cause = cause.message
  } else if (isPlainObject(cause) && pickString(cause, 'message')) {
    result.cause = pickString(cause, 'message')
  }

  return result
}

function formatDisplayPath(file: string, cwd: string): string {
  const decoded = decodeFileUrl(file).replace(/\\/g, '/')
  const cwdNorm = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  if (cwdNorm && decoded.startsWith(`${cwdNorm}/`)) {
    const rel = decoded.slice(cwdNorm.length + 1)
    return rel.startsWith('./') ? rel.slice(2) : rel
  }
  const serverIdx = decoded.indexOf('/server/')
  if (serverIdx >= 0) return decoded.slice(serverIdx + 1)
  const srcIdx = decoded.indexOf('/src/')
  if (srcIdx >= 0) return decoded.slice(srcIdx + 1)
  return decoded
}

/**
 * Pick the most useful frame for code snippets (topmost app throw site).
 */
export function pickPrimaryFrame(frames: StackFrame[]): StackFrame | undefined {
  for (const frame of frames) {
    if (frame.isApp && frame.file && frame.line && !isInternalErrorFrame(frame)) {
      return frame
    }
  }
  return undefined
}

function formatSnippetLines(snippet: CodeSnippetLine[]): string[] {
  const width = String(snippet[snippet.length - 1]?.line ?? 0).length
  return snippet.map(({ line, content, isErrorLine }) => {
    const marker = isErrorLine ? `${colors.red}❯${colors.reset}` : ' '
    const numColor = isErrorLine ? colors.red : colors.gray
    const trimmed = content.length > 120 ? `${content.slice(0, 117)}…` : content
    return `${marker} ${numColor}${String(line).padStart(width, ' ')}${colors.reset} ${colors.dim}┃${colors.reset} ${colors.dim}${trimmed}${colors.reset}`
  })
}

function formatFrameLocation(frame: StackFrame, cwd: string): string {
  const file = frame.file ? formatDisplayPath(frame.file, cwd) : 'unknown'
  const loc = frame.line ? `${file}:${frame.line}` : file
  const fn = frame.fn && frame.fn !== '<unknown>' ? frame.fn : undefined
  return fn ? `at ${fn} (${loc})` : `at ${loc}`
}

function formatCollapsedFrame(frame: StackFrame, cwd: string): string {
  const file = frame.file ? formatDisplayPath(frame.file, cwd) : 'unknown'
  const loc = frame.line ? `${file}:${frame.line}` : file
  const prefix = frame.fn?.startsWith('async') ? 'at async ' : 'at '
  const fn = frame.fn?.replace(/^async /, '')
  if (fn && fn !== '<unknown>' && fn !== loc) {
    return `${prefix}${fn} (${loc})`
  }
  return `${prefix}${loc}`
}

const GUIDANCE_WRAP_WIDTH = 76
const GUIDANCE_CONTINUATION = '     '

/** Wrap guidance text with hanging indent for long Why/Fix lines. */
function formatGuidanceLine(label: string, text: string, labelColor: string): string[] {
  const prefix = `${labelColor}${label}:${colors.reset} `
  const lines: string[] = []
  let remaining = text.trim()
  let first = true

  while (remaining.length > 0) {
    const budget = first
      ? Math.max(24, GUIDANCE_WRAP_WIDTH - prefix.length)
      : Math.max(24, GUIDANCE_WRAP_WIDTH - GUIDANCE_CONTINUATION.length)
    if (remaining.length <= budget) {
      lines.push(first ? `${prefix}${remaining}` : `${GUIDANCE_CONTINUATION}${remaining}`)
      break
    }
    let split = remaining.lastIndexOf(' ', budget)
    if (split <= 0) split = budget
    const chunk = remaining.slice(0, split).trimEnd()
    lines.push(first ? `${prefix}${chunk}` : `${GUIDANCE_CONTINUATION}${chunk}`)
    remaining = remaining.slice(split).trimStart()
    first = false
  }

  return lines
}

export function buildErrorEntries(
  error: unknown,
  options: PrettyErrorOptions = {},
): PrettyErrorTreeEntry[] {
  const normalized = normalizeErrorContext(error)
  if (!normalized) return []
  // Frames are parsed and snippets read from the raw stack; only printed text is escaped.
  const printable = isBrowser() ? (text: string) => text : escapeControlChars

  const cwd = options.cwd ?? (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.')
  const compact = options.compact ?? isDev()
  const detail = options.detail ?? 'full'
  const guidanceOnly = detail === 'guidance'
  const showFrames = !guidanceOnly && !isBrowser() && (options.snippet ?? isDev())
  const stackDepth = guidanceOnly
    ? 0
    : (options.stackDepth ?? (compact ? 2 : 3))
  const snippetContextLines = compact ? 1 : 2

  const children: string[] = []
  const frames = guidanceOnly ? [] : parseStackFrames(normalized.stack)
  const primary = guidanceOnly ? undefined : pickPrimaryFrame(frames)

  // A snippet line opens with a two-column marker; in the terminal every other line is indented by
  // the same two columns, so text starts under the line numbers.
  const indent = isBrowser() ? '' : '  '
  const text = (line: string) => `${indent}${line}`

  if (!guidanceOnly && primary?.file && primary.line) {
    children.push(text(`${colors.dim}${printable(formatFrameLocation(primary, cwd))}${colors.reset}`))
    const snippet = showFrames ? readCodeSnippet(primary.file, primary.line, snippetContextLines) : null
    if (snippet) {
      children.push(...formatSnippetLines(snippet))
    }
  }

  if (normalized.code) {
    children.push(text(`${colors.dim}Code:${colors.reset} ${printable(normalized.code)}`))
  }
  if (normalized.why) {
    children.push(...formatGuidanceLine('Why', printable(normalized.why), colors.yellow).map(text))
  }
  if (normalized.fix) {
    children.push(...formatGuidanceLine('Fix', printable(normalized.fix), colors.cyan).map(text))
  }
  if (normalized.link) {
    children.push(text(`${colors.dim}More:${colors.reset} ${printable(normalized.link)}`))
  }

  if (normalized.cause && normalized.cause !== normalized.message) {
    children.push(text(`${colors.dim}Caused by:${colors.reset} ${printable(normalized.cause)}`))
  }

  const hiddenCount = guidanceOnly ? 0 : frames.filter(f => !f.isApp || isInternalErrorFrame(f)).length
  const tailFrames = stackDepth > 0
    ? frames.filter(f => f !== primary && !isInternalErrorFrame(f)).slice(0, stackDepth)
    : []

  if (!guidanceOnly && (hiddenCount > 0 || tailFrames.length > 0)) {
    if (hiddenCount > 0) {
      children.push(text(`${colors.gray}stack (${hiddenCount} frame${hiddenCount === 1 ? '' : 's'} hidden in node_modules)${colors.reset}`))
    } else {
      children.push(text(`${colors.gray}stack${colors.reset}`))
    }
    for (const frame of tailFrames) {
      children.push(text(`${colors.gray}  ${printable(formatCollapsedFrame(frame, cwd))}${colors.reset}`))
    }
  }

  return [
    {
      key: 'error',
      value: `${colors.red}${colors.bold}${printable(normalized.message)}${colors.reset}`,
      children: children.length > 0 ? children : undefined,
    },
  ]
}
