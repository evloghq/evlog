import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { readdir, mkdir, appendFile, stat, unlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WideEvent } from '../../src/types'
import { defined } from '../helpers/defined'

import { writeBatchToFs, writeToFs, createFsDrain } from '../../src/adapters/fs'

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
  unlink: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

const mockedMkdir = vi.mocked(mkdir)
const mockedAppendFile = vi.mocked(appendFile)
const mockedReaddir = vi.mocked(readdir)

function mockReaddirNames(names: string[]) {
  mockedReaddir.mockResolvedValueOnce(names as unknown as Awaited<ReturnType<typeof readdir>>)
}

function getAppendFileContent(callIndex = 0): string {
  const args = defined(mockedAppendFile.mock.calls[callIndex], 'appendFile call')
  return String(args[1])
}
const mockedStat = vi.mocked(stat)
const mockedUnlink = vi.mocked(unlink)
const mockedWriteFile = vi.mocked(writeFile)

describe('fs adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T10:00:00.000Z'))
    vi.clearAllMocks()
    mockedMkdir.mockResolvedValue(undefined)
    mockedAppendFile.mockResolvedValue(undefined)
    mockedReaddir.mockResolvedValue([])
    mockedStat.mockRejectedValue(new Error('ENOENT'))
    mockedUnlink.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createTestEvent = (overrides?: Partial<WideEvent>): WideEvent => ({
    timestamp: '2026-03-14T10:00:00.000Z',
    level: 'info',
    service: 'test-service',
    environment: 'test',
    ...overrides,
  })

  describe('gitignore', () => {
    it('creates .gitignore inside .evlog/ directory on first write', async () => {
      await writeToFs(createTestEvent(), { dir: '.evlog/test-logs-1', pretty: false })

      expect(mockedWriteFile).toHaveBeenCalledWith(
        join('.evlog', '.gitignore'),
        '*\n',
        'utf-8',
      )
    })

    it('places .gitignore at the .evlog ancestor in monorepo paths', async () => {
      await writeToFs(createTestEvent(), { dir: 'apps/web/.evlog/logs', pretty: false })

      expect(mockedWriteFile).toHaveBeenCalledWith(
        join('apps/web/.evlog', '.gitignore'),
        '*\n',
        'utf-8',
      )
    })

    it('places .gitignore in dir itself when path has no .evlog segment', async () => {
      await writeToFs(createTestEvent(), { dir: '/tmp/custom-logs', pretty: false })

      expect(mockedWriteFile).toHaveBeenCalledWith(
        join('/tmp/custom-logs', '.gitignore'),
        '*\n',
        'utf-8',
      )
    })

    it('skips .gitignore creation when it already exists', async () => {
      mockedStat.mockResolvedValueOnce({ size: 0 } as Stats)

      await writeToFs(createTestEvent(), { dir: 'other/.evlog/logs', pretty: false })

      expect(mockedWriteFile).not.toHaveBeenCalled()
    })
  })

  describe('writeToFs', () => {
    it('creates directory and writes event as NDJSON', async () => {
      const event = createTestEvent({ action: 'test' })

      await writeToFs(event, { dir: '.evlog/logs', pretty: false })

      expect(mockedMkdir).toHaveBeenCalledWith('.evlog/logs', { recursive: true, mode: 0o700 })
      expect(mockedAppendFile).toHaveBeenCalledTimes(1)

      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      const content = getAppendFileContent()
      expect(filePath).toBe(join('.evlog/logs', '2026-03-14.jsonl'))
      expect(content).toBe(`${JSON.stringify(event) }\n`)
    })

    it('writes pretty JSON when pretty option is true', async () => {
      const event = createTestEvent()

      await writeToFs(event, { dir: '.evlog/logs', pretty: true })

      const content = getAppendFileContent()
      expect(content).toBe(`${JSON.stringify(event, null, 2) }\n`)
    })

    it('uses date-based filename', async () => {
      vi.setSystemTime(new Date('2025-12-25T15:30:00.000Z'))

      await writeToFs(createTestEvent(), { dir: 'logs', pretty: false })

      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      expect(filePath).toBe(join('logs', '2025-12-25.jsonl'))
    })
  })

  describe('writeBatchToFs', () => {
    it('writes multiple events as NDJSON lines', async () => {
      const events = [
        createTestEvent({ requestId: '1' }),
        createTestEvent({ requestId: '2' }),
        createTestEvent({ requestId: '3' }),
      ]

      await writeBatchToFs(events, { dir: '.evlog/logs', pretty: false })

      expect(mockedAppendFile).toHaveBeenCalledTimes(1)
      const content = getAppendFileContent()
      const lines = content.trimEnd().split('\n')
      expect(lines).toHaveLength(3)

      for (const line of lines) {
        const parsed = JSON.parse(line)
        expect(parsed.service).toBe('test-service')
      }
    })

    it('skips write when events array is empty', async () => {
      await writeBatchToFs([], { dir: '.evlog/logs', pretty: false })

      expect(mockedMkdir).not.toHaveBeenCalled()
      expect(mockedAppendFile).not.toHaveBeenCalled()
    })

    it('uses custom directory', async () => {
      await writeBatchToFs([createTestEvent()], { dir: '/var/log/app', pretty: false })

      expect(mockedMkdir).toHaveBeenCalledWith('/var/log/app', { recursive: true, mode: 0o700 })
      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      expect(filePath).toBe(join('/var/log/app', '2026-03-14.jsonl'))
    })
  })

  describe('file rotation (maxSizePerFile)', () => {
    it('uses base file when under size limit', async () => {
      mockedStat.mockResolvedValueOnce({ size: 500 } as Stats)

      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
        maxSizePerFile: 1024,
      })

      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      expect(filePath).toBe(join('.evlog/logs', '2026-03-14.jsonl'))
    })

    it('rotates to suffixed file when base file exceeds size limit', async () => {
      mockedStat
        .mockResolvedValueOnce({ size: 2048 } as Stats)
        .mockRejectedValueOnce(new Error('ENOENT'))

      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
        maxSizePerFile: 1024,
      })

      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      expect(filePath).toBe(join('.evlog/logs', '2026-03-14.1.jsonl'))
    })

    it('skips full rotated files and finds next available', async () => {
      mockedStat
        .mockResolvedValueOnce({ size: 2048 } as Stats)
        .mockResolvedValueOnce({ size: 2048 } as Stats)
        .mockResolvedValueOnce({ size: 2048 } as Stats)
        .mockRejectedValueOnce(new Error('ENOENT'))

      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
        maxSizePerFile: 1024,
      })

      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      expect(filePath).toBe(join('.evlog/logs', '2026-03-14.3.jsonl'))
    })

    it('uses base file when stat fails (new file)', async () => {
      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
        maxSizePerFile: 1024,
      })

      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      expect(filePath).toBe(join('.evlog/logs', '2026-03-14.jsonl'))
    })
  })

  describe('cleanup (maxFiles)', () => {
    it('deletes oldest files when exceeding maxFiles', async () => {
      mockReaddirNames([
        '2026-03-10.jsonl',
        '2026-03-11.jsonl',
        '2026-03-12.jsonl',
        '2026-03-13.jsonl',
        '2026-03-14.jsonl',
      ])

      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
        maxFiles: 3,
      })

      expect(mockedUnlink).toHaveBeenCalledTimes(2)
      expect(mockedUnlink).toHaveBeenCalledWith(join('.evlog/logs', '2026-03-10.jsonl'))
      expect(mockedUnlink).toHaveBeenCalledWith(join('.evlog/logs', '2026-03-11.jsonl'))
    })

    it('does not delete files when under maxFiles limit', async () => {
      mockReaddirNames([
        '2026-03-13.jsonl',
        '2026-03-14.jsonl',
      ])

      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
        maxFiles: 5,
      })

      expect(mockedUnlink).not.toHaveBeenCalled()
    })

    it('ignores non-jsonl files during cleanup', async () => {
      mockReaddirNames([
        '2026-03-10.jsonl',
        '2026-03-11.jsonl',
        '2026-03-12.jsonl',
        'README.md',
        '.gitkeep',
      ])

      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
        maxFiles: 2,
      })

      expect(mockedUnlink).toHaveBeenCalledTimes(1)
      expect(mockedUnlink).toHaveBeenCalledWith(join('.evlog/logs', '2026-03-10.jsonl'))
    })

    it('does not run cleanup when maxFiles is not set', async () => {
      await writeToFs(createTestEvent(), {
        dir: '.evlog/logs',
        pretty: false,
      })

      expect(mockedReaddir).not.toHaveBeenCalled()
    })
  })

  describe('createFsDrain', () => {
    const createDrainContext = (overrides?: Partial<WideEvent>) => ({
      event: createTestEvent(overrides),
      request: { method: 'GET', path: '/', requestId: 'r1' },
      headers: {},
    })

    afterEach(() => {
      delete process.env.NUXT_EVLOG_FS_DIR
      delete process.env.EVLOG_FS_DIR
    })

    it('returns a callable drain that writes events', async () => {
      const drain = createFsDrain({ dir: '.evlog/logs' })
      await drain(createDrainContext({ action: 'drain_test' }))
      expect(mockedAppendFile).toHaveBeenCalled()
    })

    it('uses default dir when no config is provided', async () => {
      const drain = createFsDrain()
      await drain(createDrainContext())
      const [filePath] = defined(mockedAppendFile.mock.calls[0], 'appendFile call')
      expect(filePath).toBe(join('.evlog/logs', '2026-03-14.jsonl'))
    })

    it('warns once and skips writes on edge runtime', async () => {
      process.env.NEXT_RUNTIME = 'edge'
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        vi.resetModules()
        const { createFsDrain: createFsDrainFresh } = await import('../../src/adapters/fs')
        const drain = createFsDrainFresh({ dir: '.evlog/logs' })

        await drain(createDrainContext({ action: 'edge_skip' }))
        await drain(createDrainContext({ action: 'edge_skip_again' }))

        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy.mock.calls[0]?.[0]).toContain('[evlog/fs]')
        expect(mockedAppendFile).not.toHaveBeenCalled()
      } finally {
        delete process.env.NEXT_RUNTIME
        warnSpy.mockRestore()
      }
    })

    it('warns once and disables itself when the directory is read-only', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        vi.resetModules()
        mockedAppendFile.mockRejectedValue(Object.assign(new Error('EROFS'), { code: 'EROFS' }))
        const { createFsDrain: createFsDrainFresh } = await import('../../src/adapters/fs')
        const drain = createFsDrainFresh({ dir: '/var/task/.evlog/logs' })

        await drain(createDrainContext({ action: 'readonly' }))
        await drain(createDrainContext({ action: 'readonly_again' }))

        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy.mock.calls[0]?.[0]).toContain('not writable')
        // The first batch attempts the write; the second never reaches it.
        expect(mockedAppendFile).toHaveBeenCalledTimes(1)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('disables itself when the directory exists but rejects the write', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        vi.resetModules()
        // `mkdir` is a no-op on an existing directory, so it succeeds even when
        // that directory is read-only. Only the append reveals it.
        mockedMkdir.mockResolvedValue(undefined)
        mockedAppendFile.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
        const { createFsDrain: createFsDrainFresh } = await import('../../src/adapters/fs')
        const drain = createFsDrainFresh({ dir: '/var/task/.evlog/logs' })

        await drain(createDrainContext())
        await drain(createDrainContext())

        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(mockedAppendFile).toHaveBeenCalledTimes(1)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('warns once when concurrent batches all fail their first write', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        vi.resetModules()
        mockedAppendFile.mockRejectedValue(Object.assign(new Error('EROFS'), { code: 'EROFS' }))
        const { createFsDrain: createFsDrainFresh } = await import('../../src/adapters/fs')
        const drain = createFsDrainFresh({ dir: '/var/task/.evlog/logs' })

        await Promise.all([
          drain(createDrainContext({ action: 'a' })),
          drain(createDrainContext({ action: 'b' })),
          drain(createDrainContext({ action: 'c' })),
        ])

        expect(warnSpy).toHaveBeenCalledTimes(1)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('reports a write failure that is not a permission problem', async () => {
      vi.resetModules()
      mockedAppendFile.mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }))
      const { createFsDrain: createFsDrainFresh } = await import('../../src/adapters/fs')
      const drain = createFsDrainFresh({ dir: '.evlog/logs' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await drain(createDrainContext())
        expect(errorSpy).toHaveBeenCalled()
        expect(String(errorSpy.mock.calls[0]?.[1])).toContain('ENOSPC')
      } finally {
        errorSpy.mockRestore()
      }
    })
  })
})
