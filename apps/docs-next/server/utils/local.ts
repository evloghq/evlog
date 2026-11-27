import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Source } from 'comark-content'

const exec = promisify(execFile)
/** Root of the git repository holding the content (resolved at build time by modules/config/). */
function repoRoot(): string {
  return useRuntimeConfig().docs.repoRoot
}
const MAX_BUFFER = 64 * 1024 * 1024

/**
 * Resolve a ref to a commit: in dev a mounted version's branch may exist only on origin, where bare
 * `git show <branch>:file` fails. The final bare-ref candidate accepts a commit SHA.
 *
 * `--end-of-options` is load-bearing — a ref beginning with `-` would otherwise parse as an option,
 * and `git show` accepts diff options including `--output=<file>`. Don't swap it for `--`:
 * `<rev>:<path>` is an object spec, so `git show -- HEAD:file` reads it as a pathspec, emitting nothing.
 */
export async function resolveGitRef(ref: string): Promise<string> {
  const candidates = [`refs/heads/${ref}`, `refs/remotes/origin/${ref}`, ref]

  for (const candidate of candidates) {
    try {
      const { stdout } = await exec(
        'git',
        ['rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`],
        { cwd: repoRoot(), maxBuffer: MAX_BUFFER }
      )
      const sha = stdout.trim()
      if (sha) return sha
    } catch {
      // Try the next ref form.
    }
  }

  throw createError({ statusCode: 404, statusMessage: `Git ref not found locally or on origin: ${ref}` })
}

/** A comark Source reading content from the local git repo at a ref: a configured branch or a validated commit SHA. */
export function gitLocalSource(ref: string, dir: string): Source {
  const prefix = `${dir.replace(/\/$/, '')}/`

  const show = async (key: string) => {
    const resolved = await resolveGitRef(ref)
    const { stdout } = await exec('git', ['show', '--end-of-options', `${resolved}:${prefix}${key}`], {
      cwd: repoRoot(),
      maxBuffer: MAX_BUFFER,
    })
    return stdout
  }

  return {
    keys: async () => {
      const resolved = await resolveGitRef(ref)
      const { stdout } = await exec(
        'git',
        ['ls-tree', '-r', '-z', '--name-only', '--end-of-options', resolved, '--', dir],
        {
          cwd: repoRoot(),
          maxBuffer: MAX_BUFFER,
        }
      )
      return stdout
        .split('\0')
        .filter(Boolean)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length))
    },
    getItem: (key: string) => show(key),
    getItemRaw: (key: string) => show(key),
  }
}
