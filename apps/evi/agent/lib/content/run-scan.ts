import type { SandboxSession } from 'eve/sandbox'
import { scanCommand } from './scan'
import type { ScanInput } from './scan'
import { withDeadline } from './deadline'

type ScanSandbox = Pick<SandboxSession, 'run' | 'writeTextFile' | 'removePath'>

export async function runContentScan(sandbox: ScanSandbox, input: ScanInput, timeoutMs = 30_000) {
  const { command, passage } = scanCommand(input)
  try {
    return await withDeadline(async (abortSignal) => {
      if (passage !== undefined) await sandbox.writeTextFile({ ...passage, abortSignal })
      abortSignal.throwIfAborted()
      return await sandbox.run({ command, abortSignal })
    }, timeoutMs)
  } finally {
    if (passage !== undefined) {
      await withDeadline(abortSignal => sandbox.removePath({ path: passage.path, force: true, abortSignal }), 5000)
    }
  }
}
