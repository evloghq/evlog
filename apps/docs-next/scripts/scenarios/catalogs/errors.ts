import { defineErrorCatalog } from 'evlog'

export const errors = defineErrorCatalog('app', {
  USER_NOT_FOUND: { status: 404, message: 'User not found' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  VALIDATION_FAILED: {
    status: 400,
    message: ({ field }: { field: string }) => `Invalid ${field}`,
  },
})
