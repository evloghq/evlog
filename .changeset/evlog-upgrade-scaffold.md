---
"@evlog/cli": minor
---

Add `evlog upgrade`, which migrates a project to evlog 3. It reads the evlog range in `package.json` and runs every migration above it.

```bash
npx @evlog/cli@latest upgrade          # show each fix and what needs a person, change nothing
npx @evlog/cli@latest upgrade --write  # apply the fixes and move evlog to ^3 in package.json
```

This release rewrites two things:

- The Nitro imports: `evlog/nitro` becomes `evlog/nitro/v2` and `evlog/nitro/v3` becomes `evlog/nitro`, including `import()`, `require.resolve()` and `import.meta.resolve()`.
- `evlog/browser` becomes `evlog/http`, with `createBrowserDrain`, `createBrowserLogDrain`, `BrowserDrainConfig` and `BrowserLogDrainOptions` renamed to their `Http` names wherever the file uses them.

Code that cannot be rewritten safely is reported with its file, line and a link to the migration guide: a dynamic import of a module whose exports were renamed, an `export *` from it, or the module named in a plain string. The dry run exits 1 while anything is left, and `--write` exits 1 while reported findings remain. `--write` refuses to run on uncommitted git changes unless you pass `--force`. `--json` prints the report with a `schemaVersion`.

Running it again after `--write` does nothing, because `package.json` already says evlog 3.
