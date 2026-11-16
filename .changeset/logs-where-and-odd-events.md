---
'@evlog/cli': patch
---

`evlog logs` applies every `--where` when the flag is repeated. Only the last clause applied, so `--where path=/a --where n=5` returned events on any path. An empty `--where`, which is what an unset shell variable expands to, is now a usage error with exit 2.

An event whose `duration`, `level` or `service` is not text no longer crashes every view, `--json` included.

A `--where` value is a number only when it spells one exactly. `zip=123` no longer matches `"00123"`, a 19-digit id no longer matches its neighbours, and `amount>5000` no longer matches a field that holds text such as `"n/a"`. Write the value as the field holds it: `zip=00123`.
