import type { Migration } from '../types'
import v3 from './v3'

/** Every migration the CLI ships, ordered by target major. A new major is one more folder and one more entry. */
export const MIGRATIONS: readonly Migration[] = [v3]
