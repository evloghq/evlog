import { createHash } from 'node:crypto'
import { z } from 'zod'
import { REPO_DIR, runOutput } from '../workspace'
import { repoPathError, shellQuote } from './scan'

export const pagePathSchema = z.string().refine(path => repoPathError(path) === null, 'Pass a markdown path inside the repository.')

export const pageSnapshotSchema = z.object({
  path: pagePathSchema,
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})

export type PageSnapshot = z.infer<typeof pageSnapshotSchema>

interface ContentSandbox {
  run: (input: { command: string }) => PromiseLike<{ exitCode: number, stdout?: unknown, stderr?: unknown }>
  readTextFile: (input: { path: string }) => PromiseLike<string | null>
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function run(sandbox: ContentSandbox, command: string, failure: string): Promise<string> {
  const result = await sandbox.run({ command: `cd ${REPO_DIR} && ${command}` })
  if (result.exitCode !== 0) throw new Error(`${failure}: ${runOutput(result)}`)
  return String(result.stdout ?? '').trim()
}

function checkedPath(sandbox: ContentSandbox, path: string): Promise<string> {
  pagePathSchema.parse(path)
  const script = 'const fs = require("node:fs"); const p = require("node:path"); const root = fs.realpathSync("."); const file = fs.realpathSync(process.argv[1]); if (!file.startsWith(root + p.sep)) process.exit(1); console.log(file)'
  return run(sandbox, `node -e ${shellQuote(script)} ${shellQuote(path)}`, 'Page must resolve inside the repository')
}

async function checkUntrackedSource(sandbox: ContentSandbox): Promise<void> {
  const files = await run(sandbox, 'git ls-files --others --exclude-standard -- . \':(exclude,glob)**/*.md\'', 'Cannot inspect untracked source')
  if (files) throw new Error('Commit source changes before capturing or loading a page.')
}

async function readPage(sandbox: ContentSandbox, path: string): Promise<PageSnapshot & { text: string }> {
  const file = await checkedPath(sandbox, path)
  await run(sandbox, 'git diff --quiet HEAD -- . \':(exclude,glob)**/*.md\'', 'Commit source changes before capturing a page')
  await checkUntrackedSource(sandbox)
  const revision = await run(sandbox, 'git rev-parse HEAD', 'Cannot identify source revision')
  const text = await sandbox.readTextFile({ path: file })
  if (text === null) throw new Error('Page could not be read.')
  return { ...pageSnapshotSchema.parse({ path, revision, sha256: digest(text) }), text }
}

export async function capturePage(sandbox: ContentSandbox, path: string): Promise<PageSnapshot> {
  return pageSnapshotSchema.parse(await readPage(sandbox, path))
}

export async function loadPage(sandbox: ContentSandbox, snapshot: PageSnapshot): Promise<PageSnapshot & { text: string }> {
  pageSnapshotSchema.parse(snapshot)
  const current = await readPage(sandbox, snapshot.path)
  if (current.revision !== snapshot.revision || current.sha256 !== snapshot.sha256) {
    throw new Error('Page or source revision changed since review. Capture and review it again.')
  }
  return current
}
