// The `eve remote connect` arguments for EVE_REMOTE_URL. The deployment
// protection bypass secret never goes on the command line: eve reads
// VERCEL_AUTOMATION_BYPASS_SECRET from the environment itself, and only once it
// has matched the URL to the linked Vercel deployment. Forwarded arguments may
// not name another URL or header, which would carry that secret elsewhere.
const PINNED = /^(?:-u|--url|-H|--header)(?:=|$)|^-[uH]./

export function remoteArgs(env, forwarded) {
  const raw = env.EVE_REMOTE_URL
  if (!raw) throw new Error('Set EVE_REMOTE_URL in .env.local to the deployed agent, such as https://clearbill-agent.vercel.app')
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`EVE_REMOTE_URL must be an https URL without credentials, not ${url.protocol}//${url.host}`)
  const pinned = forwarded.find(arg => PINNED.test(arg))
  if (pinned) throw new Error(`${pinned} is not accepted: pnpm dev:remote talks to EVE_REMOTE_URL only. Run eve remote connect yourself for another target`)
  return ['remote', 'connect', '--url', url.origin, '--name', `clearbill · REMOTE ${url.host} · reads Vercel runtime logs`, ...forwarded]
}
