# evlog upgrade

`engine.ts` knows nothing about a given major. Everything version-specific lives in `migrations/v<major>/`.

## Add a codemod

1. Create `migrations/v3/<slug>.ts`. Its id is `v3/<slug>`, and `<slug>` is the anchor of its section in the migration guide (`/migrate/v3#<slug>`), which the docs derive from the heading text: `### Nitro entry points` is `nitro-entry-points`. MDC ignores `{#id}` on headings, so the slug follows the heading, not the other way round. `test/upgrade/docs.test.ts` fails when a codemod has no matching heading.
   - An entry that moved or renamed exports: `moveModules(id, { 'old/entry': { to: 'new/entry', exports: { oldName: 'newName' } } })`.
   - Anything else: a `Codemod` with `needles` (strings a file must contain to be parsed) and `create(ctx)`, which returns node-type listeners. Call `ctx.finding(node, message, edits)` to fix, or `ctx.finding(node, message)` to report.
2. Add it to `migrations/v3/index.ts`. Order does not matter: every codemod reads the same parse, and the engine applies their edits together. Two codemods editing the same code fail the run.
3. Add `test/upgrade/fixtures/v3/<slug>/<case>/input.<ext>`, plus `output.<ext>` for the expected result and `findings.json` (`[{ "line", "mode" }]`) when something is reported. A case with neither is a negative fixture: nothing may change. `codemods.test.ts` picks every case up.

## Add a major

Create `migrations/v4/index.ts` with `{ to: 4, codemods: [...] }` and append it to `MIGRATIONS`. A project on evlog 2 then runs v3, then v4, and `package.json` ends on `^4`. Bumping the evlog range is part of every migration, and it is why a second run is a no-op: the next run starts from the major the first one wrote.
