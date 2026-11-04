---
'@evlog/cli': patch
---

Escape control characters in `evlog logs` output. Before, a logged value such as a request path containing `\r\x1b[2K` was printed to the terminal as is, so it could erase the line it was on and print a fake log line in its place. The one-line view, the full view of one event, its `FIELDS` block and the `stats` table now print control characters as `\r`, `\n` and `\u001b`, the way evlog's pretty output does since its last patch. Tabs are kept. `--json` output is unchanged.
