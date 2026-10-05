/** Tool names accepted by `/api/telemetry/ingest` when no override is configured. */
export const DEFAULT_ALLOWED_TOOLS = ['evlog-cli', 'evlog-action']

/**
 * Custom field keys accepted per tool. Mirrors `telemetry.set()` calls in each
 * tool's source — anything not listed here is dropped by `parseIngestBody()`.
 *
 * The list is deliberately per-name rather than a `init*` prefix rule: the
 * client decides what to send, this decides what is worth storing, and a
 * namespace rule would accept a key nobody here has looked at.
 *
 * `init*` comes from `initTelemetryFieldNames()` in `@evlog/cli`
 * (`src/lib/init/telemetry.ts`), `map*` from `mapTelemetryFieldNames()`, and
 * the `doctor` group from `doctorTelemetryFieldNames()`. Growing the CLI's
 * catalog or its rule registry adds names there, and a name missing here is
 * dropped silently — so regenerate this list when destinations, extras,
 * enrichers or map rules change.
 */
export const DEFAULT_ALLOWED_CUSTOM_KEYS: Record<string, string[]> = {
  'evlog-action': [
    'ghaAction',
    'ghaEvent',
    'baselineMode',
    'checkOutcome',
    'commentOutcome',
    'packages',
    'entryPoints',
    'score',
    'instrumented',
    'partial',
    'dark',
    'regressions',
    'fixed',
    'gatePassed',
    'baselineDelta',
  ],
  'evlog-cli': [
    // evlog doctor — which part of a setup people get stuck on
    'checksFailed',
    'checksWarned',
    'checksPassed',
    'workspace',
    'doctorEvlogFound',
    'doctorLogsSink',
    'doctorStackDetected',
    // evlog init — which options were picked
    'initFramework',
    'initDevDrain',
    'initSampling',
    'initInteractive',
    'initCancelled',
    'initProdDrainCount',
    'initFilesWritten',
    'initManualSteps',
    'initDryRun',
    'initDoctorFail',
    'initHadRepeatedErrors',
    'initHadAuditGaps',
    'initProdFs',
    'initProdAxiom',
    'initProdOtlp',
    'initProdPosthog',
    'initProdSentry',
    'initProdBetterStack',
    'initProdDatadog',
    'initProdHyperdx',
    'initProdNone',
    'initExtraEnrichers',
    'initExtraPipeline',
    'initExtraSampling',
    'initExtraErrorCatalog',
    'initExtraAuditCatalog',
    'initExtraVite',
    'initExtraAi',
    'initExtraBetterAuth',
    'initEnricherUserAgent',
    'initEnricherGeo',
    'initEnricherRequestSize',
    'initEnricherTraceContext',
    'initAgentGuide',
    'initAgentSkillsFound',
    'initAgentSkillsFailed',
    // evlog agents — how much of the guidance landed
    'agentsSkillsFound',
    'agentsSkillsInstalled',
    'agentsSkillsFailed',
    'agentsFilesWritten',
    'agentsAlready',
    'agentsDetected',
    'agentsDryRun',
    'agentsInteractive',
    'agentsCancelled',
    // evlog map — how projects actually score, and which rules fire or get waived
    'mapFramework',
    'mapFrameworkForced',
    'mapScore',
    'mapGrade',
    'mapView',
    'mapWrote',
    'mapEntryPoints',
    'mapSensitive',
    'mapSensitiveMoney',
    'mapSensitiveAuth',
    'mapSensitivePii',
    'mapInstrumented',
    'mapPartial',
    'mapDark',
    'mapDarkApi',
    'mapDarkPage',
    'mapDarkMiddleware',
    'mapDarkServerAction',
    'mapDarkCron',
    'mapDarkWebsocket',
    'mapDarkMoney',
    'mapDarkAuth',
    'mapDarkPii',
    'mapExempt',
    'mapKindApi',
    'mapKindPage',
    'mapKindMiddleware',
    'mapKindServerAction',
    'mapKindCron',
    'mapKindWebsocket',
    'mapSuppressedChecks',
    'mapWarnings',
    'mapSuggestions',
    'mapProjectSuggestions',
    'mapGate',
    'mapGateFailed',
    'mapMinScore',
    'mapBaselineDelta',
    'mapBaselineRegressions',
    'mapBaselineFixed',
    'mapBaselineAdded',
    'mapFailWideEvent',
    'mapSuppressedWideEvent',
    'mapFailContext',
    'mapSuppressedContext',
    'mapFailStructuredErrors',
    'mapSuppressedStructuredErrors',
    'mapFailAudit',
    'mapSuppressedAudit',
    'mapFailErrorHandling',
    'mapSuppressedErrorHandling',
    'mapFailPageErrorHandling',
    'mapSuppressedPageErrorHandling',
    'mapFailErrorCatalog',
    'mapSuppressedErrorCatalog',
    'mapFailAuditCoverage',
    'mapSuppressedAuditCoverage',
    'mapFailAiLogging',
    'mapSuppressedAiLogging',
    'mapFailAuthIdentity',
    'mapSuppressedAuthIdentity',
  ],
}

/** Parse a comma-separated allowlist of tool names from an env value. */
export function parseAllowedTools(raw: string | undefined): string[] {
  if (!raw?.trim()) return DEFAULT_ALLOWED_TOOLS
  const tools = raw.split(',').map(t => t.trim()).filter(Boolean)
  return tools.length > 0 ? tools : DEFAULT_ALLOWED_TOOLS
}

function isRecordOfStringArrays(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(
    v => Array.isArray(v) && v.every(item => typeof item === 'string'),
  )
}

/**
 * Parse a JSON-encoded `{ toolName: string[] }` custom-key allowlist from an
 * env value, merged on top of the built-in defaults above.
 */
export function parseAllowedCustomKeys(raw: string | undefined): Record<string, string[]> {
  if (!raw?.trim()) return DEFAULT_ALLOWED_CUSTOM_KEYS

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecordOfStringArrays(parsed)) return DEFAULT_ALLOWED_CUSTOM_KEYS
    return { ...DEFAULT_ALLOWED_CUSTOM_KEYS, ...parsed }
  } catch {
    return DEFAULT_ALLOWED_CUSTOM_KEYS
  }
}
