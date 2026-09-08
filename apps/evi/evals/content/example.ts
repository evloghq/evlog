import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export function executeExample(sample: string, root: string, timeoutMs = 10_000): void {
  execFileSync(process.execPath, ['--input-type=module'], {
    cwd: resolve(root, 'packages/evlog'),
    input: sample,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  })
}
