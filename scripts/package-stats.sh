#!/usr/bin/env bash
# Generate .github/snippets/package-stats.md from the built dist/
# Usage: pnpm run build && bash scripts/package-stats.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/evlog"
DIST="$PKG/dist"
OUT="$ROOT/.github/snippets/package-stats.md"

if [ ! -d "$DIST" ]; then
  echo "Error: dist/ not found. Run 'pnpm run build' first." >&2
  exit 1
fi

# ── helpers ──────────────────────────────────────────────────────────
bytes() { wc -c < "$1" | tr -d ' '; }
gzbytes() { gzip -c "$1" | wc -c | tr -d ' '; }
human() {
  local b=$1
  if [ "$b" -ge 1024 ]; then
    awk "BEGIN { printf \"%.1f kB\", $b/1024 }"
  else
    echo "${b} B"
  fi
}

# total size of a list of files (raw + gz)
entry_cost() {
  local raw=0 gz=0
  for f in "$@"; do
    raw=$((raw + $(bytes "$f")))
    gz=$((gz + $(gzbytes "$f")))
  done
  echo "$raw $gz"
}

# format a row: | name | raw | gzip | files |
row() {
  local name=$1; shift
  local files_label=$1; shift
  local pair
  pair=$(entry_cost "$@")
  local raw gz
  raw=$(echo "$pair" | cut -d' ' -f1)
  gz=$(echo "$pair" | cut -d' ' -f2)
  printf "| \`%s\` | %s | **%s** | %s |\n" "$name" "$(human "$raw")" "$(human "$gz")" "$files_label"
}

# ── npm tarball ──────────────────────────────────────────────────────
tarball_line=$(cd "$PKG" && npm pack --dry-run 2>&1 | grep "package size")
tarball_size=$(echo "$tarball_line" | sed 's/.*package size: *//' | sed 's/ *$//')

unpacked_line=$(cd "$PKG" && npm pack --dry-run 2>&1 | grep "unpacked size")
unpacked_size=$(echo "$unpacked_line" | sed 's/.*unpacked size: *//' | sed 's/ *$//')

file_count=$(cd "$PKG" && npm pack --dry-run 2>&1 | grep "total files" | sed 's/.*total files: *//' | sed 's/ *$//')

js_total=$(find "$DIST" -name '*.mjs' ! -name '*.map' ! -name '*.d.mts' -exec cat {} + | wc -c | tr -d ' ')
dts_total=$(find "$DIST" -name '*.d.mts' -exec cat {} + | wc -c | tr -d ' ')
map_total=$(find "$DIST" -name '*.map' -exec cat {} + | wc -c | tr -d ' ')

# ── shared chunks ────────────────────────────────────────────────────
HTTP_CHUNK=$(find "$DIST" -maxdepth 1 -name '_http-*.mjs' ! -name '*.map' | head -1)
SEV_CHUNK=$(find "$DIST" -maxdepth 1 -name '_severity-*.mjs' ! -name '*.map' | head -1)
NITRO_CHUNK=$(find "$DIST" -maxdepth 1 -name 'nitro-*.mjs' ! -name '*.map' ! -name '*.d.mts' | head -1)

# ── write snippet ────────────────────────────────────────────────────
cat > "$OUT" << 'HEADER'
### Package Size

HEADER

cat >> "$OUT" << EOF
| Metric | Value |
|---|---|
| **npm tarball** | **${tarball_size}** |
| Unpacked | ${unpacked_size} |
| Files | ${file_count} |
| JS (\`.mjs\`) | $(human "$js_total") |
| Types (\`.d.mts\`) | $(human "$dts_total") |
| Sourcemaps (\`.map\`) | $(human "$map_total") |
EOF

cat >> "$OUT" << 'HEADER'

### Import Cost Per Entry Point

What users actually pay when importing a specific path (after tree-shaking):

| Import | Raw | Gzip | Includes |
|---|---|---|---|
HEADER

# Core
row "evlog" "index + logger + error + utils" \
  "$DIST/index.mjs" "$DIST/logger.mjs" "$DIST/error.mjs" "$DIST/utils.mjs" >> "$OUT"

# Adapters
row "evlog/axiom" "axiom + _http" \
  "$DIST/adapters/axiom.mjs" "$HTTP_CHUNK" >> "$OUT"

row "evlog/better-stack" "better-stack + _http" \
  "$DIST/adapters/better-stack.mjs" "$HTTP_CHUNK" >> "$OUT"

row "evlog/otlp" "otlp + _http + _severity" \
  "$DIST/adapters/otlp.mjs" "$HTTP_CHUNK" "$SEV_CHUNK" >> "$OUT"

row "evlog/sentry" "sentry + _http + _severity" \
  "$DIST/adapters/sentry.mjs" "$HTTP_CHUNK" "$SEV_CHUNK" >> "$OUT"

row "evlog/posthog" "posthog + otlp + _http + _severity" \
  "$DIST/adapters/posthog.mjs" "$DIST/adapters/otlp.mjs" "$HTTP_CHUNK" "$SEV_CHUNK" >> "$OUT"

# Other entries
row "evlog/pipeline" "pipeline" \
  "$DIST/pipeline.mjs" >> "$OUT"

row "evlog/enrichers" "enrichers" \
  "$DIST/enrichers.mjs" >> "$OUT"

row "evlog/http" "http" \
  "$DIST/http.mjs" >> "$OUT"

row "evlog/workers" "workers" \
  "$DIST/workers.mjs" >> "$OUT"

cat >> "$OUT" << 'HEADER'

### Shared Chunks

Internal modules deduplicated across entry points:

| Chunk | Size | Gzip | Used by |
|---|---|---|---|
HEADER

printf "| \`_http\` | %s | %s | all 5 adapters |\n" \
  "$(human "$(bytes "$HTTP_CHUNK")")" "$(human "$(gzbytes "$HTTP_CHUNK")")" >> "$OUT"

printf "| \`_severity\` | %s | %s | otlp, sentry |\n" \
  "$(human "$(bytes "$SEV_CHUNK")")" "$(human "$(gzbytes "$SEV_CHUNK")")" >> "$OUT"

printf "| \`nitro\` | %s | %s | nitro v2/v3 plugins + error handlers |\n" \
  "$(human "$(bytes "$NITRO_CHUNK")")" "$(human "$(gzbytes "$NITRO_CHUNK")")" >> "$OUT"

cat >> "$OUT" << 'HEADER'

### Typical Setup Cost

| Scenario | Raw | Gzip |
|---|---|---|
HEADER

# core + axiom + pipeline
pair=$(entry_cost "$DIST/index.mjs" "$DIST/logger.mjs" "$DIST/error.mjs" "$DIST/utils.mjs" \
  "$DIST/adapters/axiom.mjs" "$HTTP_CHUNK" "$DIST/pipeline.mjs")
printf "| Core + 1 adapter + pipeline | %s | **%s** |\n" \
  "$(human "$(echo "$pair" | cut -d' ' -f1)")" \
  "$(human "$(echo "$pair" | cut -d' ' -f2)")" >> "$OUT"

# core + 2 adapters + pipeline
pair=$(entry_cost "$DIST/index.mjs" "$DIST/logger.mjs" "$DIST/error.mjs" "$DIST/utils.mjs" \
  "$DIST/adapters/axiom.mjs" "$DIST/adapters/sentry.mjs" "$HTTP_CHUNK" "$SEV_CHUNK" "$DIST/pipeline.mjs")
printf "| Core + 2 adapters + pipeline | %s | **%s** |\n" \
  "$(human "$(echo "$pair" | cut -d' ' -f1)")" \
  "$(human "$(echo "$pair" | cut -d' ' -f2)")" >> "$OUT"

# all 5 adapters
pair=$(entry_cost "$DIST/adapters/axiom.mjs" "$DIST/adapters/better-stack.mjs" \
  "$DIST/adapters/otlp.mjs" "$DIST/adapters/posthog.mjs" "$DIST/adapters/sentry.mjs" \
  "$HTTP_CHUNK" "$SEV_CHUNK")
printf "| All 5 adapters (no core) | %s | **%s** |\n" \
  "$(human "$(echo "$pair" | cut -d' ' -f1)")" \
  "$(human "$(echo "$pair" | cut -d' ' -f2)")" >> "$OUT"

echo "" >> "$OUT"
echo "---" >> "$OUT"
echo "" >> "$OUT"
echo "*Generated on $(date -u +%Y-%m-%d) from \`dist/\` — run \`bash scripts/package-stats.sh\` to update.*" >> "$OUT"

echo "✓ Written to $OUT"
