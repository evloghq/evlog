---
title: Inspect events in a test
description: Capture a structured event in memory and assert on its fields.
---

# Inspect events in a test

Your test needs the event fields, but parsing terminal output couples the assertion to formatting. The memory drain keeps events in a named store that the test can read directly.

## Capture the event

This Node.js example writes one event through the drain and checks its action. It calls the drain directly, so it does not test middleware or request lifecycle handling.

```js
import assert from 'node:assert/strict'
import { clearMemoryLogs, createMemoryDrain, readMemoryLogs } from 'evlog/memory'

const store = 'checkout-test'
clearMemoryLogs(store)
const drain = createMemoryDrain({ store, maxEvents: 100 })

await drain({
  event: {
    timestamp: new Date().toISOString(),
    level: 'info',
    action: 'checkout.completed',
  },
  request: { method: 'POST', path: '/checkout', requestId: 'test-1' },
  headers: {},
})

const events = readMemoryLogs({ store })
assert.equal(events.length, 1)
assert.equal(events[0].action, 'checkout.completed')
clearMemoryLogs(store)
```

The awaited drain call writes the event before the assertion reads the store. No network credentials are needed for this example.

## Bound the buffer

Three details affect tests that share a process.

A store with `maxEvents: 100` retains at most 100 events. Further writes discard the oldest events, so choose a bound that holds the records your assertion needs.

Store names matter. Two drains with the same name share a buffer, so concurrent tests need separate names and each test should clear its store after asserting.

The buffer lives in process memory. It is useful for assertions, but it does not preserve events after the process exits.

## Inspect a subset

`readMemoryLogs({ store, level: 'error', limit: 10 })` returns up to the ten most recent matching events, ordered oldest first. Keep an assertion on the full event count when a missing event should fail the test.
