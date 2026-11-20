import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const readFsLogs = vi.hoisted(() => vi.fn(async function* () {
  yield { timestamp: '2026-10-01T11:00:00.000Z', level: 'info', customer: { email: 'private@example.invalid' } }
}))
vi.mock('evlog/fs', () => ({ readFsLogs }))

afterEach(() => {
  vi.unstubAllEnvs()
  readFsLogs.mockClear()
})

// Loaded by URL so tsc keeps example sources out of this package's declaration build.
const example = (path: string) => import(new URL(`../../../examples/eve/${path}`, import.meta.url).href)
const { remoteArgs } = await example('scripts/remote-args.mjs') as {
  remoteArgs: (env: Record<string, string | undefined>, forwarded: string[]) => string[]
}

const SECRET = 'dummy-bypass-secret'
const REMOTE = 'https://intended.example.invalid'

describe('examples/eve pnpm dev:remote', () => {
  it('never puts the bypass secret on the command line', () => {
    const args = remoteArgs({ EVE_REMOTE_URL: REMOTE, VERCEL_AUTOMATION_BYPASS_SECRET: SECRET }, ['--print', 'hi'])
    expect(args).toEqual(['remote', 'connect', '--url', REMOTE, '--name', 'clearbill · REMOTE intended.example.invalid · reads Vercel runtime logs', '--print', 'hi'])
    expect(args.join(' ')).not.toContain(SECRET)
    expect(args).not.toContain('-H')
  })

  it('refuses a forwarded URL or header that would point the session elsewhere', () => {
    for (const forwarded of [['--url', 'https://other.example.invalid'], ['--url=https://other.example.invalid'], ['-u', 'x'], ['-uhttps://other.example.invalid'], ['-H', 'a: b'], ['--header=a: b'], ['-Ha: b']]) {
      expect(() => remoteArgs({ EVE_REMOTE_URL: REMOTE }, forwarded), forwarded.join(' ')).toThrow('is not accepted')
    }
  })

  it('refuses a remote URL that is not https, or carries credentials', () => {
    expect(() => remoteArgs({}, [])).toThrow('Set EVE_REMOTE_URL')
    expect(() => remoteArgs({ EVE_REMOTE_URL: 'http://agent.example.invalid' }, [])).toThrow('must be an https URL')
    expect(() => remoteArgs({ EVE_REMOTE_URL: 'https://user:pass@agent.example.invalid' }, [])).toThrow('must be an https URL')
  })

  /* What the script relies on instead of -H: eve's own gate on the secret in the environment. */
  it('leaves the secret to eve, which sends it only after verifying the deployment behind the URL', async () => {
    const eve = realpathSync(join(import.meta.dirname, '../node_modules/eve'))
    const { createDevelopmentCredentialGate } = await import(join(eve, 'dist/src/services/dev-client/credential-gate.js'))
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', SECRET)
    const gate = createDevelopmentCredentialGate(REMOTE)
    expect(await gate.resolveBypassHeaders()).toEqual({})
    expect(() => gate.authorize({ target: { origin: 'https://other.example.invalid' }, resolveToken: () => 'oidc' })).toThrow('does not match')
    expect(await gate.resolveBypassHeaders()).toEqual({})
    gate.authorize({ target: { origin: REMOTE }, resolveToken: () => 'oidc' })
    expect(await gate.resolveBypassHeaders()).toEqual({ 'x-vercel-protection-bypass': SECRET })
  })
})

describe('examples/eve /api/demo/logs', () => {
  const route = () => example('app/api/demo/logs/route.ts') as Promise<{ GET: () => Promise<Response> }>

  it('serves stored events in development only', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const body = await (await (await route()).GET()).json() as { events: unknown[] }
    expect(body.events).toHaveLength(1)
  })

  it('answers 404 and reads nothing anywhere else', async () => {
    for (const env of ['production', 'test', '']) {
      vi.stubEnv('NODE_ENV', env)
      const response = await (await route()).GET()
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('')
    }
    expect(readFsLogs).not.toHaveBeenCalled()
  })
})
