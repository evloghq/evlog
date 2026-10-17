import { defineTool } from 'eve/tools'
import bash from 'eve/tools/bash'
import { reviewExecutionPolicy } from '../lib/github/external-review'

export default defineTool({
  ...bash,
  approval: reviewExecutionPolicy,
})
