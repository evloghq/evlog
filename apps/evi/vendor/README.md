# Vendored packages

`eve` is pinned exactly because each release rotates the extension tool contract, and eve refuses a
mounted extension whose manifest requires a dropped contract (the build then fails with
`Selected module binding "extensions/<name>.ts" has no compile or runtime usage`). The tarball here
and `@github-tools/eve-extension` 0.8.0 on the registry are built against tool contract 54, which
eve 0.71.0 still accepts. When bumping eve, check every extension manifest
(`dist/extension/_manifest.json`) against `EXTENSION_CAPABILITY_CONTRACTS` in
`eve/dist/src/compiler/extension-compatibility.js`, and rebuild the tarball when its contract is dropped.

## `agent-browser-eve-0.38.1-eve0.64.1.tgz`

`@agent-browser/eve` built from [vercel-labs/agent-browser#1945](https://github.com/vercel-labs/agent-browser/pull/1945)
at commit `15dd3b4e6ee21c26b7b5f8048bbe73f31182803c`, with `agent-browser-eve-0.38.1-eve0.64.1.patch`
applied: eve 0.64 sessions no longer carry an `id`, so the patch makes `EveSandboxSession.id`
optional and derives the browser session name and the per-sandbox install lock without it.

Reproduce:

```sh
git clone --depth 1 https://github.com/vercel-labs/agent-browser
cd agent-browser && git fetch --depth 1 origin 15dd3b4e6ee21c26b7b5f8048bbe73f31182803c && git checkout FETCH_HEAD
git apply <path-to>/agent-browser-eve-0.38.1-eve0.64.1.patch
pnpm install --frozen-lockfile --ignore-scripts --filter "@agent-browser/eve..."
pnpm -C packages/@agent-browser/sandbox run build
pnpm -C packages/@agent-browser/eve run build
pnpm -C packages/@agent-browser/eve pack
```

Remove this file and point `@agent-browser/eve` back at the registry once upstream publishes a
release built against eve 0.64 or newer.
