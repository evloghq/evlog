import { defaultBackend, defineSandbox } from 'eve/sandbox'

/** Each content session has its own checkout; execution dependencies stay in the parent sandbox. */
export default defineSandbox({
  backend: defaultBackend({
    vercel: {
      resources: { vcpus: 2 },
      // One day is the platform floor (Vercel rejects anything shorter) and
      // matches the pass's cadence.
      snapshotExpiration: 24 * 60 * 60 * 1000,
    },
  }),
  revalidationKey: () => 'evlog-content-workspace-v2',
  async bootstrap({ use }) {
    const sandbox = await use()
    await sandbox.run({ command: 'git clone --depth 50 https://github.com/evloghq/evlog.git repo' })
    await sandbox.run({ command: 'git config --global user.name "evlogai[bot]" && git config --global user.email "evlogai[bot]@users.noreply.github.com"' })
  },
  async onSession({ use }) {
    const sandbox = await use()
    // The template snapshot is owned by the builder uid, not the session user;
    // without these entries every git command dies on "dubious ownership".
    await sandbox.run({ command: 'git config --global --add safe.directory /workspace && git config --global --add safe.directory /workspace/repo' })
    await sandbox.run({ command: 'cd repo && git fetch origin main && git checkout -B main origin/main' })
  },
})
