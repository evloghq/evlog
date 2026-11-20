import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

// Talks to the deployed agent, never the local one. The URL and the bypass
// secret come from .env.local, so nothing is pasted into a prompt or a chat.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
const url = process.env.EVE_REMOTE_URL
if (!url) {
  process.stderr.write('Set EVE_REMOTE_URL in .env.local to the deployed agent, such as https://clearbill-agent.vercel.app\n')
  process.exit(1)
}
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const host = new URL(url).host
const args = ['remote', 'connect', '--url', url, '--name', `clearbill · REMOTE ${host} · reads Vercel runtime logs`,
  ...(bypass ? ['-H', `x-vercel-protection-bypass: ${bypass}`] : []), ...process.argv.slice(2)]
spawn('eve', args, { stdio: 'inherit', shell: process.platform === 'win32' }).on('exit', code => process.exit(code ?? 1))
