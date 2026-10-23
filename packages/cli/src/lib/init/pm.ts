import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { VERSION } from '../constants'

const exec = promisify(execFile)

/** Package managers `init` knows how to add a dependency with. */
export type PackageManager = 'pnpm' | 'bun' | 'yarn' | 'npm'

const LOCKFILES: Record<PackageManager, string[]> = {
  pnpm: ['pnpm-lock.yaml'],
  bun: ['bun.lock', 'bun.lockb'],
  yarn: ['yarn.lock'],
  npm: ['package-lock.json'],
}

/** Pick the package manager from lockfiles, nearest directory first. */
export function detectPackageManager(dirs: string[]): PackageManager {
  for (const dir of dirs) {
    for (const [manager, files] of Object.entries(LOCKFILES) as [PackageManager, string[]][]) {
      if (files.some(file => existsSync(join(dir, file)))) return manager
    }
  }
  return 'npm'
}

/**
 * The `evlog` spec init installs. A prerelease CLI installs evlog from `beta`:
 * until a major is GA, `latest` is the previous one, whose import paths differ.
 */
export function evlogPackageSpec(cliVersion: string): string {
  return cliVersion.includes('-') ? 'evlog@beta' : 'evlog'
}

const EVLOG_PACKAGE = evlogPackageSpec(VERSION)

/** The command line that adds `evlog`, as the user would type it. */
export function installCommand(manager: PackageManager, pkg = EVLOG_PACKAGE): string {
  return manager === 'npm' ? `npm install ${pkg}` : `${manager} add ${pkg}`
}

/** Returns the failure rather than throwing — the wiring already on disk stands. */
export async function runInstall(
  manager: PackageManager,
  cwd: string,
  pkg = EVLOG_PACKAGE,
): Promise<{ ok: true } | { ok: false, error: string }> {
  const args = manager === 'npm' ? ['install', pkg] : ['add', pkg]
  try {
    await exec(manager, args, { cwd, timeout: 5 * 60_000 })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message.split('\n')[0] ?? message }
  }
}
