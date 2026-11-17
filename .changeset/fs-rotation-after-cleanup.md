---
"evlog": patch
---

Fix the fs drain losing events when `maxFiles` and `maxSizePerFile` are both set. Once cleanup deleted the day's unsuffixed file (`2026-03-14.jsonl`), the next write recreated it, and because that file sorts oldest, the same cleanup deleted it straight away, so every later event that day was lost. The drain now appends to the day's newest file and rotates to the next index from there.
