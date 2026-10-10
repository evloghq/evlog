import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defined } from '../helpers/defined'

const execFileAsync = promisify(execFile)

const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../dist')
const gateEntry = join(distDir, 'next/instrumentation.mjs')
const distExists = existsSync(gateEntry)

if (!distExists) {
  console.warn('[evlog test] Skipping Next instrumentation bundle check: dist/ not found. Run `pnpm --filter evlog run build` first.')
}

/**
 * Bundle a root `instrumentation.ts` the way Next.js does: `NEXT_RUNTIME` inlined,
 * evlog bundled into the output, `next` provided by the host.
 */
async function bundleInstrumentation(runtime: 'nodejs' | 'edge'): Promise<string> {
  const result = await build({
    stdin: {
      contents: [
        `import { defineNodeInstrumentation } from ${JSON.stringify(gateEntry)}`,
        `export const { register, onRequestError } = defineNodeInstrumentation({ service: 'bundle-check', silent: true })`,
      ].join('\n'),
      resolveDir: distDir,
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: runtime === 'nodejs' ? 'node' : 'neutral',
    define: { 'process.env.NEXT_RUNTIME': JSON.stringify(runtime) },
    external: ['next', 'next/*'],
    logLevel: 'silent',
  })
  return defined(result.outputFiles[0], 'esbuild output').text
}

describe.skipIf(!distExists)('defineNodeInstrumentation in a Next.js bundle', () => {
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'evlog-next-bundle-'))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('Node.js bundle runs register() without evlog in node_modules', async () => {
    const file = join(workDir, 'instrumentation.mjs')
    await writeFile(file, await bundleInstrumentation('nodejs'))

    const script = `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); await m.register(); console.log('registered')`
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], { cwd: workDir })

    expect(stdout.trim()).toBe('registered')
  })

  it('Edge bundle leaves the logger out', async () => {
    const code = await bundleInstrumentation('edge')

    expect(code).toContain('function defineNodeInstrumentation(')
    expect(code).not.toContain('function initLogger(')
    expect(code).not.toContain('function createInstrumentation(')
  })
})
