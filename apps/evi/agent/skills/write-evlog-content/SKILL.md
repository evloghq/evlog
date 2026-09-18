---
name: write-evlog-content
description: "The evlog content doctrine, for anyone drafting or judging evlog prose: a docs page, the landing, a blog post, a package README, a skill, an AGENTS.md, a changeset. This skill is a pointer, not a copy: it says where the doctrine lives and what range it covers. Load it before writing or reviewing content; read the doctrine file itself in the repository checkout."
---

# Writing evlog content (pointer)

This skill defines the range of the content doctrine and points at it. It does not restate it, because two copies of the rules drift apart, and a skill that drifts is worse than a missing one.

**The doctrine lives in the repository checkout, at `.agents/skills/write-evlog-content/`.** Read `SKILL.md` and its sibling files there with the file tools:

```
/workspace/repo/.agents/skills/write-evlog-content/
```

Everything this skill carries: the evlog voice, the atomic rules, the terminology, the competitor dossiers, and the AI-tell corpus with the legitimate twin for each tell.

## Range

The doctrine governs every written surface of evlog: the docs tree, the landing, the package READMEs, the published and internal skills, the `AGENTS.md` files, the blog, and changesets. Two roles use it, and they must not be merged:

- **Review** produces findings and a verdict, and never rewrites.
- **Write** drafts and edits prose against the same rules.

When a rule in the checkout reads as wrong, fix it in `.agents/skills/write-evlog-content/` by pull request, not by paraphrasing it here.
