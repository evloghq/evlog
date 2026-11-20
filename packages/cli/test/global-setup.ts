import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Runs once, before the workers start, so every test file and every CLI a test
 * spawns inherits it. Without it a test that runs a command records the run in
 * the contributor's own outbox, and their next real `evlog` sends it.
 */
export default function setup(): () => void {
  const configHome = mkdtempSync(join(tmpdir(), 'evlog-cli-test-'))
  process.env.XDG_CONFIG_HOME = configHome
  process.env.EVLOG_TELEMETRY = '0'
  return () => rmSync(configHome, { recursive: true, force: true })
}
