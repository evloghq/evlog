---
'evlog': patch
---

Escape control characters in pretty output on Node. Before, a value such as a user agent containing `\r\x1b[2K` was written to the terminal as is, so it could erase the line it was printed on and write a fake log line in its place. Field keys and values, the request method and path, error messages and guidance, AI fields and tagged logs now print control characters as `\r`, `\n` and `\u001b`, the way JSON output already shows them, so a multi-line value now prints on one line. Tabs are kept. JSON output is unchanged.
