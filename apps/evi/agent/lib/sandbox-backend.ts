import type { SandboxSession } from 'eve/sandbox'
import { DockerSandbox } from 'eve/sandbox/docker'
import { VercelSandbox } from 'eve/sandbox/vercel'

type PrepareSandbox = (sandbox: SandboxSession) => Promise<void>

type VercelEnvironment = ReturnType<typeof VercelSandbox.environment>
type SandboxEnvironment = VercelEnvironment | ReturnType<typeof DockerSandbox.environment>

export function createSandboxEnvironment(deployedOnVercel: boolean, prepare: PrepareSandbox): SandboxEnvironment {
  if (!deployedOnVercel) return DockerSandbox.environment({ prepare })
  return VercelSandbox.environment({
    prepare,
    resources: { vcpus: 4 },
    keepLastSnapshots: { count: 1, deleteEvicted: true },
    snapshotExpiration: 14 * 24 * 60 * 60 * 1000,
  })
}

/** Only Vercel Sandbox rewrites request headers at its firewall, which is how a token reaches git without entering the sandbox. */
export function isVercelEnvironment(environment: SandboxEnvironment): environment is VercelEnvironment {
  return environment.provider === 'vercel'
}
