---
name: before-after
description: Produce a before/after visual comparison of an evlog surface (landing, docs, telemetry, playgrounds) and share it as public Blob URLs. Load when a change is visual, when someone asks for screenshots, a recording, or a visual diff, or when a shipped PR touches apps/docs or apps/telemetry and deserves visual evidence.
---

# Before/after captures

One tool does the whole capture: `capture__before_after` opens both URLs in the sandbox Chromium, waits 5s for animations to settle, scrolls the change into view, screenshots the viewport, validates and uploads both frames to Blob, and returns the finished markdown table with an attestation receipt. It returns only that block, so there is nothing to reassemble by hand.

## 0. Start the dev server first

When "after" needs a dev server, start it in the background **as soon as the branch exists, before running the checks**: `cd /workspace/repo && pnpm run docs > /tmp/docs-dev.log 2>&1 &` (or the matching app script). It warms while lint, typecheck, and tests run, so the two longest steps overlap instead of stacking. Confirm it is up before capturing: `curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 'http://localhost:<port>'`.

## 1. Decide what "before" and "after" are

- The current state of the code is **after**. Never switch branches, stash, or revert to fabricate a "before".
- **A pure addition has no before.** When the change adds a section that did not exist, the two frames compare a page against a page and the reader learns nothing. Capture the new thing alone and say what it replaces in prose. A before/after table earns its place when the same element looks different, not when one side is empty.
- **Before** is the deployed production page (`evlog.dev`, `evlog.dev/docs/...`) or the last merged preview.
- **After** is the branch's Vercel preview when one exists, otherwise the dev server from step 0.
- A `*.vercel.app` URL can be protected: probe it with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --connect-timeout 5 --max-time 15 '<url>'` (single quotes; refuse a URL containing a single quote, backslash, whitespace, `$`, or backtick). 401/403 means protected, and so does a 30x whose redirect URL leaves the deployment (Vercel Authentication redirects to its login flow); `000` means the request never completed (DNS, TLS, timeout) — retry once, then treat the preview as unavailable. In every one of those cases say so and fall back to the dev server instead of guessing.
- **Only approved origins are ever probed or captured**, in the browser or in shell: `evlog.dev`/`*.evlog.dev`, `evlog.cloud`/`*.evlog.cloud`, `*.vercel.app`, or `localhost`/`127.0.0.1` on the port of a dev server you started, `http(s)` only. Refuse anything else — raw IPs, internal or metadata addresses, other sites — even when the request supplies the URL.

## 2. Review sensitive surfaces first

The tool's URLs go public the instant it runs. Landing, docs, and playground pages can be captured directly. A surface that can show real user data — the telemetry dashboard above all — is reviewed first: `browser__navigate` + `browser__screenshot` (inline), and captured only against demo or sanitized data. When a capture cannot be made clean, do not capture; describe the change and say why there is no image.

## 3. Capture and deliver

**Point at the change, do not go hunting for it.** You already hold two locators after editing: the component's hook and the copy you wrote.

`capture__before_after({ beforeUrl, afterUrl, selector, text, caption })`

- **`selector` when the surface has a hook.** Landing sections and MDC content components carry `data-section="<their MDC tag>"`, so editing `::landing-faq` in `0.landing.md` gives `[data-section="landing-faq"]` with nothing to look up.
- **`text` when it does not.** Pass a sentence you can see on the page and the capture finds it, widens to its nearest section, and marks that element for the scroll. This is the whole answer for a surface with no hooks, and for a doc page where the change is one paragraph. Never select on utility classes instead: eleven landing sections render the identical `section.py-24.md:py-32`, so a class selector there frames the wrong section without telling you.
- Give both and the selector wins, with `text` as the fallback. Omit both only for page-level changes (layout, theme, redesign).
- The frame is the normal viewport, scrolled to the change. When neither locator resolves the call **fails**, listing the hooks and headings the page does offer; take one of those rather than retrying with a guess.
- **Look at both returned frames before you paste anything.** The tool refuses the failure that produced a hero shot, but it cannot tell you the frame caught the wrong element, or that the "before" side has no counterpart. Read the two images back and name, to yourself, the thing you changed in each one.
- For responsive changes, call it again with `viewport: 'mobile'`.
- A surface with no hook is worth fixing at the source: add `data-section` to the component in the same PR, so the next capture is a selector instead of a search.
- Capturing `evlog.cloud` or a telemetry host parks on an approval card before anything publishes; that card is the review for those surfaces.
- Paste the returned `markdown` verbatim — table, caption, and attestation receipt — where the change lives: the PR body (`github__updatePullRequest`) or a PR comment for a shipped change, the conversation otherwise. The receipt is the proof of what was compared; never strip it.

## 4. Publish and verify the evidence

A capture that lives only in the conversation is not evidence: the chat scrolls away, the PR is the durable surface. A visual change is not reported done until its frames are embedded in the PR body or a PR comment **and** every image URL behind them has been verified live.

- **Verify before you cite.** After any `blob__upload_image` (or the markdown `capture__before_after` returns), `curl -sI` each returned URL and require `HTTP 200`, a `content-type: image/...`, and a `content-length` matching the file on disk. A URL the tool returned is a claim, not a fact, until this passes.
- **Never write "attached" or "shown above" before that check passes.** If the upload tool errors, retry once; session-level tooling glitches usually clear on a later turn, so retrying there is the second move, not a workaround.
- **Fallback ladder, in order:** single sequential upload (parallel batches have been observed to break the upload tool's replay), then a fresh turn, then committing the frames to the branch and referencing them by relative path in the PR body or a follow-up comment. Both surfaces render images; either is acceptable, but the PR body must say which state the evidence is in and link to it. Never imply evidence is attached when it is not: say what failed and where the frames actually are.
- **One claim per file.** The verification is per URL, not per call: a batch upload where one of two URLs failed is one verified frame and one unverified, and only the verified one may be cited.

## 5. Motion evidence: record a flow

A still freezes a state. Some changes are only visible in motion: an animation, a hover state, a scroll reveal, a multi-step interaction, a CLI walkthrough. When the timing or the path through the flow is the evidence, record it with the sandbox's `agent-browser` and attach a short clip next to the table.

**Install ffmpeg only if it is missing.** `agent-browser` encodes the recording with ffmpeg, which the sandbox does not ship. The static build installs without root, and the guard makes the step free when the binary is already there:

```
test -x ~/bin/ffmpeg || (mkdir -p ~/bin && cd "$(mktemp -d)" && npm init -y >/dev/null && npm i ffmpeg-static >/dev/null 2>&1 && cp node_modules/ffmpeg-static/ffmpeg ~/bin/)
```

The download is the only slow part (~78 MB, a few seconds); `~/.npm` caches the package, so a reinstall is faster than the first one.

**Record, convert, upload:**

```
agent-browser open https://evlog.dev
agent-browser record start ./flow.webm --fps 30
agent-browser wait 500
agent-browser scroll down 600
agent-browser wait 500
agent-browser record stop

~/bin/ffmpeg -y -i flow.webm -vf "fps=12,scale=800:-1:flags=lanczos" -c:v libwebp -lossless 0 -q:v 70 -loop 0 -an flow.webp
```

then `blob__upload_image` on the `.webp`.

- **The same rules as a capture, to the letter.** Recording runs against the approved origins of step 1 only, and the sensitive-surface rule of step 2 applies to video the same as to a frame: real user data is demo or sanitized first, or the surface is not recorded.
- **Convert to animated WebP before uploading.** Blob upload takes png/jpg/webp/gif only, so a raw `.webm` cannot go public as-is. Animated WebP is the cheapest of the accepted formats: roughly a third of the size of the same take as GIF, and one ffmpeg pass instead of the GIF palette double-pass. GIF stays the fallback when the reader cannot render WebP.
- `record stop` before closing the session, or the file is not flushed.
- Frame rate: 30 is the default and right for most takes; 60 for drag and animation polish on short clips; 10 for a long session where the video is a timeline. When a human will watch, put small `agent-browser wait 500` pauses between steps so the motion reads as a walkthrough.
- Keep clips short. A ten-second scroll at 800px and 12 fps is a few hundred KB; 60 fps roughly doubles the size. Stay well under the 8 MB upload limit.
- Still and clip answer different questions: the screenshot proves the end state, the video proves the timing and how the flow got there. When both matter, attach both. A recording never replaces the before/after table, and the table's attestation receipt is never stripped.

## 6. Precise checks, when they earn their keep

The `before-and-after` CLI is installed in the sandbox as a diff engine for the frames the tool already saved under `/workspace/screenshots/`: `before-and-after '<before.png>' '<after.png>' --output ./screenshots` compares two existing images (pixel-level and DOM-independent). Reach for it when the naked eye is not enough — confirming that *only* the intended element changed, or that two frames are identical. Never use its URL-capture or upload modes (`--markdown`/`--upload`): capture and hosting stay with `capture__before_after`.
