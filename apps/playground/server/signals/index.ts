import { fault } from './fault'
import { retryable } from './retryable'
import { severity } from './severity'
import { silentFailure } from './silent-failure'
import { validationBug } from './validation-bug'
import { webhookIgnored } from './webhook-ignored'

export const signals = [fault, severity, retryable, silentFailure, webhookIgnored, validationBug]
