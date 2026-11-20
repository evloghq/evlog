import { createDrainPipeline } from '../../../src/pipeline'

const { PORT, MODE } = process.env
const drain = createDrainPipeline<{ id: number }>({ batch: { size: 100, intervalMs: 60_000 } })(async (batch) => {
  await fetch(`http://127.0.0.1:${PORT}`, { method: 'POST', body: JSON.stringify(batch) })
})

if (MODE !== 'idle') {
  for (let id = 1; id <= 20; id++) drain({ id })
}
if (MODE === 'own-handler') {
  process.on('SIGTERM', () => console.log('own handler'))
}
if (MODE !== 'natural') {
  // Stands in for a server: keeps the process alive until a signal arrives.
  setInterval(() => {}, 60_000)
}
console.log('ready')
