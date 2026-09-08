---
title: Inspect events in tests
description: Capture an event and add request context in a test suite.
---

Capture stdout to inspect an evlog event in a test. evlog does not provide an in-memory drain, so the test must parse the emitted JSON itself.

For shared event handling, edit the logger implementation. evlog has no plugin API for extending the logger lifecycle.

An internal reference repeats both limitations. Check the test setup before changing an assertion.
