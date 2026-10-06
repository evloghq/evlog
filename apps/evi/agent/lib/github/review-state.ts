import { defineState } from 'eve/context'

export const reviewState = defineState('evi.pr-review', () => ({
  prepared: false,
  publishing: false,
  url: null as string | null,
}))
