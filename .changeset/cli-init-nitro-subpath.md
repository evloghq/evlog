---
"@evlog/cli": minor
---

`evlog init` writes the Nitro import for the evlog major installed in the project. On evlog 3 it imports `evlog/nitro` for Nitro 3 and `evlog/nitro/v2` for nitropack, and on evlog 2 it keeps `evlog/nitro/v3` and `evlog/nitro`. The TanStack Start error middleware snippet follows the same rule. `evlog config` reads the module options from any of the three subpaths.

When the project has no evlog yet, a prerelease of the CLI installs `evlog@beta` and a release installs `evlog`, so the import paths it writes match the evlog it installs.
