# Vendored packages

## `agent-browser-eve-0.38.1-pr1945.tgz`

`@agent-browser/eve` built from [vercel-labs/agent-browser#1945](https://github.com/vercel-labs/agent-browser/pull/1945)
at commit `15dd3b4e6ee21c26b7b5f8048bbe73f31182803c`. It is the published 0.38.1 source rebuilt with
eve 0.63.0, so its manifest requires tool contract 53 instead of 21, which eve 0.52+ dropped.

Reproduce:

```sh
git clone --depth 1 https://github.com/vercel-labs/agent-browser
cd agent-browser && git fetch --depth 1 origin 15dd3b4e6ee21c26b7b5f8048bbe73f31182803c && git checkout FETCH_HEAD
pnpm install --frozen-lockfile --ignore-scripts --filter "@agent-browser/eve..."
pnpm -C packages/@agent-browser/sandbox run build
pnpm -C packages/@agent-browser/eve add -D eve@0.63.0 --config.minimum-release-age=0
pnpm -C packages/@agent-browser/eve run build
pnpm -C packages/@agent-browser/eve pack
```

Remove this file and point `@agent-browser/eve` back at the registry once upstream publishes a release
built against eve 0.57 or newer. `eve` is pinned exactly because each release rotates the tool contract:
0.63.0 accepts contract 53, which both this build and `@github-tools/eve-extension@0.7.3` require.
When bumping eve, rebuild this tarball against the same version and check every extension manifest
against `EXTENSION_CAPABILITY_CONTRACTS` in `eve/dist/src/compiler/extension-compatibility.js`.
