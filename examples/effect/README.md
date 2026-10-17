# Effect Example

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) to test routes from the UI.

Check your terminal for the pretty-printed wide events and your PostHog dashboard for drained logs. `POST /jobs/digest` prints two events with the same `traceId`: the job's, emitted by `withLogger`, and the request's.
