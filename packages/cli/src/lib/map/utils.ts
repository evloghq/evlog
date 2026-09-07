import { createHash } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import type { Framework, RawRouteEntry } from './types'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/** Stable id for a route — hash of framework/kind/method/path (12 hex chars). */
export function routeId(entry: Pick<RawRouteEntry, 'framework' | 'kind' | 'path' | 'method'>): string {
  const key = `${entry.framework}:${entry.kind}:${entry.method ?? '*'}:${entry.path}`
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

/**
 * Extension of a module, in every spelling the route globs pick up.
 *
 * `.mjs` and `.cjs` are in here because Nitro serves them as handlers just the
 * same: leaving them out kept the extension in the derived path and dropped the
 * method off `checkout.post.mjs`.
 */
const MODULE_EXTENSION = /\.(?:[mc]?[jt]s)$/

/** Extract an HTTP method from a filename like `checkout.post.ts` (Nuxt/Nitro convention). */
export function extractMethodFromFilename(filename: string): string | null {
  const base = filename.replace(MODULE_EXTENSION, '')
  const dot = base.lastIndexOf('.')
  if (dot === -1) return null
  const suffix = base.slice(dot + 1).toLowerCase()
  if ((HTTP_METHODS as readonly string[]).includes(suffix)) {
    return suffix.toUpperCase()
  }
  return null
}

/** Drop a source file extension, keeping the rest of the name intact. */
export function stripExtension(filename: string): string {
  return filename.replace(/\.(?:vue|[mc]?[jt]sx?)$/, '')
}

/** Remove HTTP method suffix and file extension from a route filename. */
export function stripRouteFilename(filename: string): string {
  const withoutExt = stripExtension(filename)
  const dot = withoutExt.lastIndexOf('.')
  if (dot === -1) return withoutExt
  const suffix = withoutExt.slice(dot + 1).toLowerCase()
  if ((HTTP_METHODS as readonly string[]).includes(suffix)) {
    return withoutExt.slice(0, dot)
  }
  return withoutExt
}

/** Convert file-based route segments to a URL pattern. */
export function segmentsToPath(segments: string[], prefix = ''): string {
  const parts: string[] = []
  for (const seg of segments) {
    if (!seg || seg === 'index') continue
    if (seg.startsWith('(') && seg.endsWith(')')) continue
    if (seg.startsWith('[[...') && seg.endsWith(']]')) {
      const name = seg.slice(5, -2)
      parts.push(`:${name}*?`)
      continue
    }
    if (seg.startsWith('[...') && seg.endsWith(']')) {
      const name = seg.slice(4, -1)
      parts.push(`:${name}*`)
      continue
    }
    if (seg.startsWith('[') && seg.endsWith(']')) {
      parts.push(`:${seg.slice(1, -1)}`)
      continue
    }
    if (seg.startsWith('$')) {
      if (seg.startsWith('$...')) {
        parts.push(`:${seg.slice(4)}*`)
      } else {
        parts.push(`:${seg.slice(1)}`)
      }
      continue
    }
    parts.push(seg)
  }
  const path = `/${parts.join('/')}`.replace(/\/+/g, '/')
  return prefix ? `${prefix}${path === '/' ? '' : path}` : (path || '/')
}

/**
 * Path of `file` relative to `root`, always with `/` separators.
 *
 * Globs return posix paths while the root comes from the OS, so comparing the
 * two by prefix drops routes on Windows and eats a character when the root
 * carries a trailing separator. A file outside the root is returned untouched.
 */
export function relativeFromRoot(root: string, file: string): string {
  const rel = relative(root, file)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return file
  return sep === '/' ? rel : rel.split(sep).join('/')
}

/** One line of `source`, with `radius` lines of context around it, trimmed. */
export function lineSnippet(source: string, line: number, radius = 0): string {
  const lines = source.split('\n')
  const idx = line - 1
  const start = Math.max(0, idx - radius)
  const end = Math.min(lines.length, idx + radius + 1)
  return lines.slice(start, end).join('\n').trim()
}

/** Human-readable name of a framework, for report headers. */
export function frameworkLabel(framework: Framework): string {
  switch (framework) {
    case 'nuxt': return 'Nuxt'
    case 'nitro': return 'Nitro'
    case 'next': return 'Next.js'
    case 'tanstack-start': return 'TanStack Start'
    case 'hono': return 'Hono'
    case 'express': return 'Express'
    case 'fastify': return 'Fastify'  
    case 'elysia': return 'Elysia'
  }
}
