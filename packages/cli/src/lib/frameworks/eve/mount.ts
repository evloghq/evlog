import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MOUNT = /\bfrom\s+['"]@evlog\/eve['"]/

/**
 * The file under `agent/extensions/` that mounts `@evlog/eve`, relative to the
 * package, or `null`. Imports of its subpaths (`@evlog/eve/logger`) do not count.
 */
export function findEveMount(packageDir: string): string | null {
  const dir = join('agent', 'extensions')
  if (!existsSync(join(packageDir, dir))) return null
  for (const name of readdirSync(join(packageDir, dir)).sort()) {
    if (/\.[cm]?[jt]s$/.test(name) && MOUNT.test(readFileSync(join(packageDir, dir, name), 'utf8'))) return join(dir, name)
  }
  return null
}
