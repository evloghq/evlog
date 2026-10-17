---
"evlog": patch
---

Keep evlog 3's process-wide state apart from evlog 2. `3.0.0-beta.0` still stored its config under the 2.x registry key, so with both majors loaded in one process (for example a dependency still on evlog 2), each copy read and overwrote the other's config, drain and redaction, and the "Multiple major versions of evlog" warning never fired. 3.x now uses its own key and warns when a 2.x copy is also loaded.
