import { ampThreadUrl, parseAmpThreadId } from './route'

export type AmpThreadStatus = 'running' | 'idle' | 'unknown'

export interface AmpListedThread {
  readonly id: string
  readonly title: string | null
  readonly url: string
  readonly labels: readonly string[]
  readonly status: AmpThreadStatus
}

export interface AmpProgress {
  readonly status: AmpThreadStatus
  readonly prUrl: string | null
  readonly files: readonly string[]
  readonly excerpt: string | null
  readonly key: string
}

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/
const FILE_PATH = /\b(?:apps|packages|src|examples|scripts)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g
const RUNNING = new Set(['running', 'active', 'in_progress', 'in-progress', 'busy', 'working'])
const IDLE = new Set(['idle', 'complete', 'completed', 'done', 'stopped', 'archived', 'finished'])

/** Key stored at launch so the first empty status poll does not post "still working". */
export const AMP_LAUNCH_PROGRESS_KEY = progressKey('running', null, [])

export function parseAmpThreadList(output: string): AmpListedThread[] {
  const payload = extractJson(output)
  const rows = jsonRows(payload)
  const threads: AmpListedThread[] = []
  for (const row of rows) {
    const parsed = listedThread(row)
    if (parsed) threads.push(parsed)
  }
  return threads
}

export function pickAmpThread(
  threads: readonly AmpListedThread[],
  query: { readonly threadId?: string, readonly issue?: string },
): AmpListedThread | null {
  if (query.threadId) {
    const id = parseAmpThreadId(query.threadId)
    if (id) return threads.find(thread => thread.id === id) ?? null
  }
  if (query.issue) {
    const needle = query.issue.trim().toLowerCase()
    return threads.find(thread =>
      (thread.title !== null && titleCarriesIssue(thread.title, needle))
      || thread.labels.some(label => label.toLowerCase() === needle),
    ) ?? null
  }
  return null
}

export function digestAmpProgress(input: {
  readonly markdown: string
  readonly listed?: AmpListedThread | null
}): AmpProgress {
  const prUrl = resultingPrUrl(input.markdown)
  const files = uniqueFiles(input.markdown)
  const excerpt = lastExcerpt(input.markdown)
  const listedStatus = input.listed?.status ?? 'unknown'
  const markdownStatus = statusFromMarkdown(input.markdown)
  const status = listedStatus !== 'unknown' ? listedStatus : markdownStatus !== 'unknown' ? markdownStatus : prUrl === null ? 'unknown' : 'idle'
  return { status, prUrl, files, excerpt, key: progressKey(status, prUrl, files) }
}

export function ampProgressUpdate(
  progress: AmpProgress,
  previousKey: string | null,
  threadId: string,
): string | null {
  if (progress.key === previousKey) return null
  if (progress.prUrl !== null && progress.status === 'running') {
    return `Amp opened ${progress.prUrl} and is still working.`
  }
  if (progress.prUrl !== null && progress.status !== 'running') {
    return `Amp finished. Pull request: ${progress.prUrl}`
  }
  if (progress.status === 'idle') {
    return progress.excerpt === null ? `Amp finished on ${threadId}.` : `Amp finished on ${threadId}: ${progress.excerpt}`
  }
  if (progress.files.length > 0) {
    return `Amp is still working on ${threadId} (${progress.files.slice(0, 3).join(', ')}).`
  }
  return `Amp is still working on ${threadId}.`
}

function titleCarriesIssue(title: string, issue: string): boolean {
  const hay = title.toLowerCase()
  if (hay.startsWith(`${issue}:`) || hay.includes(` ${issue}:`)) return true
  const escaped = issue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(title)
}

function resultingPrUrl(markdown: string): string | null {
  const opened = /(?:opened|pull request:)\s+(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/i.exec(markdown)
  if (opened?.[1]) return opened[1]
  const matches = markdown.match(new RegExp(PR_URL.source, 'g'))
  return matches?.[matches.length - 1] ?? null
}

function progressKey(status: AmpThreadStatus, prUrl: string | null, files: readonly string[]): string {
  const phase = status === 'idle' ? 'idle' : 'running'
  return `${phase}|${prUrl ?? ''}|${files.join(',')}`
}

function statusFromMarkdown(markdown: string): AmpThreadStatus {
  const labelled = /\bstatus\b[:\s*]*([A-Za-z_-]+)/i.exec(markdown)
  if (labelled) return normalizeStatus(labelled[1] ?? '')
  return 'unknown'
}

function lastExcerpt(markdown: string): string | null {
  const blocks = markdown.split(/\n{2,}/)
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block === undefined) continue
    const text = block.replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim()
    if (text.length === 0) continue
    if (text.startsWith('|') || text.startsWith('```') || text.startsWith('- ') || text.startsWith('* ')) continue
    if (PR_URL.test(text) && text.replace(PR_URL, '').trim().length === 0) continue
    return text.slice(0, 240)
  }
  return null
}

function uniqueFiles(markdown: string): string[] {
  const found = markdown.match(FILE_PATH) ?? []
  const seen = new Set<string>()
  const files: string[] = []
  for (const path of found) {
    if (path.includes('node_modules/') || seen.has(path)) continue
    seen.add(path)
    files.push(path)
    if (files.length === 5) break
  }
  return files
}

function listedThread(value: unknown): AmpListedThread | null {
  const row = asRecord(value)
  if (row === null) return null
  const id = parseAmpThreadId(stringField(row, 'id') ?? stringField(row, 'session_id') ?? stringField(row, 'threadId') ?? '')
  const url = stringField(row, 'url') ?? ampThreadUrl(id)
  if (id === null || url === null) return null
  const title = stringField(row, 'title') ?? stringField(row, 'name') ?? null
  const labels = parseLabels(row.labels)
  const status = statusFromRow(row)
  return { id, title, url, labels, status }
}

function statusFromRow(row: Record<string, unknown>): AmpThreadStatus {
  if (row.running === true) return 'running'
  if (row.running === false || row.archived === true) return 'idle'
  const named = stringField(row, 'status') ?? stringField(row, 'state')
  if (named) return normalizeStatus(named)
  return 'unknown'
}

function normalizeStatus(value: string): AmpThreadStatus {
  const key = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (RUNNING.has(key)) return 'running'
  if (IDLE.has(key)) return 'idle'
  return 'unknown'
}

function parseLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const labels: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') {
      labels.push(item)
      continue
    }
    const row = asRecord(item)
    const name = row === null ? null : stringField(row, 'name') ?? stringField(row, 'label')
    if (name) labels.push(name)
  }
  return labels
}

function jsonRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const row = asRecord(payload)
  if (row === null) return []
  for (const key of ['threads', 'items', 'data', 'results']) {
    const value = row[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function extractJson(output: string): unknown | null {
  const trimmed = output.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const startObj = trimmed.indexOf('{')
    const startArr = trimmed.indexOf('[')
    const starts = [startObj, startArr].filter(index => index >= 0)
    if (starts.length === 0) return null
    const slice = trimmed.slice(Math.min(...starts))
    try {
      return JSON.parse(slice)
    } catch {
      for (const line of trimmed.split(/\r?\n/)) {
        const text = line.trim()
        if (!text.startsWith('{') && !text.startsWith('[')) continue
        try {
          return JSON.parse(text)
        } catch {
          continue
        }
      }
      return null
    }
  }
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
