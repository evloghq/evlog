# Benchmark results

> Generated on 2026-10-01

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

### client log serialization

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| JSON.stringify — minimal log | **5.97M** | 168ns | 250ns | 5,969,107 |
| JSON.stringify — rich log | **2.13M** | 469ns | 584ns | 2,132,306 |
| JSON.stringify — batch of 10 | **275.7K** | 3.63µs | 4.83µs | 275,731 |
| JSON.stringify — batch of 50 | **55.9K** | 17.90µs | 29.21µs | 55,862 |

### client log formatting

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| build formatted log object (minimal) | **2.45M** | 408ns | 542ns | 2,451,522 |
| build formatted log object (with identity spread) | **2.18M** | 459ns | 584ns | 2,179,945 |
| build + serialize (rich log) | **1.39M** | 720ns | 917ns | 1,388,077 |

### pipeline — push throughput

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 1 event (no flush) | **1.26M** | 796ns | 1.42µs | 1,256,009 |
| push 100 events (no flush) | **28.8K** | 34.73µs | 72.38µs | 28,792 |
| push 1000 events (no flush) | **9.0K** | 110.99µs | 430.21µs | 9,010 |

### pipeline — push + batch trigger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 50 events (triggers 1 batch flush) | **35.6K** | 28.11µs | 114.33µs | 35,573 |
| push 200 events (triggers 4 batch flushes) | **4.9K** | 203.08µs | 5.059ms | 4,924 |

### pipeline — buffer overflow

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 1100 events (100 dropped, buffer=1000) | **2.6K** | 386.00µs | 2.985ms | 2,590 |

### pipeline — serialization in drain

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 50 + JSON.stringify batch in drain | **14.9K** | 67.31µs | 1.995ms | 14,857 |

### createUserAgentEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no user-agent header | **28.12M** | 36ns | 42ns | 28,120,021 |
| Googlebot | **4.43M** | 226ns | 333ns | 4,426,209 |
| Firefox Linux | **4.31M** | 232ns | 334ns | 4,307,787 |
| Chrome desktop | **2.61M** | 384ns | 583ns | 2,605,120 |

### createGeoEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| Vercel headers (full) | **3.88M** | 258ns | 334ns | 3,875,361 |
| no geo headers | **1.99M** | 503ns | 667ns | 1,986,473 |
| Cloudflare headers (country only) | **1.00M** | 999ns | 1.33µs | 1,000,528 |

### createRequestSizeEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no content-length | **15.15M** | 66ns | 84ns | 15,151,293 |
| with content-length | **12.37M** | 81ns | 125ns | 12,365,509 |

### createTraceContextEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no trace headers | **14.40M** | 69ns | 84ns | 14,403,507 |
| with traceparent + tracestate | **5.85M** | 171ns | 250ns | 5,854,833 |
| with traceparent | **4.35M** | 230ns | 333ns | 4,349,656 |

### full enricher pipeline

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| all enrichers (no headers) | **1.59M** | 629ns | 792ns | 1,589,875 |
| all enrichers (all headers present) | **466.7K** | 2.14µs | 2.71µs | 466,694 |

### createError

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| string message | **232.2K** | 4.31µs | 6.71µs | 232,175 |
| with status | **229.4K** | 4.36µs | 5.83µs | 229,369 |
| full options | **222.9K** | 4.49µs | 9.17µs | 222,937 |
| with cause | **168.3K** | 5.94µs | 13.54µs | 168,299 |

### parseError

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| parse fetch-like error | **45.48M** | 22ns | 42ns | 45,475,043 |
| parse string | **44.03M** | 23ns | 42ns | 44,031,479 |
| parse plain Error | **39.34M** | 25ns | 42ns | 39,336,243 |
| parse EvlogError | **16.50M** | 61ns | 84ns | 16,501,523 |

### createError + parseError round-trip

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| create + parse (simple) | **231.4K** | 4.32µs | 10.75µs | 231,422 |
| create + parse (full) | **165.1K** | 6.06µs | 11.62µs | 165,092 |

### EvlogError serialization

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| toJSON() | **13.21M** | 76ns | 125ns | 13,210,889 |
| toString() | **4.06M** | 247ns | 375ns | 4,056,286 |
| JSON.stringify() | **2.30M** | 435ns | 625ns | 2,299,291 |

### JSON serialization (production mode)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit + JSON.stringify | **1.87M** | 534ns | 709ns | 1,871,668 |

### pretty print (development mode)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit + pretty print | **1.86M** | 538ns | 709ns | 1,858,187 |

### silent mode (no output)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit silent (event build only) | **1.88M** | 532ns | 709ns | 1,878,393 |

### JSON.stringify baseline

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| raw JSON.stringify (same payload) | **2.21M** | 453ns | 583ns | 2,206,855 |

### createLogger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no initial context | **19.20M** | 52ns | 84ns | 19,197,292 |
| with shallow context | **18.74M** | 53ns | 84ns | 18,737,081 |
| with nested context | **17.70M** | 56ns | 84ns | 17,700,949 |

### createRequestLogger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with method + path | **16.91M** | 59ns | 125ns | 16,913,825 |
| with method + path + requestId | **12.67M** | 79ns | 125ns | 12,666,491 |

### log.set()

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| shallow merge (3 fields) | **9.56M** | 105ns | 167ns | 9,558,219 |
| deep nested merge | **8.04M** | 124ns | 208ns | 8,038,978 |
| multiple sequential sets | **7.05M** | 142ns | 250ns | 7,054,413 |
| shallow merge (10 fields) | **4.79M** | 209ns | 292ns | 4,794,907 |

### log.emit()

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit minimal event | **1.93M** | 519ns | 667ns | 1,927,892 |
| emit with context | **1.70M** | 588ns | 791ns | 1,700,748 |
| full lifecycle (create + set + emit) | **1.59M** | 628ns | 833ns | 1,592,043 |
| emit with error | **65.9K** | 15.17µs | 24.42µs | 65,905 |

### log.set() payload sizes

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| small payload (2 fields) | **1.72M** | 581ns | 750ns | 1,720,124 |
| medium payload (50 fields) | **569.8K** | 1.76µs | 2.25µs | 569,755 |
| large payload (200 nested fields) | **131.2K** | 7.62µs | 10.75µs | 131,158 |

### resolveMiddlewarePluginRunner (cached hot path)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no local plugins (returns global empty runner) | **37.70M** | 27ns | 42ns | 37,703,241 |
| 2 local plugins (cached after first call) | **32.26M** | 31ns | 42ns | 32,263,913 |
| 3 local plugins (cached after first call) | **31.66M** | 32ns | 42ns | 31,657,413 |

### createMiddlewareLogger (full per-request setup)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no plugins, safe headers | **4.41M** | 227ns | 666ns | 4,409,813 |
| no plugins, no headers | **4.23M** | 236ns | 625ns | 4,234,355 |
| 2 plugins (cached merge) | **4.13M** | 242ns | 750ns | 4,126,493 |

### full request lifecycle (createMiddlewareLogger → set → finish)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no plugins, no drain | **993.7K** | 1.01µs | 1.79µs | 993,739 |
| 2 plugins, sync drain | **621.2K** | 1.61µs | 2.46µs | 621,163 |

### head sampling

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with sampling rates | **460.2K** | 2.17µs | 3.12µs | 460,197 |
| no sampling configured | **382.4K** | 2.61µs | 3.54µs | 382,420 |

### tail sampling (shouldKeep)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| status match | **44.97M** | 22ns | 42ns | 44,971,910 |
| duration match | **44.72M** | 22ns | 42ns | 44,724,939 |
| no match (fast path) | **44.66M** | 22ns | 42ns | 44,658,746 |
| path glob match | **44.48M** | 22ns | 42ns | 44,484,819 |

### head + tail sampling combined

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| full emit with sampling (likely sampled out) | **7.01M** | 143ns | 583ns | 7,012,395 |
| full emit with force-keep (tail sampling hit) | **6.35M** | 157ns | 625ns | 6,352,187 |
