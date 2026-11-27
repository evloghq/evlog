export async function digest(text: string): Promise<{ checksum: string; size: number }> {
  const data = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(hashBuffer)
  let checksum = ''
  for (const byte of bytes) {
    checksum += byte.toString(16).padStart(2, '0')
  }
  return { checksum, size: data.byteLength }
}
