import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { docsUrlFor } from '../../src/lib/upgrade/docs'
import { MIGRATIONS } from '../../src/lib/upgrade/migrations'

const REFERENCE = join(__dirname, '../../../../apps/docs/content/7.reference')

/** The anchors MDC gives the guide's headings: lowercased, punctuation dropped, spaces as hyphens. */
function guideAnchors(major: number): Set<string> {
  const file = readdirSync(REFERENCE).find(name => name.endsWith(`migrate-v${major}.md`))
  if (!file) throw new Error(`no migration guide for v${major} in ${REFERENCE}`)
  const headings = readFileSync(join(REFERENCE, file), 'utf8').match(/^#{2,3} .+$/gm) ?? []
  return new Set(headings.map(heading => heading
    .replace(/^#+ /, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')))
}

describe('migration guide anchors', () => {
  for (const migration of MIGRATIONS) {
    const ids = [...migration.codemods.map(codemod => codemod.id), `v${migration.to}/evlog-version`]

    it.each(ids)('%s links to a section of the guide', (id) => {
      const anchor = new URL(docsUrlFor(id)).hash.slice(1)
      expect(guideAnchors(migration.to)).toContain(anchor)
    })
  }
})
