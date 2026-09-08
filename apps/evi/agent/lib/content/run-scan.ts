import type { SandboxSession } from 'eve/sandbox'
import { scanCommand } from './scan'
import type { ScanInput } from './scan'
import { withDeadline } from './deadline'

type ScanSandbox = Pick<SandboxSession, 'run' | 'writeTextFile' | 'removePath'>

export async function runContentScan(sandbox: ScanSandbox, input: ScanInput, timeoutMs = 30_000) {
  const { command, passage } = scanCommand(input)
  let scanFailure: { error: unknown } | undefined
  try {
    return await withDeadline(async (abortSignal) => {
      if (passage !== undefined) await sandbox.writeTextFile({ ...passage, abortSignal })
      abortSignal.throwIfAborted()
      return await sandbox.run({ command, abortSignal })
    }, timeoutMs)
  } catch (error) {
    scanFailure = { error }
    throw error
  } finally {
    if (passage !== undefined) {
      try {
        await withDeadline(abortSignal => sandbox.removePath({ path: passage.path, force: true, abortSignal }), 5000)
      } catch (cleanupError) {
        if (scanFailure) {
          throw new AggregateError(
            [scanFailure.error, cleanupError],
            `Content scan failed: ${String(scanFailure.error)}. Cleanup also failed: ${String(cleanupError)}`,
            { cause: scanFailure.error },
          )
        }
        throw cleanupError
      }
    }
  }
}
