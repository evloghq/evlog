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
 * The spec init installs a package with. A prerelease CLI installs from `beta`:
 * until evlog 3 is GA, `latest` is evlog 2, whose import paths differ and which
 * `@evlog/eve` does not accept.
 */
export function evlogPackageSpec(cliVersion: string, name = 'evlog'): string {
  return cliVersion.includes('-') ? `${name}@beta` : name
}

/** The specs init installs the packages with, such as `evlog@beta`. */
export function installSpecs(packages: readonly string[]): string[] {
  return packages.map(name => evlogPackageSpec(VERSION, name))
}

/** The command line that adds the packages, as the user would type it. */
export function installCommand(manager: PackageManager, packages: readonly string[] = ['evlog']): string {
  const specs = installSpecs(packages).join(' ')
  return manager === 'npm' ? `npm install ${specs}` : `${manager} add ${specs}`
}

/** Returns the failure rather than throwing — the wiring already on disk stands. */
export async function runInstall(
  manager: PackageManager,
  cwd: string,
  packages: readonly string[] = ['evlog'],
): Promise<{ ok: true } | { ok: false, error: string }> {
  const specs = installSpecs(packages)
  const args = manager === 'npm' ? ['install', ...specs] : ['add', ...specs]
  try {
    await exec(manager, args, { cwd, timeout: 5 * 60_000 })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message.split('\n')[0] ?? message }
  }
}
