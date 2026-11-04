---
'evlog': patch
---

Parse stack frames in linear time. A stack line that starts with `at ` and repeats ` (`, which an error message containing a newline puts in the stack, took time that grew with the square of its length: close to 400 ms for a 40,000-character message, and twice that when the line starts with `at async`. The Sentry drain parses stacks in production, and error serialization and pretty output parse them in development, so an error message built from request input could block the event loop. Frames are parsed the same way as before.
