---
'@evlog/cli': patch
---

The CLI says what is wrong with the environment it is started in, and its output behaves in a pipe.

- On Node older than 22, every command stops with `@evlog/cli needs Node.js 22.0.0 or later, and this is Node.js 20.20.2` and exit code 1. Before, `evlog map` failed there with a syntax error about `globSync`, while `doctor`, `logs` and `--version` still ran on a Node the package does not support. `evlog doctor` no longer has a failing `node` check or a `cli.NODE_TOO_OLD` finding, since it never starts there.
- Next to an evlog older than the peer range, or with none installed, every command stops with the version it needs, the version and path it found, and exit code 1. Before, Node reported a missing export as a syntax error.
- A `package.json` that does not parse in the working directory no longer stops the launcher with `ERR_INVALID_PACKAGE_CONFIG`.
- `--help` prints to stdout, so `evlog --help | grep map` works. Usage shown with a usage error stays on stderr. Flags are listed the way they are typed (`--min-score`, `-f, --follow`), and positional arguments have their own section.
- Colour follows the stream the report is written to: `evlog doctor 2> report.txt` writes plain text from a terminal. `FORCE_COLOR=0` and `TERM=dumb` turn colour off, and the header rule uses 24-bit colour only where the terminal supports it.
- A reader that closes the pipe early, as in `evlog logs --json | head`, ends the run quietly instead of with an unhandled `EPIPE` error.
