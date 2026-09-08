import { createHash } from 'node:crypto'
import { z } from 'zod'
import { REPO_DIR, runOutput } from '../workspace'
import { repoPathError, shellQuote } from './scan'

export const pagePathSchema = z.string().refine(path => repoPathError(path) === null, 'Pass a markdown path inside the repository.')

export const pageSnapshotSchema = z.object({
  path: pagePathSchema,
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().max(200_000),
})

export type PageSnapshot = z.infer<typeof pageSnapshotSchema>

interface ContentSandbox {
  run: (input: { command: string }) => PromiseLike<{ exitCode: number, stdout?: unknown, stderr?: unknown }>
  readTextFile: (input: { path: string }) => PromiseLike<string | null>
  writeTextFile: (input: { path: string, content: string }) => PromiseLike<unknown>
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function verify(snapshot: PageSnapshot): PageSnapshot {
  pageSnapshotSchema.parse(snapshot)
  if (digest(snapshot.text) !== snapshot.sha256) throw new Error('Page digest mismatch. Transfer the complete snapshot again.')
  return snapshot
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

export async function capturePage(sandbox: ContentSandbox, path: string): Promise<PageSnapshot> {
  const file = await checkedPath(sandbox, path)
  await run(sandbox, 'git diff --quiet HEAD -- . \':(exclude,glob)**/*.md\'', 'Commit source changes before capturing a page')
  await checkUntrackedSource(sandbox)
  const revision = await run(sandbox, 'git rev-parse HEAD', 'Cannot identify source revision')
  const text = await sandbox.readTextFile({ path: file })
  if (text === null) throw new Error('Page could not be read.')
  return pageSnapshotSchema.parse({ path, revision, text, sha256: digest(text) })
}

export async function loadPage(sandbox: ContentSandbox, snapshot: PageSnapshot): Promise<PageSnapshot> {
  verify(snapshot)
  await run(sandbox, 'git diff --quiet HEAD', 'Content checkout has local edits; use a fresh reviewer')
  await checkUntrackedSource(sandbox)
  const sha = snapshot.revision
  await run(sandbox,
    `(git cat-file -e ${sha}^{commit} || git fetch origin ${sha}) && git checkout --detach ${sha}`,
    'Cannot load the requested source revision; publish the source commit or report verification as blocked')
  const actual = await run(sandbox, 'git rev-parse HEAD', 'Cannot identify source revision')
  if (actual !== sha) throw new Error('Source revision mismatch.')
  return snapshot
}

export async function applyRewrite(sandbox: ContentSandbox, snapshot: PageSnapshot, text: string): Promise<PageSnapshot> {
  verify(snapshot)
  const current = await capturePage(sandbox, snapshot.path)
  if (current.revision !== snapshot.revision || current.sha256 !== snapshot.sha256) {
    throw new Error('Page or source revision changed since review. Capture and review it again.')
  }
  pageSnapshotSchema.parse({ ...snapshot, text, sha256: digest(text) })
  const file = await checkedPath(sandbox, snapshot.path)
  await sandbox.writeTextFile({ path: file, content: text })
  const written = await capturePage(sandbox, snapshot.path)
  if (written.sha256 !== digest(text)) throw new Error('Written page does not match the rewrite.')
  return written
}
