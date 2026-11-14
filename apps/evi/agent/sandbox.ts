import { installAgentBrowser } from '@agent-browser/eve/sandbox'
import { defineSandbox } from 'eve/sandbox'
import type { SandboxSession } from 'eve/sandbox'
import { browserSandbox } from './lib/capture'
import { cloneUrl, homeRepository } from './lib/repo'
import { createSandboxEnvironment } from './lib/sandbox-backend'
import { agentBrowserInstallOptions, workspaceBootstrapCommand } from './lib/workspace-bootstrap'

/**
 * Kept for its diff engine, not for capture: capture__before_after owns
 * capture and hosting. Pinned so template reuse invalidates when it moves.
 */
const BEFORE_AFTER_CLI = '@vercel/before-and-after@0.0.4'

/**
 * eve's image ships npm alone. corepack provides pnpm and yarn at the version
 * each repository pins in `packageManager`, bun is separate, and `nci` picks
 * from the lockfile.
 */
const PACKAGE_MANAGER_CLIS = ['corepack@0.36.0', '@antfu/ni@30.6.0', 'bun@1.4.2']

const HOME = homeRepository()

async function prepareSandbox(sandbox: SandboxSession) {
  await sandbox.run({ command: `npm install -g ${[BEFORE_AFTER_CLI, ...PACKAGE_MANAGER_CLIS].join(' ')}` })
  await sandbox.run({ command: 'corepack enable' })
  await sandbox.run({ command: `git clone --depth 50 ${cloneUrl(HOME)} repo` })
  // Frozen: a cold install in a fresh clone otherwise re-resolves the whole
  // graph, and any <48h transitive release then fails the template build on
  // the repo's own minimumReleaseAge policy. The lockfile is what CI tested.
  await sandbox.run({ command: workspaceBootstrapCommand })
  // The CLI at main, usable from any checkout in the sandbox.
  await sandbox.run({ command: 'ln -sf /workspace/repo/node_modules/.bin/evlog "$(npm prefix -g)/bin/evlog"' })
  // Prime the turbo cache on deployed builds only: locally this is minutes
  // of CPU on every template rebuild.
  if (process.env.VERCEL) {
    await sandbox.run({ command: 'cd repo && pnpm run lint && pnpm run typecheck && pnpm run test' })
  }
  // Commits authored in the sandbox belong to the bot, on every channel.
  await sandbox.run({ command: 'git config --global user.name "evlogai[bot]" && git config --global user.email "evlogai[bot]@users.noreply.github.com"' })
  const { stdout: architecture } = await sandbox.run({ command: 'uname -m' })
  await installAgentBrowser(browserSandbox(sandbox), agentBrowserInstallOptions(architecture))
}

/**
 * The template carries a ready-to-work checkout of the home repository so
 * sessions can run lint, typecheck, and tests instead of shipping unverified
 * changes. The clone, install, and browser tooling are paid once per template
 * build; every session inherits the filesystem and only pays a fetch to main.
 * eve keys the snapshot on this module's compiled revision, so any edit here
 * rebuilds it.
 */
export const environment = createSandboxEnvironment(Boolean(process.env.VERCEL), prepareSandbox)

export default defineSandbox(async () => {
  const sandbox = await environment.open()
  // The template snapshot is owned by the builder uid, not the session user;
  // without these entries every git command dies on "dubious ownership".
  await sandbox.run({ command: 'git config --global --add safe.directory /workspace && git config --global --add safe.directory /workspace/repo' })
  await sandbox.run({ command: 'cd repo && git fetch origin main && git checkout -B main origin/main' })
  return sandbox
})
