---
"@evlog/cli": minor
---

`evlog init` offers Sazabi as a production destination. Choosing it wires `createSazabiDrain()` from `evlog/sazabi` and asks for `SAZABI_INTAKE_URL`, the intake URL of an OpenTelemetry log stream in Sazabi.
