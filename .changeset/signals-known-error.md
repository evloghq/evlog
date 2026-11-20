---
'@evlog/signals': minor
---

Add `knownError`, a ready-made signal that matches errors thrown without a catalog `code` (a raw Stripe exception, a library's `jwt expired`) to the entry of your error catalog that describes them, or to `new` when none does. Pass it your catalogs and factories: `createSignals({ signals: [knownError([billingErrors, authErrors])] })`. Each entry's string `message` and its `why` describe the option; errors already carrying a catalog `code` are skipped, and errors sharing a name and message share one verdict.
