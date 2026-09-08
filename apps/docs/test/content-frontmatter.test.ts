import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const docusRequire = createRequire(require.resolve('docus/package.json'))
const mdcRequire = createRequire(docusRequire.resolve('@nuxtjs/mdc'))
const { parseFrontMatter } = await import(pathToFileURL(mdcRequire.resolve('remark-mdc')).href)
const contentDir = join(import.meta.dirname, '../content')
const pages = readdirSync(contentDir, { recursive: true })
  .filter(file => file.endsWith('.md'))

// Use Docus's parser: permissive YAML parsing can silently turn strings into objects.
describe('content frontmatter', () => {
  it.each(pages)('%s keeps SEO metadata as strings', (file) => {
    const { data } = parseFrontMatter(readFileSync(join(contentDir, file), 'utf8'))
    for (const field of ['title', 'description']) {
      if (field in data) expect(data[field], `${file}: ${field}`).toBeTypeOf('string')
    }
    if ('navigation' in data && data.navigation !== false) {
      expect(data.navigation).toBeTypeOf('object')
    }
    if ('links' in data) expect(Array.isArray(data.links)).toBe(true)
  })
})
