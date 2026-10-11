import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cliErrors } from '../errors'

/**
 * The published evlog skills, installed by delegating to `npx skills`.
 *
 * We do not copy skill files ourselves. Every agent reads a different directory
 * (`.claude/skills`, `.agents/skills`, `.codex/skills`, …), the skills CLI
 * already resolves that per agent, symlinks a canonical copy, and owns
 * `update` / `remove` / `list` — and it keeps no manifest, so anything we wrote
 * behind its back would be a second copy it could never update.
 *
 * So this module does two things: notice when the skills are already there, and
 * shell out when they are not. Same shape as `init` running the package manager
 * rather than unpacking a tarball itself.
 */

/** Where the skills are published. Overridable so forks can point elsewhere. */
export const DEFAULT_SOURCE = 'https://www.evlog.dev'

/**
 * Skill directories published from the docs site.
 *
 * Used only to notice an existing install. A name that goes stale here costs
 * one redundant `npx skills add`, which is why it is not worth a network call.
 */
export const EVLOG_SKILLS = ['review-logging-patterns', 'build-audit-logs', 'analyze-logs'] as const

/** Per-agent skill directories, relative to a project root or to `$HOME`. */
const AGENT_DIRS = [
  '.claude/skills',
  '.agents/skills',
  '.cursor/skills',
  '.codex/skills',
  '.opencode/skills',
]

export interface InstalledSkills {
  /** Skill names found on disk, in any agent's directory. */
  names: string[]
  /** The directories they were found in, relative to the project or `~`. */
  dirs: string[]
}

/**
 * Look for evlog skills already installed, project-local and global.
 *
 * Deliberately generous: any agent, either scope. Somebody who ran
 * `npx skills add` last month should not be told to run it again.
 *
 * @param home - The global scope to search, from {@link CliContext.home}.
 */
export function findInstalledSkills(root: string, home: string): InstalledSkills {
  const names = new Set<string>()
  const dirs = new Set<string>()

  for (const [base, label] of [[root, ''], [home, '~/']] as const) {
    for (const dir of AGENT_DIRS) {
      for (const skill of EVLOG_SKILLS) {
        if (!existsSync(join(base, dir, skill))) continue
        names.add(skill)
        dirs.add(`${label}${dir}`)
      }
    }
  }

  return { names: [...names].sort(), dirs: [...dirs].sort() }
}

export interface SkillsCommand {
  /** The command line, as the user would type it. */
  display: string
  bin: string
  args: string[]
}

/** Skill directory names, per the Agent Skills spec. */
const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Characters an origin never needs, and `cmd.exe` reads as syntax.
 *
 * Being an http(s) URL is not enough on its own: `https://evlog.dev?q=1&calc`
 * parses, and `&` still separates commands. Node does not escape array
 * arguments under `shell: true`, so the allowlist is the guard.
 */
const SAFE_SOURCE = /^[A-Za-z0-9._~:/-]+$/

/**
 * Reject anything that is not a plain http(s) origin.
 *
 * On Windows {@link runSkills} needs a shell to find `npx` — Node refuses to
 * spawn a `.cmd` without one — which means this value reaches a `cmd.exe`
 * command line. Nobody types `&` against themselves, but a `--source` fed from
 * CI config or an interpolated variable is a different question, so the shape
 * is checked once here rather than trusted all the way down.
 */
function checkSource(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw cliErrors.AGENTS_INVALID_SOURCE({ value })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw cliErrors.AGENTS_INVALID_SOURCE({ value })
  }
  if (!SAFE_SOURCE.test(value)) {
    throw cliErrors.AGENTS_INVALID_SOURCE({ value })
  }
  return value
}

/**
 * The agents the skills are installed for, passed explicitly with `--agent`.
 *
 * `universal` is the shared `.agents/skills` directory: a global install lands
 * in `~/.agents/skills`, a local one in the project's `.agents/skills`, and the
 * agents that read that directory (Codex among them) find the skills there.
 * `claude-code` gets a relative symlink into it, in `.claude/skills` or
 * `~/.claude/skills`. Naming the agents keeps the skills CLI from copying into
 * every agent directory it detects; `cursor` is left out for the same reason.
 */
export const AGENT_TARGETS = ['universal', 'claude-code'] as const

/**
 * Build the `npx skills add` invocation.
 *
 * `--yes` only when nobody is watching. Interactively the skills CLI may still
 * ask questions of its own, and those are its to ask.
 */
export function skillsCommand(options: {
  source?: string
  skills?: readonly string[]
  /** Install into this project instead of for every project. */
  local?: boolean
  interactive: boolean
}): SkillsCommand {
  const args = ['--yes', 'skills', 'add', checkSource(options.source ?? DEFAULT_SOURCE)]
  if (options.skills?.length) {
    for (const skill of options.skills) {
      if (!SKILL_NAME.test(skill)) throw cliErrors.AGENTS_INVALID_SKILL({ value: skill })
    }
    args.push('--skill', ...options.skills)
  }
  for (const agent of AGENT_TARGETS) args.push('--agent', agent)
  if (!options.local) args.push('--global')
  if (!options.interactive) args.push('--yes')

  /* Every argument, including npx's own `--yes`: this string is what the plan
     shows and what the report tells you to re-run, so it has to be the command
     that actually runs rather than a tidied version of it. */
  return { display: `npx ${args.join(' ')}`, bin: 'npx', args }
}

/**
 * Run it, returning the failure rather than throwing.
 *
 * The `AGENTS.md` block is already on disk by this point and stands on its own;
 * losing it because a subprocess could not reach the network would be the wrong
 * trade. Interactive runs inherit the terminal so the skills CLI can ask its
 * own questions.
 */
export function runSkills(
  command: SkillsCommand,
  cwd: string,
  interactive: boolean,
): Promise<{ ok: true } | { ok: false, error: string }> {
  return new Promise((resolve) => {
    const child = spawn(command.bin, command.args, {
      cwd,
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      timeout: 5 * 60_000,
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      resolve({ ok: false, error: error.message })
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true })
        return
      }
      const line = stderr.trim().split('\n').filter(Boolean).at(-1)
      resolve({ ok: false, error: line ?? `npx skills add exited ${code}` })
    })
  })
}
