interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  description: string
  body?: string
}

const routes: Route[] = [
  { method: 'GET', path: '/health', description: 'Health check with basic log.set()' },
  { method: 'GET', path: '/users/42', description: 'User lookup with useLogger() in a service' },
  { method: 'GET', path: '/checkout', description: 'Fails with createError() with status/why/fix/link' },
  { method: 'POST', path: '/jobs/digest', description: 'Runs a job as its own wide event with withLogger()' },
]

export function testUI(): string {
  const routeButtons = routes.map(r => `
    <button
      onclick="sendRequest('${r.method}', '${r.path}'${r.body ? `, ${JSON.stringify(r.body)}` : ''})"
      class="route"
    >
      <span class="method method-${r.method.toLowerCase()}">${r.method}</span>
      <span class="path">${r.path}</span>
      <span class="desc">${r.description}</span>
    </button>
  `).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>evlog Effect example</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px 16px;
    }

    .container { width: 100%; max-width: 640px; }

    header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 32px;
    }

    h1 { font-size: 20px; font-weight: 600; color: #fafafa; }

    .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 9999px;
      background: #1a1a2e;
      color: #818cf8;
      border: 1px solid #2d2d5e;
    }

    h2 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #525252;
      margin-bottom: 12px;
    }

    .routes { display: flex; flex-direction: column; gap: 6px; margin-bottom: 32px; }

    .route {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: #141414;
      border: 1px solid #262626;
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      text-align: left;
      color: inherit;
      font-family: inherit;
      font-size: 13px;
    }

    .route:hover { border-color: #404040; background: #1a1a1a; }
    .route:active { background: #1f1f1f; }

    .method {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
      letter-spacing: 0.05em;
    }

    .method-get { background: #052e16; color: #4ade80; }
    .method-post { background: #172554; color: #60a5fa; }
    .method-put { background: #422006; color: #fb923c; }
    .method-delete { background: #450a0a; color: #f87171; }
    .method-patch { background: #3b0764; color: #c084fc; }

    .path { color: #d4d4d4; flex-shrink: 0; }

    .desc {
      color: #525252;
      font-size: 12px;
      margin-left: auto;
      text-align: right;
    }

    .response-panel {
      background: #141414;
      border: 1px solid #262626;
      border-radius: 8px;
      overflow: hidden;
    }

    .response-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid #262626;
      font-size: 12px;
    }

    .status {
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
    }

    .status-2xx { background: #052e16; color: #4ade80; }
    .status-4xx { background: #422006; color: #fb923c; }
    .status-5xx { background: #450a0a; color: #f87171; }

    .timing { color: #525252; margin-left: auto; }

    .response-body {
      padding: 14px;
      font-size: 13px;
      line-height: 1.6;
      max-height: 400px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .response-body .key { color: #818cf8; }
    .response-body .string { color: #4ade80; }
    .response-body .number { color: #fb923c; }
    .response-body .null { color: #525252; }
    .response-body .boolean { color: #60a5fa; }

    .empty-state {
      padding: 48px 14px;
      text-align: center;
      color: #404040;
      font-size: 13px;
    }

    .loading { opacity: 0.5; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>evlog</h1>
      <span class="badge">effect-example</span>
    </header>

    <h2>Routes</h2>
    <div class="routes">${routeButtons}</div>

    <h2>Response</h2>
    <div class="response-panel">
      <div class="response-header" id="response-header" style="display: none;">
        <span class="status" id="response-status"></span>
        <span id="response-method-path"></span>
        <span class="timing" id="response-timing"></span>
      </div>
      <div id="response-body" class="empty-state">Click a route to test</div>
    </div>
  </div>

  <script>
    function syntaxHighlight(json) {
      return JSON.stringify(json, null, 2)
        .replace(/("(\\\\u[a-fA-F0-9]{4}|\\\\[^u]|[^\\\\"])*")(\\s*:)?/g, (match, str, _, colon) => {
          if (colon) return '<span class="key">' + str + '</span>' + colon
          return '<span class="string">' + str + '</span>'
        })
        .replace(/\\b(true|false)\\b/g, '<span class="boolean">$1</span>')
        .replace(/\\bnull\\b/g, '<span class="null">null</span>')
        .replace(/\\b(-?\\d+\\.?\\d*([eE][+-]?\\d+)?)\\b/g, '<span class="number">$1</span>')
    }

    async function sendRequest(method, path, body) {
      const el = {
        header: document.getElementById('response-header'),
        status: document.getElementById('response-status'),
        methodPath: document.getElementById('response-method-path'),
        timing: document.getElementById('response-timing'),
        body: document.getElementById('response-body'),
      }

      el.body.className = 'response-body loading'
      el.body.textContent = 'Loading...'
      el.header.style.display = 'none'

      const start = performance.now()

      try {
        const opts = { method }
        if (body) {
          opts.headers = { 'Content-Type': 'application/json' }
          opts.body = body
        }

        const res = await fetch(path, opts)
        const ms = Math.round(performance.now() - start)
        const data = await res.json()

        el.header.style.display = 'flex'
        el.status.textContent = res.status
        el.status.className = 'status status-' + (res.status < 300 ? '2xx' : res.status < 500 ? '4xx' : '5xx')
        el.methodPath.textContent = method + ' ' + path
        el.timing.textContent = ms + 'ms'
        el.body.className = 'response-body'
        el.body.innerHTML = syntaxHighlight(data)
      } catch (err) {
        el.header.style.display = 'none'
        el.body.className = 'response-body'
        el.body.textContent = 'Network error: ' + err.message
      }
    }
  </script>
</body>
</html>`
}
