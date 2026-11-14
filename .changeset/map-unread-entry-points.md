---
'@evlog/cli': patch
---

`evlog map` no longer scores a tree it only partly read.

- A file with a syntax error used to lose its routes, which raised the score. The report now warns `<file> failed to parse` and counts the file as one failing entry point. With `--min-score`, `map.minScore` or `--baseline`, the run stops with `cli.MAP_PARSE_FAILED`, exits 1, and leaves `evlog.map.json` as it was. List the file under `map.ignore` when it is not app code.
- Directories named `build`, `dist` and `coverage` are skipped at the project root only, so `server/api/build/index.get.ts` is scanned.
- Two entry points with the same method and path, such as `get('/')` in two routers, get distinct ids. `--baseline` reported regressions on an unchanged tree when they shared one. The id of every other entry point is unchanged, so a committed map stays comparable.
- `.js`, `.mjs` and `.cjs` files are parsed with JSX, so a Next.js `page.js` is checked instead of reported as `n/a`.

The first and the last of these can change a verdict on code you did not touch, so the rule-set version moves to 2. `--baseline` against a map written by an earlier CLI exits 2 with the version mismatch: run `evlog map` once and commit the new `evlog.map.json`.
