---
name: amp
description: Delegate a large coding task to Amp. Load this when the work spans more than two files, needs new tests, is a refactor, the Linear issue has the amp label, or someone asked to use Amp.
---

# Delegate coding work to Amp

Evi keeps small tasks. Amp (ampcode.com), running on Hugo's Amp subscription, takes the large coding ones. Call `amp__execute`. Do not install Amp yourself, and do not shell out to `amp`.

## Bounds

- Do not call Amp for questions, reviews, triage, labels, comments, single-file edits, typos, or docs sentences.
- Do not merge, enable auto-merge, or push to `main`. Amp is told the same; if it still opened a merge, stop and report it.
- Do not add `Co-authored-by`, `Signed-off-by`, or "Generated with" lines. Amp is told the same.
- If `amp__execute` is missing from your tools, or it refuses with `evi.AMP_API_KEY_MISSING`, `evi.AMP_API_KEY_INVALID`, or `evi.AMP_CLI_MISSING`, keep the work and follow `contributing`. Do not retry Amp.
- Visual proof stays yours: `before-after` and the browser tools, after Amp returns.

## When to call Amp

Call `amp__execute` when any of these is true:

1. The Linear issue has the `amp` label.
2. The person asked to use Amp.
3. The work is a refactor.
4. The work needs new or changed tests.
5. The work changes more than two files.

Otherwise do the work yourself with `contributing`.

## How to call

Pass a scoped brief (what to change, acceptance criteria, what not to touch), `route` matching the reason above, the `repository` (`owner/repo`, omit for the home repo), the base `branch` when it is not `main`, the Linear or GitHub `issue` when there is one, and `paths` when you already know them.

Amp runs `amp --execute --stream-json --visibility private --executor orb` against that repository. It clones on Amp's servers. Do not wait in the sandbox checkout for Amp's files to appear.

## After Amp returns

1. Report the Amp thread URL and the pull request URL from the summary. If Amp opened the pull request, the body must start with `Written by an AI agent on behalf of @HugoRCD. @HugoRCD has not reviewed it yet.` If it does not, say so.
2. Load `contributing` for verification. Run the checks Amp claimed, in `/workspace/repo` on Amp's branch (`git fetch` then `git checkout`). For a visual change, load `before-after` and capture proof.
3. If Amp did not open a pull request, open it with `github__createPullRequest` after the local readiness gate. If Amp already pushed the branch, do not `git__push` it again.
4. Request review from the code owners once CI is green. Never merge.
