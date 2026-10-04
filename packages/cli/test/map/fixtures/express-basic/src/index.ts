import express from 'express'
import { evlog } from 'evlog/express'
import { checkout } from './checkout'

const app = express()

app.use(evlog())
app.use('/api', checkout)

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

// Touched so the map preview workflow renders its annotations on this diff.

export default app
