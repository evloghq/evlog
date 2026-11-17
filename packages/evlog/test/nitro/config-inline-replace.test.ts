import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'acorn'
import { describe, expect, it } from 'vitest'

const INLINE_REPLACE_TOKEN = '__EVLOG_CONFIG__'

const NITRO_INLINE_SOURCES = [
  '../../src/shared/nitroConfigBridge.ts',
  '../../src/logger.ts',
] as const

/** Simulate Nitro's global textual `nitro.options.replace` substitution. */
function applyNitroInlineReplace(source: string, config: Record<string, unknown>): string {
  return source.replaceAll(INLINE_REPLACE_TOKEN, JSON.stringify(config))
}

/** Extract block comments from source (JSDoc and multiline slash-star comments). */
function extractBlockComments(source: string): string[] {
  const comments: string[] = []
  const pattern = /\/\*[\s\S]*?\*\//g
  for (const match of source.matchAll(pattern)) {
    comments.push(match[0])
  }
  return comments
}

const STAR_SLASH_GLOB_CONFIG = {
  env: { service: 'example' },
  exclude: ['/api/graphs/**/changes', '/api/graphs/*/changes'],
} as const

/** JS stand-in for runtime expression sites Nitro replace touches (declare lines are erased). */
const IDENTIFIER_FRAGMENT = [
  'typeof __EVLOG_CONFIG__ === "undefined"',
  '(__EVLOG_CONFIG__ === null)',
  '(typeof __EVLOG_CONFIG__ !== "object")',
  'void (__EVLOG_CONFIG__)',
].join('\n')

/** Pre-fix JSDoc shape from issue #397: replace token spelled inside a block comment. */
const BUGGY_INLINE_COMMENT_FIXTURE = [
  '/**',
  ` * 1. \`${INLINE_REPLACE_TOKEN}\` — inlined at build time by the evlog Nitro module.`,
  ' */',
  IDENTIFIER_FRAGMENT,
].join('\n')

/** Post-fix JSDoc shape: inline config documented without spelling the replace token. */
const FIXED_INLINE_COMMENT_FIXTURE = [
  '/**',
  ' * 1. Build-time inlined config literal — baked in via nitro.options.replace.',
  ' */',
  IDENTIFIER_FRAGMENT,
].join('\n')

/**
 * Build a JS-only fragment mirroring how Nitro replace touches each file:
 * every block comment plus the identifier guard lines that reference the token.
 */
function toJsReplaceFragment(source: string): string {
  return `${extractBlockComments(source).join('\n')}\n${IDENTIFIER_FRAGMENT}`
}

function assertParseableAfterReplace(source: string, config: Record<string, unknown>): void {
  const replaced = applyNitroInlineReplace(source, config)
  expect(() => parse(replaced, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
}

describe('nitro config inline replace (issue #397)', () => {
  describe('comment collision with star-slash globs', () => {
    it('breaks parse when the replace token is spelled inside a block comment', () => {
      const replaced = applyNitroInlineReplace(BUGGY_INLINE_COMMENT_FIXTURE, STAR_SLASH_GLOB_CONFIG)

      expect(() => parse(replaced, { ecmaVersion: 'latest', sourceType: 'module' })).toThrow()
    })

    it('stays parseable when block comments avoid the replace token', () => {
      assertParseableAfterReplace(FIXED_INLINE_COMMENT_FIXTURE, STAR_SLASH_GLOB_CONFIG)
    })
  })

  for (const relativePath of NITRO_INLINE_SOURCES) {
    const absolutePath = resolve(import.meta.dirname, relativePath)
    const source = readFileSync(absolutePath, 'utf8')
    const label = relativePath.split('/').pop()!

    it(`${label} has no ${INLINE_REPLACE_TOKEN} inside block comments`, () => {
      for (const comment of extractBlockComments(source)) {
        expect(comment, `block comment in ${label}`).not.toContain(INLINE_REPLACE_TOKEN)
      }
    })

    it(`${label} stays parseable after Nitro replace with star-slash globs`, () => {
      assertParseableAfterReplace(toJsReplaceFragment(source), STAR_SLASH_GLOB_CONFIG)
    })
  }
})
