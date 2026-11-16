---
'@evlog/cli': patch
---

`evlog agents` and `evlog init` no longer delete or duplicate text in an `AGENTS.md` whose evlog markers are not one clean pair. A file that lost `<!-- evlog:end -->` got a second block on one run and lost the section below it on the next. Both commands now stop with `cli.AGENTS_MARKERS_UNPAIRED`, exit 1 and leave the file as it is. A marker quoted in a sentence or a code fence is read as text.

`evlog init` also changes in four places:

- A Nitro config that imports something else from `evlog/nitro` or `evlog/nitro/v3` gets `import evlog` along with `modules: [evlog()]`. It got the module entry with no import.
- The seeded `errors.ts` and `audit.ts` parse when a service or a route starts with a digit (`_3dShopErrors`, `_2FA_PASSWORD_CREATED`) or a route holds a wildcard.
- A failed `npx skills add` exits 1, and the `AGENTS.md` block no longer points at the skill that was not installed. `evlog agents` already did both.
- A file that cannot be written stops the run with `cli.WRITE_FAILED`, which names the file and the ones written before it, under `--json` too. `evlog agents` does the same. Both printed a stack trace and left stdout empty.
