import { afterEach, expect, it, vi } from 'vitest'
import { runContentScan } from './run-scan'

afterEach(() => vi.useRealTimers())

it('removes the staged passage when the shell is killed before its EXIT trap', async () => {
  const sandbox = {
    run: vi.fn().mockRejectedValue(new Error('shell killed')),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    removePath: vi.fn().mockResolvedValue(undefined),
  }
  await expect(runContentScan(sandbox, { text: 'Draft.' })).rejects.toThrow('shell killed')
  expect(sandbox.removePath).toHaveBeenCalledWith(expect.objectContaining({
    path: sandbox.writeTextFile.mock.calls[0][0].path,
    force: true,
  }))
})

it('aborts and cleans up even if the backend never delivers its exit event', async () => {
  vi.useFakeTimers()
  const sandbox = {
    run: vi.fn().mockImplementation(() => new Promise(() => {})),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    removePath: vi.fn().mockResolvedValue(undefined),
  }
  const result = expect(runContentScan(sandbox, { text: 'Draft.' }, 30)).rejects.toThrow('exceeded 30ms')
  await vi.advanceTimersByTimeAsync(30)
  await result
  expect(sandbox.run.mock.calls[0][0].abortSignal.aborted).toBe(true)
  expect(sandbox.removePath).toHaveBeenCalledWith(expect.objectContaining({ path: sandbox.writeTextFile.mock.calls[0][0].path }))
})

it('cleans up a partially written passage and does not launch the scanner', async () => {
  const sandbox = {
    run: vi.fn(),
    writeTextFile: vi.fn().mockRejectedValue(new Error('partial upload')),
    removePath: vi.fn().mockResolvedValue(undefined),
  }
  await expect(runContentScan(sandbox, { text: 'Draft.' })).rejects.toThrow('partial upload')
  expect(sandbox.run).not.toHaveBeenCalled()
  expect(sandbox.removePath).toHaveBeenCalledOnce()
})

it('reports cleanup failure instead of claiming the staged content was removed', async () => {
  const sandbox = {
    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' }),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    removePath: vi.fn().mockRejectedValue(new Error('cleanup failed')),
  }
  await expect(runContentScan(sandbox, { text: 'Draft.' })).rejects.toThrow('cleanup failed')
})

it('bounds cleanup when the sandbox file API stops responding', async () => {
  vi.useFakeTimers()
  const sandbox = {
    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' }),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    removePath: vi.fn().mockImplementation(() => new Promise(() => {})),
  }
  const result = expect(runContentScan(sandbox, { text: 'Draft.' })).rejects.toThrow('exceeded 5000ms')
  await vi.advanceTimersByTimeAsync(5000)
  await result
  expect(sandbox.removePath.mock.calls[0][0].abortSignal.aborted).toBe(true)
})
