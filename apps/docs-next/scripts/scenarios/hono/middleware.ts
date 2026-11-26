import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db } from '../services.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.get('/users/:id', async c => c.json(await db.findUser(c.req.param('id'))))
