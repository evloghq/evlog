### Package Size

| Metric | Value |
|---|---|
| **npm tarball** | **91.8 kB** |
| Unpacked | 341.8 kB |
| Files | 117 |
| JS (`.mjs`) | 81.6 kB |
| Types (`.d.mts`) | 52.3 kB |
| Sourcemaps (`.map`) | 173.1 kB |

### Import Cost Per Entry Point

What users actually pay when importing a specific path (after tree-shaking):

| Import | Raw | Gzip | Includes |
|---|---|---|---|
| `evlog` | 14.6 kB | **5.4 kB** | index + logger + error + utils |
| `evlog/axiom` | 4.5 kB | **2.0 kB** | axiom + _http |
| `evlog/better-stack` | 4.7 kB | **2.1 kB** | better-stack + _http |
| `evlog/otlp` | 7.9 kB | **3.2 kB** | otlp + _http + _severity |
| `evlog/sentry` | 8.4 kB | **3.5 kB** | sentry + _http + _severity |
| `evlog/posthog` | 12.2 kB | **4.6 kB** | posthog + otlp + _http + _severity |
| `evlog/pipeline` | 4.2 kB | **1.4 kB** | pipeline |
| `evlog/enrichers` | 6.1 kB | **1.9 kB** | enrichers |
| `evlog/http` | 2.9 kB | **1.2 kB** | http |
| `evlog/workers` | 2.1 kB | **965 B** | workers |

### Shared Chunks

Internal modules deduplicated across entry points:

| Chunk | Size | Gzip | Used by |
|---|---|---|---|
| `_http` | 2.1 kB | 1014 B | all 5 adapters |
| `_severity` | 332 B | 257 B | otlp, sentry |
| `nitro` | 2.4 kB | 1.0 kB | nitro v2/v3 plugins + error handlers |

### Typical Setup Cost

| Scenario | Raw | Gzip |
|---|---|---|
| Core + 1 adapter + pipeline | 23.2 kB | **8.8 kB** |
| Core + 2 adapters + pipeline | 29.5 kB | **11.3 kB** |
| All 5 adapters (no core) | 23.1 kB | **9.0 kB** |

---

*Generated on 2026-02-15 from `dist/` — run `bash scripts/package-stats.sh` to update.*
