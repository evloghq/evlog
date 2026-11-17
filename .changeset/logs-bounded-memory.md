---
'@evlog/cli': patch
---

`evlog logs` reads a log of any size without its memory growing with it. Every view held each matching event until the end of the run: an 800 MB log took 1.2 GB with `--limit 1`. A view now keeps only the `--limit` events it shows, and `stats` keeps one duration per event for the percentiles. The output of every view is unchanged.
