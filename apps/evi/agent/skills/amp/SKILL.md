---
name: amp
description: Delegate a large coding task to Amp, check an Amp thread's progress, or continue one. Load this when the work spans more than two files, needs new tests, is a refactor, the Linear issue has the amp label, someone asked to use Amp, or a follow-up belongs on an existing Amp thread.
---

# Delegate coding work to Amp

Evi keeps small tasks. Amp (ampcode.com), running on Hugo's Amp subscription, takes the large coding ones. Call `amp__execute` to start, `amp__status` to poll, `amp__continue` to send a follow-up. Use `sleep` between polls. Do not install Amp yourself, and do not shell out to `amp`.

## Bounds

- Do not call Amp for questions, reviews, triage, labels, comments, single-file edits, typos, or docs sentences.
- Do not merge, enable auto-merge, or push to `main`. Amp is told the same; if it still opened a merge, stop and report it.
- Do not add `Co-authored-by`, `Signed-off-by`, or "Generated with" lines. Amp is told the same.
- If the Amp tools are missing, or a call refuses with `evi.AMP_API_KEY_MISSING`, `evi.AMP_API_KEY_INVALID`, or `evi.AMP_CLI_MISSING`, keep the work and follow `contributing`. Do not retry Amp.
- Visual proof stays yours: `before-after` and the browser tools, after Amp finishes.
- Do not attach to Amp with `--stream-json`. The orb keeps working after `amp__execute` returns. A serverless turn must not wait on it.

## When to call Amp

Call `amp__execute` when any of these is true and no Amp thread is already mapped for this issue or session:

1. The Linear issue has the `amp` label.
2. The person asked to use Amp.
3. The work is a refactor.
4. The work needs new or changed tests.
5. The work changes more than two files.

Otherwise do the work yourself with `contributing`. If `amp__execute` returns `reused: true`, call `amp__continue` instead of starting another thread.

## How to start

Pass a scoped brief (what to change, acceptance criteria, what not to touch), `route` matching the reason above, the `repository` (`owner/repo`, omit for the home repo), the base `branch` when it is not `main`, the Linear or GitHub `issue` when there is one, and `paths` when you already know them.

Amp starts `amp --execute --visibility private --executor orb` against that repository and returns the thread URL immediately. It clones on Amp's servers. Do not wait in the sandbox checkout for Amp's files to appear.

## While Amp runs

1. Post the Amp thread URL once to the originating Linear issue or Slack thread.
2. Call `sleep` with 90 seconds. Do not `bash` sleep. A new message ends the wait early; handle that message.
3. Call `amp__status` with the `threadId` or `issue`. If `update` is a string, post that one line and nothing else. If `update` is null, post nothing.
4. If `status` is `idle`, stop polling and go to After Amp finishes.
5. Repeat from sleep at most 15 times. If Amp is still running, post the thread URL once more and stop. A later message can call `amp__status` again.

## Follow-ups

Review comments, a failing check, or a correction on the same issue: call `amp__continue` with the `threadId` or `issue` and a scoped brief. Then poll with `sleep` and `amp__status` the same way. Do not call `amp__execute` again for that issue.

## After Amp finishes

1. Report the Amp thread URL and the pull request URL (`prUrl` from `amp__status`, or the summary). If Amp opened the pull request, the body must start with `Written by an AI agent on behalf of @HugoRCD. @HugoRCD has not reviewed it yet.` If it does not, say so.
2. Load `contributing` for verification. Run the checks Amp claimed, in `/workspace/repo` on Amp's branch (`git fetch` then `git checkout`). For a visual change, load `before-after` and capture proof.
3. If Amp did not open a pull request, open it with `github__createPullRequest` after the local readiness gate. If Amp already pushed the branch, do not `git__push` it again.
4. Request review from the code owners once CI is green. Never merge.
