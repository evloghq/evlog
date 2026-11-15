---
"evlog": patch
---

Sentry logs now carry the reserved `user.id` attribute when the wide event has a user, matching what the official Sentry SDK sends from its user scope. Sentry Logs filters by user through that attribute; before, the id only appeared under the `userId` key.
