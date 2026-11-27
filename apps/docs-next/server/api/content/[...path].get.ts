/**
 * Single data endpoint: `content.handler()` dispatches `get`, `navigation`, `list`, `manifest`
 * and `snapshot`. Cached per URL.
 */
export default defineEventHandler(async (event) => {
  const content = await getProdContent()

  return content.handler(toWebRequest(event))
})
