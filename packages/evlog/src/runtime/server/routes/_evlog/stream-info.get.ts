import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineEventHandler, getHeader, setResponseHeaders } from 'h3'
import { isLoopbackUrl } from '../../../../shared/loopback'

/**
 * Discovery endpoint for the local evlog stream server. Reads
 * `<cwd>/.evlog/stream.url` and returns the URL so a browser tab (or any
 * other consumer that reaches the user's HTTP server) can find the
 * mini-server's port without hard-coding it.
 *
 * Returns `{ url: null }` when the stream server isn't running — the
 * consumer should treat that as "not available" and not error.
 *
 * Cross-origin reads are allowed from loopback origins only, so a local tool
 * on another port can read the URL and an unrelated site cannot.
 */
export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Vary': 'Origin' })
  const origin = getHeader(event, 'origin')
  if (origin && isLoopbackUrl(origin)) {
    setResponseHeaders(event, { 'Access-Control-Allow-Origin': origin })
  }

  try {
    const path = join(process.cwd(), '.evlog', 'stream.url')
    const url = (await readFile(path, 'utf-8')).trim()
    return { url: url || null }
  } catch {
    return { url: null }
  }
})
