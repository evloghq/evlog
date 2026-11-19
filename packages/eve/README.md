# @evlog/eve

[evlog](https://evlog.dev) for [eve](https://eve.dev) agents: one wide event per agent turn, from an eve extension.

```bash
pnpm add evlog@beta @evlog/eve@beta
```

The `beta` tags are needed until evlog 3.0 is stable: plain `evlog` still resolves to 2.x on npm, which does not satisfy the `@evlog/eve` peer. Once 3.0 is stable, the plain names work.

```ts
// agent/extensions/evlog.ts
export { default } from '@evlog/eve'
```

```ts
// in a tool
import { useLogger } from '@evlog/eve/logger'

useLogger().set({ order: { id, amount } })
throw billing.PAYMENT_DECLINED({ order }) // code, status, why and fix reach the event
```

Requires eve 1.0 or later and Node 24. Options, the event shape and what each `record` preset keeps: https://evlog.dev/use-cases/eve
