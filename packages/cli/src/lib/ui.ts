import type { CheckSummary } from '../core/output'
import { exitCodeFor, setExitCode, writeHuman, writeJson } from '../core/output'

/**
 * Output helpers for a command run — the only place commands should write
 * to the terminal or set an exit code.
 *
 * - {@link CliUi.human} → stderr
 * - {@link CliUi.json} → stdout (+ `schemaVersion`)
 * - {@link CliUi.exit} → `process.exitCode` from a check summary (or raw code)
 * - {@link CliUi.done} → human **or** json + exit in one call
 */
export interface CliUi {
  /** Human report on stderr. */
  human: (text: string) => void
  /** Machine payload on stdout (adds `schemaVersion`). */
  json: (payload: Record<string, unknown>) => void
  /** Set exit code from a check summary (`fail > 0` → 1) or a raw code. */
  exit: (summaryOrCode: CheckSummary | number) => void
  /**
   * Emit the command result: JSON when `jsonMode` (or constructor `json`) is
   * on, otherwise the human string; then set the exit code from `summary`.
   */
  done: (options: {
    human?: string
    json?: Record<string, unknown>
    summary?: CheckSummary
    jsonMode?: boolean
  }) => void
}

/** Build a {@link CliUi} bound to the current process streams. */
export function createUi(options: { json?: boolean } = {}): CliUi {
  const ui: CliUi = {
    human: writeHuman,
    json: writeJson,
    exit(summaryOrCode) {
      setExitCode(typeof summaryOrCode === 'number' ? summaryOrCode : exitCodeFor(summaryOrCode))
    },
    done({ human, json, summary, jsonMode }) {
      const useJson = jsonMode ?? options.json === true
      if (useJson) {
        if (json) writeJson(json)
      } else if (human !== undefined) {
        writeHuman(human)
      }
      if (summary) ui.exit(summary)
    },
  }
  return ui
}
