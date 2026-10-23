import { execFile } from 'node:child_process'
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../bin/evlog.mjs', import.meta.url))
const run = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/* Copied out of the workspace so neither the cwd nor the shim's own location
   resolves @evlog/cli; fake runners on PATH record the call and exit 3. */
async function isolated(): Promise<{ dir: string, log: string, shim: string, env: NodeJS.ProcessEnv, calls: () => Promise<string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'evlog-bin-'))
  tempDirs.push(dir)
  const shim = join(dir, 'evlog.mjs')
  await cp(bin, shim)
  const log = join(dir, 'calls.log')
  for (const name of ['npx', 'pnpm', 'bunx']) {
    const fake = join(dir, name)
    await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "${log}"\nexit 3\n`)
    await chmod(fake, 0o755)
  }
  return {
    dir,
    log,
    shim,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    calls: async () => (await readFile(log, 'utf8')).trim(),
  }
}

describe('evlog bin', () => {
  it('runs the installed @evlog/cli executable', async () => {
    const { stdout } = await run(process.execPath, [bin, '--version'])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('exposes the CLI commands', async () => {
    const { stderr } = await run(process.execPath, [bin, '--help'])
    for (const command of ['init', 'map', 'doctor', 'agents']) expect(stderr).toContain(command)
  })

  it('fetches @evlog/cli with npx when it is not installed', async () => {
    const { shim, env, calls } = await isolated()
    const result = await run(process.execPath, [shim, 'map', '--json'], {
      cwd: tmpdir(),
      env: { ...env, npm_config_user_agent: 'npm/10.0.0 node/v22.0.0' },
    }).catch((error: { code: number, stderr: string }) => error)
    expect(result.code).toBe(3)
    expect(result.stderr).toContain('@evlog/cli is not installed')
    expect(await calls()).toBe('npx --yes @evlog/cli map --json')
  })

  it('uses the package manager that launched it', async () => {
    const { shim, env, calls } = await isolated()
    await run(process.execPath, [shim, 'doctor'], {
      cwd: tmpdir(),
      env: { ...env, npm_config_user_agent: 'pnpm/10.0.0 npm/? node/v22.0.0' },
    }).catch(() => undefined)
    expect(await calls()).toBe('pnpm dlx @evlog/cli doctor')
  })

  it('stops when the fetch it started runs this bin again', async () => {
    const { dir, log, shim, env, calls } = await isolated()
    /* With the evlog bin shadowing @evlog/cli, pnpm dlx lands back on this bin.
       The fake re-runs the shim the way that does, and exits after three calls
       so a regression fails instead of spinning. */
    const pnpm = join(dir, 'pnpm')
    await writeFile(pnpm, `#!/bin/sh\nprintf 'pnpm %s\\n' "$*" >> "${log}"\n[ "$(wc -l < "${log}")" -ge 3 ] && exit 3\nexec "${process.execPath}" "${shim}"\n`)
    await chmod(pnpm, 0o755)
    const result = await run(process.execPath, [shim, 'map', '--json'], {
      cwd: tmpdir(),
      timeout: 20_000,
      env: { ...env, npm_config_user_agent: 'pnpm/11.28.3 npm/? node/v24.21.0' },
    }).catch((error: { code: number, stderr: string }) => error)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('npx --yes @evlog/cli')
    expect(await calls()).toBe('pnpm dlx @evlog/cli map --json')
  })
})
