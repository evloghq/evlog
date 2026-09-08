export const WRITE_REVIEWED_PAGE = String.raw`
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { snapshot, text } = JSON.parse(fs.readFileSync(process.env.EVI_CONTENT_REWRITE, 'utf8'))
const root = fs.realpathSync('.')
const file = fs.realpathSync(snapshot.path)
if (!file.startsWith(root + path.sep)) throw new Error('Page must resolve inside the repository')
const lock = file + '.evi-content-lock'
fs.mkdirSync(lock)
let staging
try {
  const git = args => execFileSync('git', args, { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' }).trim()
  if (git(['rev-parse', 'HEAD']) !== snapshot.revision) throw new Error('Page or source revision changed since review')
  git(['diff', '--quiet', 'HEAD', '--', '.', ':(exclude,glob)**/*.md'])
  if (git(['ls-files', '--others', '--exclude-standard', '--', '.', ':(exclude,glob)**/*.md'])) {
    throw new Error('Commit source changes before applying a rewrite')
  }
  staging = fs.mkdtempSync(path.join(path.dirname(file), '.evi-rewrite-'))
  const replacement = path.join(staging, 'page.md')
  fs.writeFileSync(replacement, text, { mode: fs.statSync(file).mode })
  const digest = value => createHash('sha256').update(value).digest('hex')
  if (fs.realpathSync(snapshot.path) !== file || digest(fs.readFileSync(file)) !== snapshot.sha256) {
    throw new Error('Page or source revision changed since review')
  }
  fs.renameSync(replacement, file)
  process.stdout.write(JSON.stringify({ ...snapshot, sha256: digest(text) }))
} finally {
  if (staging) fs.rmSync(staging, { recursive: true, force: true })
  fs.rmdirSync(lock)
}
`
