import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { remoteArgs } from './remote-args.mjs'

// Talks to the deployed agent, never the local one. The URL and the bypass
// secret come from .env.local, so nothing is pasted into a prompt or a chat.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
let args
try {
  args = remoteArgs(process.env, process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
spawn('eve', args, { stdio: 'inherit', shell: process.platform === 'win32' }).on('exit', code => process.exit(code ?? 1))
