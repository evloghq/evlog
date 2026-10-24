import { createBetterStackDrain, type BetterStackConfig } from 'evlog/better-stack'

const config: Partial<BetterStackConfig> = { apiKey: process.env.BETTER_STACK_API_KEY }

export const drain = createBetterStackDrain(config)
