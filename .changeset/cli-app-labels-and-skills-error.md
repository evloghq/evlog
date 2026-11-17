---
'@evlog/cli': patch
---

Two fixes to `evlog init` and `evlog agents`.

- On Windows, `evlog init --apps apps/web` sets up the app. Workspace app paths were built with backslashes there, so the forward-slash form was rejected as unknown, and the JSON `app` values and the per-app headings carried backslashes. They use forward slashes on every platform, and `--apps apps\web` still selects the app.
- When `npx skills add` fails, the reported error is the last line it wrote before npm's update notice. Before, a failed first run could report `npm notice` as the error.
