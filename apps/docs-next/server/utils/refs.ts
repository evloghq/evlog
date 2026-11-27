/** A full commit SHA, lowercased. Anything else is `null`. */
export function parseCommitSha(value: string): string | null {
  const sha = value.trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}
