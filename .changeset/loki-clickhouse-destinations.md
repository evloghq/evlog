---
"@evlog/cli": minor
---

`evlog init` offers Grafana Loki and ClickHouse as production destinations. Choosing one wires `createLokiDrain()` from `evlog/loki` or `createClickHouseDrain()` from `evlog/clickhouse`, and asks for `LOKI_ENDPOINT` or `CLICKHOUSE_ENDPOINT`.
