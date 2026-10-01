import type { EvlogError } from 'evlog'
import { defineErrorCatalog } from 'evlog'

/**
 * Every failure Evi authors, with a stable code. Messages are Evi's own words;
 * third-party response bodies go to `internal`, which never reaches a drain or
 * a tool result, so the metadata-only PostHog policy holds for errors too.
 */
export const eviErrors = defineErrorCatalog('evi', {
  TOOL_NOT_AVAILABLE: {
    status: 403,
    message: ({ tool }: { tool: string }) => `${tool} is not available in this session.`,
  },
  INPUT_REFUSED: { status: 400, message: 'The tool input was refused.' },

  GITHUB_NOT_INSTALLED: {
    status: 403,
    message: ({ owner, repository }: { owner: string, repository: string }) =>
      `evlogai is not installed on ${owner}, so ${repository} is out of reach.`,
    fix: 'Install the App on that account first.',
  },
  GITHUB_NO_INSTALLATION_TOKEN: { message: 'The GitHub connector exposes no installation token.' },
  // Template params never reuse an override key (`status`, `message`, `fix`, ...): the factory peels those off first.
  GITHUB_REQUEST_FAILED: {
    status: 502,
    message: ({ request, responseStatus }: { request: string, responseStatus: number }) => `GitHub ${request} failed (${responseStatus})`,
  },
  GIT_PUSH_REFUSED: { status: 403, message: 'The branch may not be pushed.' },
  GIT_COMMAND_FAILED: {
    message: ({ command, exitCode }: { command: string, exitCode: number }) => `git ${command} exited ${exitCode}`,
  },
  GIT_NO_COMMITS: {
    message: ({ repository }: { repository: string }) => `${repository} has no commits to check out.`,
  },
  INSTALL_FAILED: { message: ({ exitCode }: { exitCode: number }) => `install exited ${exitCode}` },

  TURBO_NOT_CONFIGURED: {
    message: 'TURBO_TEAM and VERCEL_TEAM_ID must be configured for remote caching.',
  },
  TURBO_NO_OIDC_TOKEN: { message: 'No Vercel OIDC token available.' },
  TURBO_TOKEN_EXCHANGE_FAILED: { status: 502, message: 'Turborepo token exchange failed.' },
  TURBO_TOKEN_MISSING: { status: 502, message: 'Turborepo token exchange returned no access_token.' },
  TURBO_CONFIG_UNSAFE: {
    message: ({ name }: { name: string }) => `Unexpected characters in the Turborepo ${name}.`,
  },
  TURBO_CONFIG_WRITE_FAILED: { message: 'Writing the turbo config failed.' },

  VERCEL_ENV_DENIED: { status: 403, message: 'The environment variable write was denied by policy.' },
  VERCEL_NO_CONNECT_TOKEN: { message: 'No Vercel Connect token available.' },
  VERCEL_REQUEST_FAILED: {
    status: 502,
    message: ({ responseStatus }: { responseStatus: number }) => `The Vercel API returned ${responseStatus}`,
  },

  AI_GATEWAY_NOT_CONFIGURED: {
    message: 'No AI Gateway credential: AI_GATEWAY_API_KEY is unset and no Vercel OIDC token is available.',
    fix: 'Run on the Vercel deployment, run `vercel env pull` locally, or set AI_GATEWAY_API_KEY.',
  },
  AI_GATEWAY_REQUEST_FAILED: {
    status: 502,
    message: ({ responseStatus }: { responseStatus: number }) => `AI Gateway API error (${responseStatus})`,
  },

  CAPTURE_ORIGIN_REFUSED: { status: 403, message: 'The URL is outside the allowed capture origins.' },
  CAPTURE_PROBE_MISSING: {
    message: 'The browser returned no target probe. The page did not load, or the expression failed.',
  },
  CAPTURE_TARGET_UNRESOLVED: { status: 400, message: 'No capture target matched on the page.' },

  BLOB_TOKEN_MISSING: {
    message: 'BLOB_READ_WRITE_TOKEN is not configured.',
    fix: 'Locally, run `vercel env pull` in apps/evi.',
  },
  BLOB_UPLOAD_FAILED: { message: 'The image was not uploaded.' },
  IMAGE_URL_REFUSED: { status: 400, message: 'The image URL is not on a supported host.' },
  IMAGE_FETCH_FAILED: { status: 502, message: 'The image could not be fetched.' },

  CONTENT_SCAN_FAILED: { message: 'content-lint did not produce a report.' },
  CONTENT_COMMAND_FAILED: { message: 'A content command failed.' },
  CONTENT_SOURCE_DIRTY: {
    status: 409,
    message: 'Commit source changes before capturing or loading a page.',
  },
  CONTENT_PAGE_UNREADABLE: { message: 'Page could not be read.' },
  CONTENT_SNAPSHOT_STALE: {
    status: 409,
    message: 'Page or source revision changed since review. Capture and review it again.',
  },

  SLACK_CHANNEL_NOT_CONFIGURED: {
    message: 'EVI_SLACK_CHANNEL_ID is required for scheduled runs.',
    fix: 'Set EVI_SLACK_CHANNEL_ID on the deployment.',
  },
  REPOSITORY_SLUG_INVALID: {
    message: ({ slug }: { slug: string }) => `EVI_REPOSITORY must be an owner/repo slug, got "${slug}".`,
  },
})

declare module 'evlog' {
  interface RegisteredErrorCatalogs {
    evi: typeof eviErrors
  }
}

/** A refused tool call: the model reads `error` (message and fix), the wide event charts `code`. */
export interface ToolRefusal {
  readonly success: false
  readonly code: string
  readonly error: string
}

export function refusal(error: EvlogError): ToolRefusal {
  if (error.code === undefined) throw new TypeError('refusal() takes a catalog error.')
  return { success: false, code: error.code, error: error.fix ? `${error.message} ${error.fix}` : error.message }
}
