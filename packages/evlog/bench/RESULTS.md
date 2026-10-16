# Benchmark results

> Generated on 2026-10-16

## Bundle size

| Entry | Raw | Gzip |
|-------|----:|-----:|
| framework/nitro | 20.35 kB | 7.31 kB |
| framework/next | 14.69 kB | 5.21 kB |
| framework/ai | 16.94 kB | 4.67 kB |
| adapter/fs | 9.97 kB | 3.35 kB |
| adapter/datadog | 6.22 kB | 2.48 kB |
| adapter/sentry | 6.40 kB | 2.40 kB |
| framework/vite | 7.26 kB | 2.40 kB |
| adapter/memory | 6.13 kB | 2.36 kB |
| core (index) | 6.21 kB | 2.15 kB |
| adapter/otlp | 5.91 kB | 2.14 kB |
| enrichers | 6.24 kB | 1.99 kB |
| framework/sveltekit | 6.33 kB | 1.96 kB |
| utils | 4.23 kB | 1.78 kB |
| error | 3.84 kB | 1.57 kB |
| adapter/axiom | 3.92 kB | 1.50 kB |
| adapter/posthog | 4.39 kB | 1.47 kB |
| framework/elysia | 3.57 kB | 1.41 kB |
| pipeline | 4.17 kB | 1.35 kB |
| workers | 3.15 kB | 1.31 kB |
| framework/nestjs | 3.00 kB | 1.26 kB |
| adapter/better-stack | 3.22 kB | 1.26 kB |
| http | 2.91 kB | 1.24 kB |
| adapter/hyperdx | 2.86 kB | 1.18 kB |
| framework/fastify | 2.40 kB | 1.08 kB |
| toolkit | 2.17 kB | 782 B |
| framework/express | 1.39 kB | 737 B |
| framework/hono | 1.12 kB | 613 B |
| browser | 650 B | 289 B |
| logger | 481 B | 254 B |
| client | 192 B | 128 B |
| types | 11 B | 31 B |
| **Total** | **160.29 kB** | **57.59 kB** |

## Bundled size vs alternatives

> Canonical basic setup per library (`bench/bundled/`), bundled with esbuild 0.25.12 (esm, platform node, target node18, minify on), gzipped.
> See `bench/scripts/bundled-size.ts` for methodology.

| Library | Version | Raw | Gzip | Modules |
|---------|---------|----:|-----:|--------:|
| evlog | 2.29.0 | 31.17 kB | 11.80 kB | 24 |
| pino | 10.3.1 | 59.94 kB | 20.05 kB | 30 |
| consola | 3.4.2 | 74.73 kB | 22.61 kB | 6 |
| winston | 3.19.0 | 144.14 kB | 47.42 kB | 116 |

## Comparison vs alternatives

> All loggers configured for JSON output to no-op destinations.
> See `bench/comparison/vs-alternatives.bench.ts` for methodology.

### simple string log

| Library | ops/sec | Mean | Relative |
|---------|--------:|-----:|---------:|
| consola | **2.79M** | 358ns | **fastest** |
| evlog | **1.83M** | 548ns | 1.53x slower |
| winston | **1.20M** | 830ns | 2.32x slower |
| pino | **1.09M** | 918ns | 2.56x slower |

### structured log (5 fields)

| Library | ops/sec | Mean | Relative |
|---------|--------:|-----:|---------:|
| consola | **1.71M** | 585ns | **fastest** |
| evlog | **1.64M** | 610ns | 1.04x slower |
| pino | **716.1K** | 1.40µs | 2.39x slower |
| winston | **431.6K** | 2.32µs | 3.96x slower |

### deep nested log

| Library | ops/sec | Mean | Relative |
|---------|--------:|-----:|---------:|
| evlog | **1.55M** | 643ns | **fastest** |
| consola | **1.01M** | 989ns | 1.54x slower |
| pino | **464.9K** | 2.15µs | 3.34x slower |
| winston | **164.0K** | 6.10µs | 9.48x slower |

### child / scoped logger

| Library | ops/sec | Mean | Relative |
|---------|--------:|-----:|---------:|
| evlog | **1.70M** | 587ns | **fastest** |
| pino | **845.0K** | 1.18µs | 2.02x slower |
| winston | **430.0K** | 2.33µs | 3.96x slower |
| consola | **280.4K** | 3.57µs | 6.07x slower |

### wide event lifecycle (evlog-native pattern)

| Library | ops/sec | Mean | Relative |
|---------|--------:|-----:|---------:|
| evlog | **1.58M** | 634ns | **fastest** |
| pino | **205.8K** | 4.86µs | 7.67x slower |
| winston | **111.9K** | 8.94µs | 14.10x slower |

### burst — 100 sequential logs

| Library | ops/sec | Mean | Relative |
|---------|--------:|-----:|---------:|
| consola | **39.4K** | 25.38µs | **fastest** |
| evlog | **17.8K** | 56.26µs | 2.22x slower |
| pino | **10.3K** | 97.47µs | 3.84x slower |
| winston | **7.5K** | 133.88µs | 5.28x slower |

### logger creation cost

| Library | ops/sec | Mean | Relative |
|---------|--------:|-----:|---------:|
| evlog | **16.85M** | 59ns | **fastest** |
| pino | **7.50M** | 133ns | 2.25x slower |
| winston | **5.38M** | 186ns | 3.13x slower |
| consola | **310.3K** | 3.22µs | 54.30x slower |

## Core benchmarks

### multi-step agent flush throughput

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| 6 steps, with subscriber | **3.0K** | 330.73µs | 624.27µs | 3,023 |
| 6 steps, no subscriber | **2.1K** | 473.03µs | 897.43µs | 2,114 |
| 50 steps, no subscriber | **1.3K** | 754.87µs | 3.088ms | 1,324 |
| 50 steps, with subscriber | **1.2K** | 846.61µs | 3.037ms | 1,181 |

### client log serialization

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| JSON.stringify — minimal log | **958.6K** | 1.04µs | 1.76µs | 958,577 |
| JSON.stringify — rich log | **367.3K** | 2.72µs | 4.32µs | 367,299 |
| JSON.stringify — batch of 10 | **53.5K** | 18.69µs | 24.14µs | 53,502 |
| JSON.stringify — batch of 50 | **11.1K** | 90.08µs | 127.03µs | 11,101 |

### client log formatting

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| build formatted log object (minimal) | **937.6K** | 1.07µs | 1.91µs | 937,631 |
| build formatted log object (with identity spread) | **865.2K** | 1.16µs | 2.07µs | 865,240 |
| build + serialize (rich log) | **485.2K** | 2.06µs | 3.68µs | 485,165 |

### pipeline — push throughput

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 1 event (no flush) | **306.0K** | 3.27µs | 5.89µs | 306,001 |
| push 100 events (no flush) | **10.1K** | 99.15µs | 188.07µs | 10,085 |
| push 1000 events (no flush) | **2.5K** | 396.94µs | 440.50µs | 2,519 |

### pipeline — push + batch trigger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 50 events (triggers 1 batch flush) | **31.7K** | 31.52µs | 47.62µs | 31,729 |
| push 200 events (triggers 4 batch flushes) | **17.6K** | 56.80µs | 342.63µs | 17,604 |

### pipeline — buffer overflow

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 1100 events (100 dropped, buffer=1000) | **3.6K** | 276.95µs | 518.29µs | 3,610 |

### pipeline — serialization in drain

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 50 + JSON.stringify batch in drain | **499** | 2.004ms | 14.089ms | 498 |

### createUserAgentEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no user-agent header | **6.36M** | 157ns | 354ns | 6,358,028 |
| Googlebot | **876.0K** | 1.14µs | 2.99µs | 875,954 |
| Chrome desktop | **700.6K** | 1.43µs | 3.10µs | 700,579 |
| Firefox Linux | **614.4K** | 1.63µs | 2.51µs | 614,363 |

### createGeoEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| Vercel headers (full) | **999.5K** | 1.00µs | 1.74µs | 999,520 |
| no geo headers | **522.0K** | 1.92µs | 3.43µs | 521,981 |
| Cloudflare headers (country only) | **247.5K** | 4.04µs | 6.92µs | 247,547 |

### createRequestSizeEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no content-length | **3.84M** | 260ns | 571ns | 3,843,432 |
| with content-length | **2.27M** | 440ns | 984ns | 2,271,483 |

### createTraceContextEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no trace headers | **2.17M** | 461ns | 1.05µs | 2,170,915 |
| with traceparent + tracestate | **1.34M** | 746ns | 1.40µs | 1,341,349 |
| with traceparent | **961.5K** | 1.04µs | 1.92µs | 961,500 |

### full enricher pipeline

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| all enrichers (no headers) | **216.8K** | 4.61µs | 6.74µs | 216,780 |
| all enrichers (all headers present) | **55.3K** | 18.08µs | 22.03µs | 55,308 |

### createError

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with status | **42.9K** | 23.33µs | 49.11µs | 42,872 |
| full options | **39.6K** | 25.26µs | 51.14µs | 39,583 |
| string message | **39.5K** | 25.29µs | 77.38µs | 39,547 |
| with cause | **30.8K** | 32.45µs | 64.89µs | 30,816 |

### parseError

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| parse string | **5.06M** | 198ns | 229ns | 5,061,147 |
| parse plain Error | **4.09M** | 245ns | 349ns | 4,087,445 |
| parse fetch-like error | **1.66M** | 603ns | 768ns | 1,659,665 |
| parse EvlogError | **891.9K** | 1.12µs | 1.60µs | 891,900 |

### createError + parseError round-trip

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| create + parse (simple) | **40.5K** | 24.71µs | 30.66µs | 40,474 |
| create + parse (full) | **35.4K** | 28.27µs | 45.46µs | 35,379 |

### EvlogError serialization

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| toJSON() | **1.00M** | 997ns | 1.65µs | 1,003,001 |
| JSON.stringify() | **427.4K** | 2.34µs | 4.51µs | 427,357 |
| toString() | **418.6K** | 2.39µs | 4.65µs | 418,608 |

### JSON serialization (production mode)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit + JSON.stringify | **533.0K** | 1.88µs | 3.23µs | 533,021 |

### pretty print (development mode)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit + pretty print | **571.3K** | 1.75µs | 2.88µs | 571,319 |

### silent mode (no output)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit silent (event build only) | **536.6K** | 1.86µs | 4.35µs | 536,618 |

### JSON.stringify baseline

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| raw JSON.stringify (same payload) | **704.5K** | 1.42µs | 2.28µs | 704,528 |

### createLogger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with shallow context | **2.55M** | 393ns | 653ns | 2,547,661 |
| no initial context | **2.31M** | 432ns | 790ns | 2,313,777 |
| with nested context | **1.62M** | 616ns | 1.40µs | 1,623,180 |

### createRequestLogger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with method + path | **3.36M** | 298ns | 760ns | 3,357,475 |
| with method + path + requestId | **1.93M** | 517ns | 1.07µs | 1,933,125 |

### log.set()

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| shallow merge (3 fields) | **470.9K** | 2.12µs | 4.32µs | 470,896 |
| multiple sequential sets | **155.3K** | 6.44µs | 9.20µs | 155,323 |
| shallow merge (10 fields) | **140.6K** | 7.11µs | 9.85µs | 140,566 |
| deep nested merge | **64.3K** | 15.54µs | 23.80µs | 64,336 |

### log.emit()

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit minimal event | **308.1K** | 3.25µs | 4.42µs | 308,097 |
| emit with context | **124.5K** | 8.03µs | 11.30µs | 124,496 |
| full lifecycle (create + set + emit) | **99.4K** | 10.06µs | 18.20µs | 99,433 |
| emit with error | **6.4K** | 155.36µs | 279.85µs | 6,436 |

### log.set() payload sizes

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| small payload (2 fields) | **197.7K** | 5.06µs | 9.17µs | 197,708 |
| medium payload (50 fields) | **23.5K** | 42.62µs | 76.59µs | 23,462 |
| large payload (200 nested fields) | **1.7K** | 604.05µs | 789.79µs | 1,655 |

### diagnostics channel

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit — channel enabled, no subscriber | **221.0K** | 4.53µs | 8.26µs | 220,991 |
| emit — channel disabled | **180.3K** | 5.55µs | 11.23µs | 180,268 |

### resolveMiddlewarePluginRunner (cached hot path)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no local plugins (returns global empty runner) | **8.52M** | 117ns | 213ns | 8,521,673 |
| 2 local plugins (cached after first call) | **7.93M** | 126ns | 239ns | 7,934,091 |
| 3 local plugins (cached after first call) | **7.63M** | 131ns | 244ns | 7,625,722 |

### createMiddlewareLogger (full per-request setup)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| 2 plugins (cached merge) | **445.1K** | 2.25µs | 5.36µs | 445,058 |
| no plugins, no headers | **252.0K** | 3.97µs | 9.31µs | 252,045 |
| no plugins, safe headers | **239.0K** | 4.18µs | 10.55µs | 239,033 |

### full request lifecycle (createMiddlewareLogger → set → finish)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no plugins, no drain | **162.8K** | 6.14µs | 15.49µs | 162,837 |
| 2 plugins, sync drain | **59.2K** | 16.88µs | 58.63µs | 59,241 |

### head sampling

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with sampling rates | **174.0K** | 5.75µs | 10.63µs | 173,975 |
| no sampling configured | **113.2K** | 8.83µs | 13.96µs | 113,187 |

### tail sampling (shouldKeep)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no match (fast path) | **10.29M** | 97ns | 188ns | 10,292,975 |
| status match | **10.20M** | 98ns | 180ns | 10,203,326 |
| duration match | **9.12M** | 110ns | 183ns | 9,121,597 |
| path glob match | **7.36M** | 136ns | 212ns | 7,355,364 |

### head + tail sampling combined

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| full emit with sampling (likely sampled out) | **758.7K** | 1.32µs | 3.08µs | 758,733 |
| full emit with force-keep (tail sampling hit) | **408.5K** | 2.45µs | 4.56µs | 408,529 |
