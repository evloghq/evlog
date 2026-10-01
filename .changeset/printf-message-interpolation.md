---
"evlog": patch
---

Support printf-style interpolation in `log` messages: `%s`, `%d`, and `%j` in a message string are formatted with the extra arguments, matching node's `util.format` semantics for the supported specifiers. Interpolation applies to the message only, never to field values, and the formatter stays tree-shakeable.
