---
'evlog': patch
---

`createDrainPipeline` costs less CPU and shorter garbage-collection pauses while its backend falls behind.

- A push into a full buffer drops the oldest event in constant time. It used to copy the whole buffer: about 5 µs per event at the default `maxBufferSize` of 1,000 and 94 µs at 20,000, against 0.2 µs and 0.4 µs now.
- The pipeline no longer keeps a lookup table of every held event. With the buffer full, each minor garbage collection took about twice as long as in 2.36.0; it is back to the 2.36.0 duration.

Which events are delivered or dropped is unchanged.
