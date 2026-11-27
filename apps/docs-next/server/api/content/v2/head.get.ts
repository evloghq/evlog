export default defineEventHandler(async () => ({ sha: await resolveVersionSha('v2') }))
