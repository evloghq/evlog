// Copies the logs engine evlog keeps internal into the extension, so `eve
// extension build` bundles it: its declaration step only accepts sources under
// this package. The copies are build output; edit packages/evlog/src.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = new URL('../../evlog/src/', import.meta.url)
const target = new URL('../extension/lib/vendor/', import.meta.url)

await mkdir(target, { recursive: true })
for (const file of ['logs-query.ts', 'logs-vercel.ts']) {
  const code = await readFile(new URL(file, source), 'utf8')
  await writeFile(new URL(file, target), `// Copied from packages/evlog/src/${file} by scripts/vendor-logs.mjs. Edit it there.\n${code}`)
}
console.log(`vendored the logs engine into ${fileURLToPath(target)}`)
