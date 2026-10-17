# @evlog/nuxthub

## 3.0.0-beta.0

### Major Changes

- [#861](https://github.com/evloghq/evlog/pull/861) [`32ded2c`](https://github.com/evloghq/evlog/commit/32ded2cb572f8184f24a938539eff30f24a1d455) Thanks [@evlogai](https://github.com/apps/evlogai)! - Require Node.js 22 or later. `engines.node` is now `>=22.0.0` (it was `>=18.0.0`, and `>=20.0.0` for `@evlog/signals`). The build target follows the floor, so the published output targets Node 22.

  Nuxt 4.6.1 declares `^22.22.3 || ^24.15.0 || >=26.0.0`, so Nuxt projects should run one of those ranges.

### Patch Changes

- Updated dependencies [[`24ca3e3`](https://github.com/evloghq/evlog/commit/24ca3e3c1fde0e16582abc125019f8995d0a48e4), [`32ded2c`](https://github.com/evloghq/evlog/commit/32ded2cb572f8184f24a938539eff30f24a1d455), [`a0187db`](https://github.com/evloghq/evlog/commit/a0187db7a500e5a51bcaa98e5f32ca1fe6df42e5), [`0baa9e8`](https://github.com/evloghq/evlog/commit/0baa9e8d009e8216ea7d935eec7aca36983c8a21)]:
  - evlog@3.0.0-beta.0

## 2.0.2

### Patch Changes

- [#649](https://github.com/evloghq/evlog/pull/649) [`0417784`](https://github.com/evloghq/evlog/commit/0417784dc9e6d3825c10b5d715ff2cb1e7e3acdd) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Point the package metadata (`repository`, `bugs`) and README links at the repository's new home, `evloghq/evlog`.

## 2.0.1

### Patch Changes

- [#376](https://github.com/HugoRCD/evlog/pull/376) [`4c13bb0`](https://github.com/HugoRCD/evlog/commit/4c13bb0043c5acca4bd8e99638740396a557ead0) Thanks [@HugoRCD](https://github.com/HugoRCD)! - Hardening and performance improvements across the package:
  - **Redaction**: path matchers are now precompiled once per resolved config instead of on every event, and case-insensitive leaf lookups are O(1).
  - **Pipeline**: the idle flush scheduling timer is `unref()`'d so it never holds a Node process open on shutdown — call `flush()` to deliver buffered events before exit (unchanged, documented contract). Retry backoff timers stay ref'd so in-flight batches are not dropped mid-retry.
  - **Ingest endpoint**: request bodies are capped at 32KB (413 beyond) and parsed as strict JSON.
  - **Audit**: `stableStringify` guards against circular references in audit `changes` instead of recursing forever; shared (non-circular) references keep stable signatures.
  - **Toolkit**: new `applyDeprecatedAlias` helper to map deprecated config fields onto their replacement with a one-time warning, used by the Axiom and Better Stack adapters.
  - **Vite**: warns when `sourceLocation` is enabled for a production build (source paths embedded in the client bundle).
  - Published packages now declare `engines.node >= 18`.
