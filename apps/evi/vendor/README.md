# Vendored packages

`eve` is pinned exactly because each release rotates the extension tool contract, and eve refuses a
mounted extension whose manifest requires a dropped contract (the build then fails with
`Selected module binding "extensions/<name>.ts" has no compile or runtime usage`). The tarball here
is built against tool contract 78; `@github-tools/eve-extension` 0.8.1 on the registry is built
against tool contract 76, and eve 0.74.0 accepts both. When bumping eve, check every extension
manifest (`dist/extension/_manifest.json`) against `EXTENSION_CAPABILITY_CONTRACTS` in
`eve/dist/src/compiler/extension-compatibility.js`, and rebuild the tarball when its contract is dropped.

## `agent-browser-eve-0.38.2-eve0.74.0.tgz`

`@agent-browser/eve` built from [vercel-labs/agent-browser#1945](https://github.com/vercel-labs/agent-browser/pull/1945)
at commit `15dd3b4e6ee21c26b7b5f8048bbe73f31182803c` (the source npm published as 0.38.2, which
ships built against eve 0.57 and contract 44), with `agent-browser-eve-0.38.2-eve0.74.0.patch`
applied: eve 0.64 sessions no longer carry an `id`, so the patch makes `EveSandboxSession.id`
optional and derives the browser session name and the per-sandbox install lock without it, and the
build is pinned to eve 0.74.0 so the manifest carries a contract eve 0.74 accepts.

Reproduce:

```sh
git clone --depth 1 https://github.com/vercel-labs/agent-browser
cd agent-browser && git fetch --depth 1 origin 15dd3b4e6ee21c26b7b5f8048bbe73f31182803c && git checkout FETCH_HEAD
git apply <path-to>/agent-browser-eve-0.38.2-eve0.74.0.patch
pnpm install --frozen-lockfile --ignore-scripts --filter "@agent-browser/eve..."
pnpm -C packages/@agent-browser/sandbox run build
pnpm -C packages/@agent-browser/eve run build
pnpm -C packages/@agent-browser/eve pack
```

Remove this file and point `@agent-browser/eve` back at the registry once upstream publishes a
release built against eve 0.74 or newer.
