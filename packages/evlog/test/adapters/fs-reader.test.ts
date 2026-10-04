import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFsLogs, tailFsLogs } from '../../src/adapters/fs'
import type { WideEvent } from '../../src/types'

function makeEvent(id: number, overrides?: Partial<WideEvent>): WideEvent {
  return {
    timestamp: '2026-03-14T10:00:00.000Z',
    level: 'info',
    service: 'test',
    environment: 'test',
    id,
    ...overrides,
  }
}

function ndjson(events: WideEvent[]): string {
  return `${events.map(e => JSON.stringify(e)).join('\n')}\n`
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evlog-fs-reader-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readFsLogs', () => {
  it('returns empty when directory does not exist', async () => {
    const events: WideEvent[] = []
    for await (const event of readFsLogs({ dir: join(dir, 'missing') })) {
      events.push(event)
    }
    expect(events).toEqual([])
  })

  it('iterates events from a single file in NDJSON order', async () => {
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      ndjson([makeEvent(1), makeEvent(2), makeEvent(3)]),
    )

    const events: number[] = []
    for await (const event of readFsLogs({ dir })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([1, 2, 3])
  })

  it('iterates files in chronological order', async () => {
    await writeFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(3), makeEvent(4)]))
    await writeFile(join(dir, '2026-03-13.jsonl'), ndjson([makeEvent(1), makeEvent(2)]))

    const events: number[] = []
    for await (const event of readFsLogs({ dir })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([1, 2, 3, 4])
  })

  it('handles rotated suffix files in correct order', async () => {
    await writeFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(1)]))
    await writeFile(join(dir, '2026-03-14.1.jsonl'), ndjson([makeEvent(2)]))
    await writeFile(join(dir, '2026-03-14.2.jsonl'), ndjson([makeEvent(3)]))

    const events: number[] = []
    for await (const event of readFsLogs({ dir })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([1, 2, 3])
  })

  it('reads events written with pretty: true, mixed with compact ones', async () => {
    const pretty = (event: WideEvent): string => JSON.stringify(event, null, 2)
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      `${pretty(makeEvent(1, { nested: { deep: { x: 1 } } }))}\n${JSON.stringify(makeEvent(2))}\n${pretty(makeEvent(3))}\n`,
    )

    const ids: number[] = []
    for await (const event of readFsLogs({ dir })) ids.push(event.id as number)
    expect(ids).toEqual([1, 2, 3])
  })

  it('skips malformed lines without throwing', async () => {
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      `${JSON.stringify(makeEvent(1))}\nnot-json\n${JSON.stringify(makeEvent(2))}\n`,
    )

    const events: number[] = []
    for await (const event of readFsLogs({ dir })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([1, 2])
  })

  it('filters by level (single value)', async () => {
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      ndjson([
        makeEvent(1, { level: 'info' }),
        makeEvent(2, { level: 'error' }),
        makeEvent(3, { level: 'warn' }),
      ]),
    )

    const events: number[] = []
    for await (const event of readFsLogs({ dir, level: 'error' })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([2])
  })

  it('filters by level (multiple values)', async () => {
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      ndjson([
        makeEvent(1, { level: 'info' }),
        makeEvent(2, { level: 'error' }),
        makeEvent(3, { level: 'warn' }),
      ]),
    )

    const events: number[] = []
    for await (const event of readFsLogs({ dir, level: ['error', 'warn'] })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([2, 3])
  })

  it('filters by since timestamp', async () => {
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      ndjson([
        makeEvent(1, { timestamp: '2026-03-14T08:00:00.000Z' }),
        makeEvent(2, { timestamp: '2026-03-14T10:00:00.000Z' }),
        makeEvent(3, { timestamp: '2026-03-14T12:00:00.000Z' }),
      ]),
    )

    const events: number[] = []
    for await (const event of readFsLogs({ dir, since: '2026-03-14T09:00:00.000Z' })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([2, 3])
  })

  it('filters by until timestamp', async () => {
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      ndjson([
        makeEvent(1, { timestamp: '2026-03-14T08:00:00.000Z' }),
        makeEvent(2, { timestamp: '2026-03-14T10:00:00.000Z' }),
        makeEvent(3, { timestamp: '2026-03-14T12:00:00.000Z' }),
      ]),
    )

    const events: number[] = []
    for await (const event of readFsLogs({ dir, until: new Date('2026-03-14T10:00:00.000Z') })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([1, 2])
  })

  it('skips entire files outside the date window', async () => {
    await writeFile(join(dir, '2026-03-13.jsonl'), ndjson([makeEvent(1)]))
    await writeFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(2)]))

    const events: number[] = []
    for await (const event of readFsLogs({ dir, since: '2026-03-14T00:00:00.000Z' })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([2])
  })

  it('applies a custom filter predicate', async () => {
    await writeFile(
      join(dir, '2026-03-14.jsonl'),
      ndjson([
        makeEvent(1, { service: 'api' }),
        makeEvent(2, { service: 'web' }),
      ]),
    )

    const events: number[] = []
    for await (const event of readFsLogs({ dir, filter: e => e.service === 'web' })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([2])
  })

  it('ignores non-jsonl files', async () => {
    await writeFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(1)]))
    await writeFile(join(dir, 'README.md'), '# nope')
    await writeFile(join(dir, 'corrupted.txt'), 'noise')

    const events: number[] = []
    for await (const event of readFsLogs({ dir })) {
      events.push(event.id as number)
    }
    expect(events).toEqual([1])
  })
})

describe('tailFsLogs', () => {
  it('yields existing events then waits for new ones', async () => {
    await writeFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(1), makeEvent(2)]))

    const ac = new AbortController()
    const collected: number[] = []

    const consumer = (async () => {
      for await (const event of tailFsLogs({ dir, pollIntervalMs: 50, signal: ac.signal })) {
        collected.push(event.id as number)
        if (collected.length === 4) {
          ac.abort()
          break
        }
      }
    })()

    await new Promise(r => setTimeout(r, 100))
    await appendFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(3), makeEvent(4)]))

    await consumer
    expect(collected).toEqual([1, 2, 3, 4])
  })

  it('skips existing events when fromEnd is true', async () => {
    await writeFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(1), makeEvent(2)]))

    const ac = new AbortController()
    const collected: number[] = []

    const consumer = (async () => {
      for await (const event of tailFsLogs({
        dir,
        pollIntervalMs: 50,
        signal: ac.signal,
        fromEnd: true,
      })) {
        collected.push(event.id as number)
        if (collected.length === 1) {
          ac.abort()
          break
        }
      }
    })()

    await new Promise(r => setTimeout(r, 100))
    await appendFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(99)]))

    await consumer
    expect(collected).toEqual([99])
  })

  it('detects newly appearing log files', async () => {
    const ac = new AbortController()
    const collected: number[] = []

    const consumer = (async () => {
      for await (const event of tailFsLogs({
        dir,
        pollIntervalMs: 50,
        signal: ac.signal,
      })) {
        collected.push(event.id as number)
        if (collected.length === 2) {
          ac.abort()
          break
        }
      }
    })()

    await new Promise(r => setTimeout(r, 100))
    await writeFile(join(dir, '2026-03-14.jsonl'), ndjson([makeEvent(10)]))
    await new Promise(r => setTimeout(r, 200))
    await writeFile(join(dir, '2026-03-15.jsonl'), ndjson([makeEvent(11)]))

    await consumer
    expect(collected).toEqual([10, 11])
  })

  it('handles partial line writes across polls', async () => {
    const file = join(dir, '2026-03-14.jsonl')
    await writeFile(file, '')

    const ac = new AbortController()
    const collected: number[] = []

    const consumer = (async () => {
      for await (const event of tailFsLogs({
        dir,
        pollIntervalMs: 50,
        signal: ac.signal,
        fromEnd: true,
      })) {
        collected.push(event.id as number)
        if (collected.length === 1) {
          ac.abort()
          break
        }
      }
    })()

    await new Promise(r => setTimeout(r, 100))
    const json = JSON.stringify(makeEvent(42))
    await appendFile(file, json.slice(0, 10))
    await new Promise(r => setTimeout(r, 100))
    await appendFile(file, `${json.slice(10)}\n`)

    await consumer
    expect(collected).toEqual([42])
  })

  it('assembles a pretty-printed event appended across polls', async () => {
    const file = join(dir, '2026-03-14.jsonl')
    await writeFile(file, '')

    const ac = new AbortController()
    const collected: number[] = []

    const consumer = (async () => {
      for await (const event of tailFsLogs({ dir, pollIntervalMs: 50, signal: ac.signal, fromEnd: true })) {
        collected.push(event.id as number)
        if (collected.length === 2) {
          ac.abort()
          break
        }
      }
    })()

    await new Promise(r => setTimeout(r, 100))
    const lines = JSON.stringify(makeEvent(7, { nested: { a: 1 } }), null, 2).split('\n')
    await appendFile(file, `${lines.slice(0, 4).join('\n')}\n`)
    await new Promise(r => setTimeout(r, 100))
    await appendFile(file, `${lines.slice(4).join('\n')}\n${JSON.stringify(makeEvent(8))}\n`)

    await consumer
    expect(collected).toEqual([7, 8])
  })

  it('aborts cleanly via AbortSignal', async () => {
    const ac = new AbortController()
    const start = Date.now()

    const consumer = (async () => {
      const out: WideEvent[] = []
      for await (const event of tailFsLogs({
        dir,
        pollIntervalMs: 50,
        signal: ac.signal,
        fromEnd: true,
      })) {
        out.push(event)
      }
      return out
    })()

    setTimeout(() => ac.abort(), 100)
    const result = await consumer

    expect(result).toEqual([])
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
