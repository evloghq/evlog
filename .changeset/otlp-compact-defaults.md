---
"evlog": major
---

OTLP records default to the `compact` shape with OpenTelemetry semantic convention attributes. This applies to every drain built on the OTLP encoder: `evlog/otlp`, PostHog (logs and events mode), HyperDX and Sazabi.

- `recordShape` defaults to `'compact'`: the body is a one-line summary (`POST /api/checkout (500)`) and nested fields become dotted attributes (`user.id`). In PostHog events mode, nested properties are flattened the same way.
- `semanticConventions` defaults to `true`: records also carry `http.request.method`, `url.path`, `http.response.status_code`, `exception.*` and `gen_ai.*`, and the resource carries `deployment.environment.name`. The evlog field names stay.

For the same 100 events, the OTLP request shrinks from 151,235 to 140,250 bytes as JSON (2,804 to 2,198 gzipped) and from 76,839 to 63,925 bytes as protobuf.

To keep the 2.x output:

```ts
createOTLPDrain({ recordShape: 'json', semanticConventions: false })
createPostHogDrain({ recordShape: 'json' })
```
