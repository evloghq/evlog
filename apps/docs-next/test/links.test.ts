import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const contentDir = resolve(import.meta.dirname, '../content')
const files = readdirSync(contentDir, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.md'))

/** The URL a content file is served at: numeric prefixes dropped, an index file standing for its directory. */
function routeOf(file: string) {
  const segments = file.replace(/\.md$/, '').split('/').map(segment => segment.replace(/^\d+\./, ''))
  if (segments.at(-1) === 'index') segments.pop()
  return `/${segments.join('/')}`
}

const routes = new Set(files.map(routeOf))

describe('links between pages', () => {
  it.each(files)('%s links only to pages that exist', (file) => {
    const source = readFileSync(resolve(contentDir, file), 'utf8')
    const targets = [...source.matchAll(/\]\((\/[^)\s#]*)(?:#[^)\s]*)?\)/g)].map(([, path]) => path!.replace(/(.)\/$/, '$1'))

    expect(targets.filter(path => !routes.has(path))).toEqual([])
  })
})
