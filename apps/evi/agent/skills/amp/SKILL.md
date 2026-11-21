---
name: amp
description: Delegate a large coding task to Amp, check an Amp thread, or continue one. Load when the work spans more than two files, is a refactor, the Linear issue has the amp label, someone asked to use Amp, or a follow-up belongs on an existing Amp thread.
---

# Amp CLI

Amp (ampcode.com) runs on Hugo's subscription. Write the prompt, launch an orb, sleep, and check. `AMP_API_KEY` authenticates. `amp` is on PATH in the sandbox.

## Bounds

- Do not call Amp for questions, reviews, triage, labels, comments, single-file edits, typos, or docs sentences.
- Do not merge, enable auto-merge, or push to `main`.
- Do not add `Co-authored-by`, `Signed-off-by`, or "Generated with" lines, and tell Amp the same.
- If `test -n "${AMP_API_KEY:-}"` fails, keep the work and follow `contributing`. Do not run `amp login`.
- Visual proof stays yours: `before-after` after Amp finishes.
- Do not pass `--stream-json`. That attaches until Amp finishes.

## When to delegate

Start Amp when any of these is true:

1. The Linear issue has the `amp` label.
2. The person asked to use Amp.
3. The work is a refactor, or it changes more than two files.

Otherwise do the work yourself with `contributing`.

Search first: `amp threads search EVL-42`. If a thread already exists for this issue, continue it.

## Launch

Write the prompt yourself: what to change, acceptance, what not to touch. Tell Amp:

- Never merge, enable auto-merge, or push to `main`.
- A pull request body must start with `> Written by an AI agent on behalf of @HugoRCD. @HugoRCD has not reviewed it yet.`
- Do not add `Co-authored-by`, `Signed-off-by`, or "Generated with" lines.

Launch without attaching:

```
amp --execute "PROMPT" --executor orb --project evloghq/evlog --visibility private --label evi --title EVL-42
```

`--title` is the Linear issue key when there is one. The command prints a thread URL (`https://ampcode.com/threads/T-…`) and returns. Amp clones on its servers. Do not wait in `/workspace/repo` for its files.

## While it runs

1. Post the thread URL once to the originating Linear issue or Slack thread.
2. Call `sleep` for 90 seconds. Do not `bash` sleep. A new message ends the wait early; handle that message.
3. Check with `amp threads list --json` and `amp threads markdown T-…`.
4. If Amp is still running, sleep and check again. Post only when something meaningful changed (a pull request, a failure, a finished summary). Same state as last check: post nothing.
5. If Amp is idle, stop.

## Follow-ups

Review comments, a failing check, or a correction on the same issue:

```
amp threads continue T-… --execute --executor orb "PROMPT"
```

Then sleep and check the same way. Do not start a second thread for that issue.

## After Amp finishes

1. Report the thread URL and any pull request URL. If Amp opened a pull request, the body must start with `> Written by an AI agent on behalf of @HugoRCD. @HugoRCD has not reviewed it yet.` If it does not, say so.
2. Load `contributing` for verification. Run the checks Amp claimed, in `/workspace/repo` on Amp's branch (`git fetch` then `git checkout`). For a visual change, load `before-after`.
3. If Amp did not open a pull request, open it with `github__createPullRequest` after the local readiness gate. If Amp already pushed the branch, do not `git__push` it again.
4. Request review from the code owners once CI is green. Never merge.
