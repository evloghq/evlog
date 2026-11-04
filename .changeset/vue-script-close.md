---
'@evlog/cli': patch
---

`evlog map` now reads a Vue route file whose `<script>` block closes with `</script >` or another closing tag that has whitespace before `>`. Before, it found no script in that file and skipped it.
