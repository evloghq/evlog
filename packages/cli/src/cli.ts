import { run } from './run'

/* A reader that closes the pipe early, like `head`, has what it asked for: the
   run ends there, with the exit code it had reached. */
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit()
    throw error
  })
}

await run(process.argv.slice(2))
