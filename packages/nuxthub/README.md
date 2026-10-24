# @evlog/nuxthub

[![npm version](https://img.shields.io/npm/v/@evlog/nuxthub?color=black)](https://npmjs.com/package/@evlog/nuxthub)
[![npm downloads](https://img.shields.io/npm/dm/@evlog/nuxthub?color=black)](https://npm.chart.dev/@evlog/nuxthub)
[![CI](https://img.shields.io/github/actions/workflow/status/evloghq/evlog/ci.yml?branch=main&color=black)](https://github.com/evloghq/evlog/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-black?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-black?logo=nuxt&logoColor=white)](https://nuxt.com/)
[![Documentation](https://img.shields.io/badge/Documentation-black?logo=readme&logoColor=white)](https://evlog.dev)
[![license](https://img.shields.io/github/license/evloghq/evlog?color=black)](https://github.com/evloghq/evlog/blob/main/LICENSE)

Self-hosted log retention for [evlog](https://evlog.dev) using [NuxtHub](https://hub.nuxt.com) database storage. Store, query, and automatically clean up your structured logs with zero external dependencies.

## Install and wire it

Install the packages:

```bash
pnpm dlx nuxi module add @nuxthub/core @evlog/nuxthub
```

Add the module to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: ['@nuxthub/core', '@evlog/nuxthub'],

  evlog: {
    retention: '7d',
  },
})
```

> `evlog/nuxt` and `@nuxthub/core` can be auto-installed if missing, but we recommend installing `@nuxthub/core` explicitly and registering it in `modules`.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `retention` | `string` | `'7d'` | How long to keep events. Accepts `d` (days), `h` (hours), or `m` (minutes). |

The cleanup cron schedule is automatically derived from the retention value.

## Which databases work

NuxtHub supports multiple database dialects. The `evlog_events` table schema is automatically registered for:

- **SQLite** (default for Cloudflare D1)
- **MySQL**
- **PostgreSQL**

## Deploy it

For Vercel deployments, the module can create a `vercel.json` with the appropriate cron schedule during `nuxi module add`. For Cloudflare and other platforms, the Nitro scheduled task handles cleanup automatically.

## Documentation

[Full documentation](https://evlog.dev)

## License

[MIT](https://github.com/evloghq/evlog/blob/main/LICENSE)
