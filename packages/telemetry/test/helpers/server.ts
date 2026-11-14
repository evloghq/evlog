import { createServer } from 'node:http'
import type { IncomingMessage, RequestListener, Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

const servers: Server[] = []

/** Start a local HTTP server, the way the drain meets one: over a real socket. */
export async function listen(handler: RequestListener): Promise<{ url: string, sockets: Socket[] }> {
  const server = createServer(handler)
  const sockets: Socket[] = []
  server.on('connection', socket => sockets.push(socket))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/ingest`, sockets }
}

/** A server that answers every request with `status` and keeps the bodies it received. */
export async function ingest(status = 204): Promise<{ url: string, bodies: string[], requests: IncomingMessage[] }> {
  const bodies: string[] = []
  const requests: IncomingMessage[] = []
  const { url } = await listen((request, response) => {
    requests.push(request)
    let body = ''
    request.on('data', chunk => body += chunk)
    request.on('end', () => {
      bodies.push(body)
      response.writeHead(status).end()
    })
  })
  return { url, bodies, requests }
}

/** Close every server started by {@link listen}. Call from `afterEach`. */
export async function closeServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise((resolve) => {
    server.closeAllConnections()
    server.close(resolve)
  })))
}
