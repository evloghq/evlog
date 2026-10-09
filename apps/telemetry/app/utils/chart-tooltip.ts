/**
 * Unovis binds a `StackedBarDataRecord` wrapper (`{ datum, index, ... }`) to
 * each stacked bar path and hands that to the chart's tooltip slot instead of
 * the data row. `BarChart` unwraps it internally, `DualChart` does not, so
 * every category key the tooltip reads off the wrapper comes out `undefined`.
 */
export function unwrapTooltipDatum<T extends object>(values: T | undefined): T | undefined {
  const record = values as { datum?: T } | undefined
  return record?.datum ?? values
}
