import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { cliErrors } from '../errors'
import type { FileAction } from './wiring'

/**
 * Write the planned files in order.
 *
 * @throws `cli.WRITE_FAILED` at the first file that cannot be written, naming
 * it and the files written before it. The files after it are not attempted.
 */
export async function writeActions(actions: readonly FileAction[]): Promise<void> {
  const written: string[] = []
  for (const action of actions) {
    try {
      await mkdir(dirname(action.path), { recursive: true })
      await writeFile(action.path, action.contents, 'utf8')
    } catch (error) {
      throw cliErrors.WRITE_FAILED({
        file: action.relative,
        reason: (error as NodeJS.ErrnoException).code ?? (error as Error).message,
        written,
        cause: error as Error,
      })
    }
    written.push(action.relative)
  }
}
