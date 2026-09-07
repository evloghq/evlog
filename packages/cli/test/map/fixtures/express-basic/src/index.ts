import express from 'express'
import { evlog } from 'evlog/express'
import checkout from './checkout'
import health from './health'

const app = express()

app.use(evlog())
app.use(checkout)
app.use(health)

export default app
