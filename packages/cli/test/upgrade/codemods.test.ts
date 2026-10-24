import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/lib/upgrade/engine'
import { MIGRATIONS } from '../../src/lib/upgrade/migrations'

/**
 * One test per fixture case, from the folder layout alone:
 *
 *   fixtures/<migration>/<codemod slug>/<case>/input.<ext>
 *   fixtures/<migration>/<codemod slug>/<case>/output.<ext>   expected result; absent means unchanged
 *   fixtures/<migration>/<codemod slug>/<case>/findings.json  expected `[{ line, mode }]`; absent means every finding is auto
 *
 * Each case runs its codemod alone, so a fixture shows what that codemod does.
 */
const FIXTURES = join(__dirname, 'fixtures')

for (const migrationDir of readdirSync(FIXTURES)) {
  const migration = MIGRATIONS.find(candidate => `v${candidate.to}` === migrationDir)
  for (const slug of readdirSync(join(FIXTURES, migrationDir))) {
    const id = `${migrationDir}/${slug}`
    const codemod = migration?.codemods.find(candidate => candidate.id === id)

    describe(id, () => {
      it('is a codemod of its migration', () => {
        expect(codemod, `no codemod ${id} in MIGRATIONS`).toBeDefined()
      })

      for (const name of readdirSync(join(FIXTURES, migrationDir, slug))) {
        const dir = join(FIXTURES, migrationDir, slug, name)
        const input = readdirSync(dir).find(file => file.startsWith('input.'))!
        const ext = input.slice('input'.length)

        it(name, () => {
          const source = readFileSync(join(dir, input), 'utf8')
          const output = join(dir, `output${ext}`)
          const expected = existsSync(output) ? readFileSync(output, 'utf8') : source
          const result = migrate({
            files: new Map([[`app${ext}`, source]]),
            packageJson: null,
            migrations: [{ to: migration!.to, codemods: [codemod!] }],
            from: migration!.to - 1,
            prerelease: false,
          })

          expect(result.files.get(`app${ext}`)?.at(-1)?.after ?? source).toBe(expected)
          const findings = result.findings.map(finding => ({ line: finding.line, mode: finding.mode }))
          const expectedFindings = join(dir, 'findings.json')
          if (existsSync(expectedFindings)) expect(findings).toEqual(JSON.parse(readFileSync(expectedFindings, 'utf8')))
          else expect(findings.every(finding => finding.mode === 'auto')).toBe(true)
        })
      }
    })
  }
}

describe('migrations', () => {
  it('name every codemod v<major>/<slug> with a fixture folder', () => {
    for (const migration of MIGRATIONS) {
      for (const codemod of migration.codemods) {
        const [major, slug] = codemod.id.split('/')
        expect(major).toBe(`v${migration.to}`)
        expect(existsSync(join(FIXTURES, major!, slug!)), `no fixtures for ${codemod.id}`).toBe(true)
      }
    }
  })

  it('are ordered by target major', () => {
    const majors = MIGRATIONS.map(migration => migration.to)
    expect(majors).toEqual([...majors].sort((a, b) => a - b))
  })
})
