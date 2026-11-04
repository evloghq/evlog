import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeBatchToFs } from '../../src/adapters/fs'
import { makeWideEvent } from '../helpers/events'

async function modeOf(path: string): Promise<string> {
  return ((await stat(path)).mode & 0o777).toString(8)
}

let root: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-14T10:00:00.000Z'))
  root = await mkdtemp(join(tmpdir(), 'evlog-fs-permissions-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('fs drain permissions', () => {
  it('creates every missing log directory readable by the owner only', async () => {
    const dir = join(root, '.evlog', 'logs')

    await writeBatchToFs([makeWideEvent()], { dir, pretty: false })

    expect(await modeOf(join(root, '.evlog'))).toBe('700')
    expect(await modeOf(dir)).toBe('700')
  })

  it('creates each log file readable by the owner only, rotated ones included', async () => {
    const dir = join(root, 'logs')

    await writeBatchToFs([makeWideEvent()], { dir, pretty: false, maxSizePerFile: 1 })
    await writeBatchToFs([makeWideEvent()], { dir, pretty: false, maxSizePerFile: 1 })

    const files = (await readdir(dir)).filter(f => f.endsWith('.jsonl')).sort()
    expect(files).toEqual(['2026-03-14.1.jsonl', '2026-03-14.jsonl'])
    for (const file of files) {
      expect(await modeOf(join(dir, file))).toBe('600')
    }
  })

  it('leaves an existing directory and file with the mode they already have', async () => {
    const dir = join(root, 'logs')
    const file = join(dir, '2026-03-14.jsonl')
    await mkdir(dir)
    await chmod(dir, 0o755)
    await writeFile(file, '')
    await chmod(file, 0o644)

    await writeBatchToFs([makeWideEvent()], { dir, pretty: false })

    expect(await modeOf(dir)).toBe('755')
    expect(await modeOf(file)).toBe('644')
  })
})
