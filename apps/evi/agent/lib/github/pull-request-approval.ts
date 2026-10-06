import type { SessionAuthContext } from 'eve/context'
import type { ApprovalStatus } from 'eve/tools/approval'
import { homeRepository, isHomeRepository } from '../repo'
import { isScheduleAppAuth } from '../trust'
import { writePolicy } from './label-approval'

/** Approval gate for pull requests delivered by scheduled runs. */
export function createPullRequestPolicy(auth: SessionAuthContext | null, toolInput: unknown): ApprovalStatus {
  if (isScheduleAppAuth(auth)) {
    const home = homeRepository()
    const input = toolInput as { owner?: string, repo?: string } | undefined
    if (input !== undefined && isHomeRepository({ owner: input.owner ?? home.owner, name: input.repo ?? home.repo })) {
      return 'not-applicable'
    }
  }
  return writePolicy(auth)
}
