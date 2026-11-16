---
"evlog": patch
---

Sentry logs now carry the reserved `user.id` attribute when the wide event has a user, the same attribute the official Sentry SDK sets from its user scope. The log item container also carries `version: 2`, as the Sentry logs protocol recommends. Before, the id only appeared under the `userId` key.
