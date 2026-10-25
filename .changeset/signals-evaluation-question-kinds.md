---
"@evlog/signals": patch
---

`EvaluationQuestion` and `EvaluationAnswer` cover only the `boolean`, `choice` and `score` types a signal asks. Recent `ai` 7 releases added a `box` question type, which made an exhaustive `switch` over `question.type` in a custom `AnswerFn` fail to type-check.
