# Surface: changeset

`.changeset/*.md`. Short, and read by two audiences: a consumer scanning a release for what affects them, and the release notes that quote it verbatim.

## Shape

```markdown
---
"evlog": minor
---

One line stating what the consumer can now do, or what changed for them.

Optional: the one thing they need to know to use it: the import, the option, the migration step.
```

## Rules

- **Written from the consumer's side.** What they can do, not what was implemented. "Adds `createLokiDrain` for Grafana Loki", not "implements the Loki adapter".
- **Present tense, no narrative.** No paragraph about how the change came about. That belongs in the PR body.
- **Breaking changes name the migration**, in one line, with the before and the after.
- **No changeset when the consumer would not notice**, wherever the diff lives: `apps/*` and `examples/*` never, and refactors, dedupes, comment or test changes under `packages/*` neither. Never an empty changeset.
- Bump type: `patch` for fixes, `minor` for features, `major` for breaking.

## The tell that shows up here

Changesets are short enough that generated ones are obvious: three items where the PR did one thing, a closing sentence restating the opening, and a benefit clause tacked onto a mechanical change ("...improving developer experience"). Cut the clause. The change is the note.
