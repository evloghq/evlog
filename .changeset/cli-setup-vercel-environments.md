---
"@evlog/cli": patch
---

`evlog setup vercel` attaches the connector to production and development only, not to preview. Before it attaches, it says that code deployed to those environments gets the authority of the key the connector stores. `--environment` picks the environments, such as `--environment production,preview,development`, and a name that is not an environment is refused before anything runs. A connector already attached keeps the environments it has.

`--source vercel` refuses a project or team id that is not a plain id, and refuses an OIDC token issued for another team, as it already did for another project.
