---
"evlog": patch
---

The `evlog` bin no longer fetches `@evlog/cli` a second time from inside a fetch it started. Under `pnpm dlx`, the `evlog` bin of the auto-installed `evlog` peer shadowed the CLI's bin, and the loop made `pnpm dlx evlog` and `pnpm dlx @evlog/cli` hang on pnpm 11. The second pass now exits with status 1 and a message that suggests `npx --yes @evlog/cli <command>`. Runs that already find `@evlog/cli` are unchanged.
