# LogTape

Checked: 2026-09-08
Sources: https://logtape.org/manual/library, https://logtape.org/manual/contexts, https://logtape.org/manual/testing, https://logtape.org/comparison

## What it does

- Categories let a consuming application configure output for library code. LogTape also supports application logging.
- `logger.with()` provides explicit context. `withContext()` needs configured context-local storage and a compatible runtime.
- Structured records support message templates and properties. Sinks handle delivery.
- Testing packages provide capture and assertions. Redaction is a separate package.

## What comparisons must distinguish

- evlog's accumulator and `fork()` are not the same feature as implicit context propagation.
- evlog provides a memory drain for capturing records. Do not describe it as lacking all testing or capture support.
- A library can accumulate an object and emit once with either logger. Compare the supplied lifecycle and integration code.
- Historical bundle and throughput figures do not establish a winner for current browser imports. Match versions, entry points, workloads, and output before comparing numbers.
