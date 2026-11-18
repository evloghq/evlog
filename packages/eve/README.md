# @evlog/eve

[evlog](https://evlog.dev) for [eve](https://eve.dev) agents: one wide event per agent turn, from an eve extension.

```bash
pnpm add evlog @evlog/eve
```

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
