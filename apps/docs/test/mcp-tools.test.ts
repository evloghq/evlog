import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const docusDir = dirname(require.resolve('docus/package.json'))
const appDir = fileURLToPath(new URL('..', import.meta.url))
const contentDir = join(appDir, 'content')
const OVERRIDDEN = ['get-page.ts', 'list-pages.ts']

/* Content paths drop the numeric ordering prefix of every segment and the .md
   extension: `1.start/3.installation.md` is served at `/start/installation`. */
const contentPaths = new Set(
  readdirSync(contentDir, { recursive: true })
    .map(String)
    .filter(file => file.endsWith('.md'))
    .map(file => `/${file.replace(/\.md$/, '').split('/').map(segment => segment.replace(/^\d+\./, '')).join('/')}`),
)

describe('docs MCP tool overrides', () => {
  /* The app file only replaces Docus's tool while both share a file name. If
     Docus renames or drops one, ours would silently become a second tool. */
  it.each(OVERRIDDEN)('%s still overrides a tool Docus ships', (file) => {
    expect(existsSync(join(docusDir, 'server/mcp/tools', file))).toBe(true)
    expect(existsSync(join(appDir, 'server/mcp/tools', file))).toBe(true)
  })

  it.each(OVERRIDDEN)('%s only names paths that exist on evlog', (file) => {
    const source = readFileSync(join(appDir, 'server/mcp/tools', file), 'utf8')
    const paths = [...source.matchAll(/(?<![\w.])\/(?:start|learn|cli|integrate|use-cases|extend|reference|compare)\/[\w/-]*\w/g)].map(match => match[0])
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      const known = contentPaths.has(path) || [...contentPaths].some(page => page.startsWith(`${path}/`))
      expect(known, `${file}: ${path}`).toBe(true)
    }
    expect(source).not.toContain('/en/')
    expect(source).not.toContain('getting-started')
  })
})
