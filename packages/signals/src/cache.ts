/** Insertion-ordered map capped at `max` entries; the oldest entry goes first. */
export function createLru<TValue>(max: number) {
  const map = new Map<string, TValue>()
  return {
    get(key: string): TValue | undefined {
      const value = map.get(key)
      if (value === undefined) return undefined
      map.delete(key)
      map.set(key, value)
      return value
    },
    set(key: string, value: TValue): void {
      map.delete(key)
      map.set(key, value)
      if (map.size > max) map.delete(map.keys().next().value!)
    },
    delete(key: string): void {
      map.delete(key)
    },
    get size() {
      return map.size
    },
  }
}
