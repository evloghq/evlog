# Vision

How Evi sees images. The base model (`EVI_MODEL`, GLM 5.3 Flash) takes image
parts natively, so there is nothing to select: an inbound attachment or a
screenshot a tool returned during the turn reaches the model as it is, on the
same call as the rest of the turn.

The base model must stay one that takes images *and* runs a whole turn, tools
included, not one that only captions a picture: an image sits in the history
that every later step reads. A text-only base model would need a second model
for the turns that carry image parts, and a middleware stubbing those parts
out of the history afterwards, since it rejects them raw. That machinery is
what native vision removes.

Image parts are re-sent on every later model call in the session, which is why
`images__view` caps what it inlines and why eve compacts old payloads away
(see the limits below).

## Per channel

| Channel | How an image reaches Evi |
| --- | --- |
| Linear (agent session) | eve fetches `uploads.linear.app` markdown images from the session prompt with the Linear token and attaches them as image parts. Nothing to do in the app. |
| Linear (documents, issue bodies read over MCP) | MCP tools return markdown with `uploads.linear.app` URLs. `images__view` fetches them with the app token; admin sessions only, matching the Linear connection itself. |
| GitHub (issues, PRs, comments) | The channel has no inbound attachments; images are markdown URLs in the body. `images__view` fetches `github.com/user-attachments` and `*.githubusercontent.com`, in community first-responder turns too. |
| iMessage (Photon) | Not delivered. The Photon webhook ships attachment metadata without bytes or a URL, and the adapter keeps only name/mimeType/size, so eve drops the attachment (an image-only message is dropped entirely). Send images over Slack, which eve reads natively. The upstream fix is eve consuming the chat-sdk `data`/`fetchData` attachment contract. |
| Browser (sandbox) | The `@agent-browser` extension has `inlineScreenshots: true`; screenshots come back as tool content parts. |

## Limits, on purpose

- `images__view` fetches only the attachment hosts above, https only. The
  URLs come out of untrusted markdown; an allowlist beats an open fetcher.
- 2 MB raw cap (`MAX_INLINE_IMAGE_BYTES`), so the base64 content part stays
  under eve's 3 MiB session-history warning: image parts are re-sent on every
  later model call.
- The bytes must sniff as a complete png/jpg/webp/gif (same check as blob
  uploads); the server's content-type header is never trusted. No svg.
- Failures are explicit, never silent: the tool returns what went wrong
  (unsupported host, HTTP status, too large, not an image), and the
  instructions require reporting that instead of describing an unseen image.
- Compacted images are gone: eve replaces the payload with a text stub. An
  image the session may need again belongs in the sandbox, not in history.
