// Copies the logs engine and the redaction evlog keeps internal into the
// extension, so `eve extension build` bundles them: its declaration step only
// accepts sources under this package. The copies are build output; edit
// packages/evlog/src.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = new URL('../../evlog/src/', import.meta.url)
const target = new URL('../extension/lib/vendor/', import.meta.url)

await mkdir(target, { recursive: true })
for (const file of ['logs-query.ts', 'logs-vercel.ts', 'redact.ts', 'utils.ts']) {
  // The type imports resolve to evlog's own exports, not to a copy of types.ts.
  const code = (await readFile(new URL(file, source), 'utf8')).replace(/from '\.\/types'/g, 'from \'evlog\'')
  await writeFile(new URL(file, target), `// Copied from packages/evlog/src/${file} by scripts/vendor-logs.mjs. Edit it there.\n${code}`)
}
console.log(`vendored the logs engine and redaction into ${fileURLToPath(target)}`)
