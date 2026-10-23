---
"evlog": minor
---

The `evlog/vite` plugin now reads `evlog.config.ts` from the Vite root, the same file the CLI, Nuxt and Nitro read, so Vite-based apps (TanStack Start, React Router, SvelteKit, Astro) can keep their settings in the shared file. The file is the base and plugin options override it key by key. Only the serializable settings (`service`, `environment`, `enabled`, `pretty`, `silent`, `sampling`, `minLevel`, `stringify`) are read from the file; its functions (`drain`, `enrich`, `keep`, `plugins`) are not injected by the plugin. Without a file, the plugin output is unchanged. A file that fails to load fails the build with its path in the error.
