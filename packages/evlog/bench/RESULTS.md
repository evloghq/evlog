# Benchmark results

> Generated on 2026-11-11

## Bundle size

> One row per `package.json#exports` subpath: its dist file plus every dist chunk it statically imports, unminified, gzipped together. Dependencies are not included. The total adds up the rows, so a chunk shared by several entries is counted once per entry.
> See `bench/scripts/size.ts` for methodology.

| Entry | Raw | Gzip |
|-------|----:|-----:|
| evlog/nuxt | 201.68 kB | 58.21 kB |
| evlog/eve | 197.26 kB | 55.70 kB |
| evlog/vite | 189.74 kB | 54.62 kB |
| evlog/toolkit | 170.76 kB | 51.16 kB |
| evlog/nitro/v3 | 169.61 kB | 50.70 kB |
| evlog/sveltekit | 162.60 kB | 48.26 kB |
| evlog/nitro | 159.91 kB | 47.81 kB |
| evlog | 158.37 kB | 47.25 kB |
| evlog/effect | 153.49 kB | 45.93 kB |
| evlog/orpc | 151.79 kB | 45.81 kB |
| evlog/next | 149.20 kB | 45.11 kB |
| evlog/elysia | 143.70 kB | 43.35 kB |
| evlog/nestjs | 143.74 kB | 43.34 kB |
| evlog/workers | 142.67 kB | 42.60 kB |
| evlog/fastify | 141.43 kB | 42.52 kB |
| evlog/hono | 140.02 kB | 42.44 kB |
| evlog/express | 140.98 kB | 42.42 kB |
| evlog/react-router | 140.00 kB | 42.11 kB |
| evlog/sentry | 60.29 kB | 19.15 kB |
| evlog/posthog | 60.61 kB | 18.51 kB |
| evlog/hyperdx | 54.61 kB | 16.96 kB |
| evlog/sazabi | 54.48 kB | 16.95 kB |
| evlog/otlp | 51.77 kB | 16.40 kB |
| evlog/datadog | 47.81 kB | 15.62 kB |
| evlog/fs | 47.50 kB | 15.46 kB |
| evlog/next/stream | 44.55 kB | 14.40 kB |
| evlog/loki | 40.84 kB | 13.67 kB |
| evlog/clickhouse | 41.21 kB | 13.62 kB |
| evlog/memory | 40.70 kB | 13.46 kB |
| evlog/axiom | 39.85 kB | 13.13 kB |
| evlog/better-stack | 39.45 kB | 13.00 kB |
| evlog/browser | 28.27 kB | 9.67 kB |
| evlog/next/instrumentation/create | 28.35 kB | 9.34 kB |
| evlog/enrichers | 25.39 kB | 8.57 kB |
| evlog/catalog | 22.10 kB | 7.70 kB |
| evlog/next/client | 21.26 kB | 7.47 kB |
| evlog/client | 20.34 kB | 7.16 kB |
| evlog/http | 19.08 kB | 6.95 kB |
| evlog/toolkit/storage | 18.65 kB | 6.85 kB |
| evlog/better-auth | 16.84 kB | 6.11 kB |
| evlog/ai | 20.94 kB | 5.52 kB |
| evlog/stream | 13.89 kB | 4.95 kB |
| evlog/pipeline | 5.79 kB | 1.96 kB |
| evlog/otlp/protobuf | 4.50 kB | 1.49 kB |
| evlog/diagnostics | 2.92 kB | 1.21 kB |
| evlog/next/instrumentation | 1.43 kB | 611 B |
| **Total** | **3730.41 kB** | **1135.20 kB** |

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

> Recorded 2026-11-11 (sandbox VM, not the GitHub Actions runner used by CI): Node v24.22.2, Intel(R) Xeon(R) Processor @ 2.50GHz (4 vCPU), Debian GNU/Linux 12 (bookworm), Linux 6.18.56 x86_64.
>
> These numbers only compare with a run on the same machine. Another machine, including a GitHub Actions runner, gives different numbers for the same code. The CI `bench` job benchmarks the base branch and the pull request on one runner and compares those two runs, not this baseline.

### multi-step agent flush throughput

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| 6 steps, with subscriber | **3.5K** | 283.48µs | 470.83µs | 1,764 |
| 6 steps, no subscriber | **3.4K** | 297.05µs | 528.84µs | 1,684 |
| 50 steps, no subscriber | **1.6K** | 637.75µs | 988.27µs | 785 |
| 50 steps, with subscriber | **1.2K** | 814.63µs | 3.324ms | 614 |

### client log serialization

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| JSON.stringify — minimal log | **1.59M** | 628ns | 1.20µs | 795,875 |
| JSON.stringify — rich log | **583.6K** | 1.71µs | 3.85µs | 291,819 |
| JSON.stringify — batch of 10 | **69.7K** | 14.34µs | 34.72µs | 34,864 |
| JSON.stringify — batch of 50 | **14.9K** | 66.92µs | 162.62µs | 7,472 |

### client log formatting

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| build formatted log object (minimal) | **863.0K** | 1.16µs | 2.27µs | 431,498 |
| build formatted log object (with identity spread) | **705.6K** | 1.42µs | 2.55µs | 352,795 |
| build + serialize (rich log) | **405.2K** | 2.47µs | 4.30µs | 202,624 |

### pipeline — push throughput

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 1 event (no flush) | **316.6K** | 3.16µs | 8.08µs | 158,304 |
| push 100 events (no flush) | **7.7K** | 129.63µs | 205.35µs | 3,857 |
| push 1000 events (no flush) | **1.9K** | 534.95µs | 540.42µs | 935 |

### pipeline — push + batch trigger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 50 events (triggers 1 batch flush) | **39.3K** | 25.42µs | 50.82µs | 19,673 |
| push 200 events (triggers 4 batch flushes) | **2.9K** | 340.49µs | 5.821ms | 1,763 |

### pipeline — buffer overflow

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 1100 events (100 dropped, buffer=1000) | **3.0K** | 328.38µs | 668.96µs | 1,594 |

### pipeline — serialization in drain

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| push 50 + JSON.stringify batch in drain | **8.8K** | 113.59µs | 512.85µs | 4,454 |

### createUserAgentEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no user-agent header | **6.49M** | 154ns | 296ns | 3,247,045 |
| Googlebot | **1.19M** | 841ns | 1.37µs | 594,648 |
| Firefox Linux | **1.07M** | 933ns | 1.60µs | 535,901 |
| Chrome desktop | **680.7K** | 1.47µs | 3.56µs | 340,351 |

### createGeoEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| Vercel headers (full) | **1.04M** | 965ns | 1.56µs | 517,909 |
| no geo headers | **562.4K** | 1.78µs | 3.37µs | 281,182 |
| Cloudflare headers (country only) | **245.4K** | 4.08µs | 6.48µs | 122,690 |

### createRequestSizeEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no content-length | **3.90M** | 256ns | 443ns | 1,949,539 |
| with content-length | **3.02M** | 332ns | 560ns | 1,508,232 |

### createTraceContextEnricher

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no trace headers | **3.24M** | 308ns | 516ns | 1,621,487 |
| with traceparent + tracestate | **1.45M** | 692ns | 1.02µs | 722,954 |
| with traceparent | **1.09M** | 920ns | 1.29µs | 543,723 |

### full enricher pipeline

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| all enrichers (no headers) | **441.7K** | 2.26µs | 3.49µs | 220,871 |
| all enrichers (all headers present) | **121.9K** | 8.20µs | 17.91µs | 60,975 |

### createError

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| string message | **145.1K** | 6.89µs | 18.33µs | 72,538 |
| with status | **136.0K** | 7.35µs | 16.93µs | 67,988 |
| full options | **130.3K** | 7.67µs | 20.10µs | 65,171 |
| with cause | **107.5K** | 9.30µs | 21.18µs | 53,743 |

### parseError

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| parse string | **8.78M** | 114ns | 233ns | 4,389,754 |
| parse plain Error | **8.10M** | 123ns | 267ns | 4,050,565 |
| parse fetch-like error | **5.18M** | 193ns | 318ns | 2,591,595 |
| parse EvlogError | **1.81M** | 553ns | 815ns | 904,225 |

### createError + parseError round-trip

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| create + parse (simple) | **140.2K** | 7.13µs | 13.37µs | 70,105 |
| create + parse (full) | **101.4K** | 9.86µs | 20.86µs | 50,691 |

### EvlogError serialization

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| toJSON() | **2.04M** | 490ns | 661ns | 1,019,683 |
| toString() | **1.03M** | 974ns | 2.07µs | 513,580 |
| JSON.stringify() | **593.8K** | 1.68µs | 2.73µs | 296,892 |

### JSON serialization (production mode)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit + JSON.stringify | **326.5K** | 3.06µs | 5.80µs | 163,648 |

### pretty print (development mode)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit + pretty print | **278.9K** | 3.59µs | 6.05µs | 139,624 |

### silent mode (no output)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit silent (event build only) | **301.3K** | 3.32µs | 5.70µs | 150,637 |

### JSON.stringify baseline

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| raw JSON.stringify (same payload) | **679.9K** | 1.47µs | 2.63µs | 339,929 |

### createLogger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no initial context | **2.10M** | 475ns | 1.16µs | 1,052,033 |
| with shallow context | **1.26M** | 791ns | 1.78µs | 632,114 |
| with nested context | **616.8K** | 1.62µs | 3.38µs | 308,408 |

### createRequestLogger

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with method + path | **1.43M** | 701ns | 1.36µs | 712,880 |
| with method + path + requestId | **1.01M** | 994ns | 1.69µs | 502,777 |

### log.set()

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| shallow merge (3 fields) | **693.3K** | 1.44µs | 2.17µs | 346,638 |
| multiple sequential sets | **337.3K** | 2.96µs | 4.51µs | 168,653 |
| shallow merge (10 fields) | **279.6K** | 3.58µs | 6.19µs | 139,818 |
| merge into an existing nested key | **233.9K** | 4.27µs | 6.31µs | 116,965 |
| deep nested merge | **159.3K** | 6.28µs | 12.36µs | 79,647 |

### log.emit()

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit minimal event | **613.4K** | 1.63µs | 2.44µs | 309,027 |
| emit with context | **243.2K** | 4.11µs | 6.32µs | 121,616 |
| full lifecycle (create + set + emit) | **203.9K** | 4.90µs | 5.76µs | 101,939 |
| emit with error | **18.1K** | 55.24µs | 95.87µs | 9,052 |

### log.set() payload sizes

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| small payload (2 fields) | **365.4K** | 2.74µs | 4.10µs | 182,710 |
| medium payload (50 fields) | **54.9K** | 18.21µs | 37.52µs | 27,462 |
| large payload (200 nested fields) | **4.2K** | 239.97µs | 277.78µs | 2,084 |

### diagnostics channel

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| emit — channel disabled | **295.2K** | 3.39µs | 5.14µs | 147,603 |
| emit — channel enabled, no subscriber | **289.8K** | 3.45µs | 5.40µs | 144,922 |

### resolveMiddlewarePluginRunner (cached hot path)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no local plugins (returns global empty runner) | **9.16M** | 109ns | 227ns | 4,578,892 |
| 3 local plugins (cached after first call) | **7.84M** | 127ns | 260ns | 3,922,212 |
| 2 local plugins (cached after first call) | **7.65M** | 131ns | 256ns | 3,826,325 |

### createMiddlewareLogger (full per-request setup)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no plugins, no headers | **429.0K** | 2.33µs | 6.58µs | 214,518 |
| no plugins, safe headers | **421.7K** | 2.37µs | 6.12µs | 211,346 |
| 2 plugins (cached merge) | **354.2K** | 2.82µs | 6.79µs | 177,125 |

### full request lifecycle (createMiddlewareLogger → set → finish)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| no plugins, no drain | **188.3K** | 5.31µs | 13.84µs | 94,155 |
| 2 plugins, sync drain | **122.0K** | 8.20µs | 19.82µs | 61,008 |

### redactEvent with default built-ins

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| request event, nothing to redact | **374.1K** | 2.67µs | 4.72µs | 187,067 |
| checkout event, nothing to redact | **110.2K** | 9.08µs | 18.91µs | 55,093 |
| checkout event with PII | **58.8K** | 17.00µs | 34.63µs | 29,417 |
| event holding a Date (structuredClone path) | **43.8K** | 22.82µs | 51.04µs | 21,916 |

### emit with redaction

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| redact: false | **135.0K** | 7.41µs | 14.81µs | 67,493 |
| redact: true | **65.4K** | 15.30µs | 31.94µs | 32,679 |

### head sampling

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| with sampling rates | **186.5K** | 5.36µs | 10.36µs | 93,246 |
| no sampling configured | **149.7K** | 6.68µs | 11.19µs | 74,854 |

### tail sampling (shouldKeep)

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| duration match | **12.11M** | 83ns | 136ns | 6,056,470 |
| path glob match | **11.60M** | 86ns | 112ns | 5,797,825 |
| status match | **11.59M** | 86ns | 174ns | 5,793,917 |
| no match (fast path) | **10.68M** | 94ns | 185ns | 5,340,278 |

### head + tail sampling combined

| Benchmark | ops/sec | Mean | p99 | Samples |
|-----------|--------:|-----:|----:|--------:|
| full emit with sampling (likely sampled out) | **1.02M** | 985ns | 2.00µs | 507,729 |
| full emit with force-keep (tail sampling hit) | **670.4K** | 1.49µs | 2.63µs | 335,210 |
