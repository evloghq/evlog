import { randomUUID } from 'node:crypto'
import { REPO_DIR } from '../workspace'

/**
 * The content-lint invocation for a single ad-hoc scan. The scanner itself
 * lives in the repository: one implementation, one set of thresholds, whether
 * a person runs it or the reviewer does. Prose never reaches the shell: a
 * passage is staged in a file and redirected in, so a draft containing quotes
 * or a heredoc delimiter is scanned rather than executed.
 */

export type ScanSurface = 'docs' | 'reference' | 'landing' | 'blog' | 'readme' | 'skill' | 'agents'

export interface ScanInput {
  path?: string
  text?: string
  url?: string
  as?: ScanSurface
}

/**
 * Single-quote a value for `sh`, closing and reopening around any quote it
 * contains. A path or a URL is model-supplied and reaches a shell.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', `'\\''`)}'`
}

/**
 * A repository path, or the reason it is not one. The scanner refuses anything
 * outside the checkout on its own, but a path built here reaches a shell first,
 * and a clear refusal beats an exit code the model has to interpret.
 */
export function repoPathError(path: string): string | null {
  if (path.startsWith('/')) return 'Pass a repo-relative path, not an absolute one.'
  if (path.split('/').includes('..')) return 'Pass a path inside the repository.'
  if (!path.endsWith('.md')) return 'Only markdown files are scanned.'
  return null
}

/**
 * The command that scans one input, and whether a passage has to be staged
 * first. Exactly one of `path`, `text`, and `url` is expected; the caller
 * rejects anything else before reaching here.
 */
export function scanCommand(input: ScanInput): { command: string, passage?: { path: string, content: string } } {
  const scanner = `cd ${REPO_DIR} && node scripts/content-lint/index.mjs`
  const as = `--as ${shellQuote(input.as ?? 'docs')}`

  if (input.path !== undefined) {
    // A file in the checkout takes its surface from where it lives, so `--as`
    // would be a way to ask for the wrong thresholds.
    return { command: `${scanner} ${shellQuote(input.path)} --json` }
  }

  if (input.url !== undefined) {
    return { command: `${scanner} --url ${shellQuote(input.url)} ${as} --json` }
  }

  const path = `/tmp/content-scan-${randomUUID()}.md`
  return {
    command: `trap 'rm -f ${path}' EXIT; ${scanner} --stdin ${as} --json < ${path}`,
    passage: input.text === undefined ? undefined : { path, content: input.text },
  }
}

/** The scanner's `--json` report, or null when stdout is not its JSON. */
export function parseLintReport(stdout: unknown): { baseline: unknown, pages: unknown[] } | null {
  try {
    const parsed = JSON.parse(String(stdout)) as { baseline?: unknown, pages?: unknown }
    return Array.isArray(parsed.pages) ? { baseline: parsed.baseline, pages: parsed.pages } : null
  } catch {
    return null
  }
}
