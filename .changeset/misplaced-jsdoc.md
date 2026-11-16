---
'evlog': patch
---

`createDrainPipeline` from `evlog/pipeline`, and the `AuditActor` and `AuditFields` types from `evlog`, show their documentation again in the published types and in editor hovers. Each doc block sat directly on top of another one, so TypeScript attached it to nothing. `createDrainPipeline` gets its description and usage example back, `AuditActor` the meaning of each actor field, and `AuditFields` the description of each reserved audit field.
