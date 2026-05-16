import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * Dev-only plugin that forwards /api/* requests to the Vercel-style
 * serverless handlers so `npm run dev` works without `vercel dev`.
 */
function devApiPlugin(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      // Load ALL env vars (not just VITE_*) so API handlers can read OPENAI_API_KEY etc.
      const env = loadEnv('development', process.cwd(), '')
      Object.assign(process.env, env)

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()

        try {
          const url = new URL(req.url, 'http://localhost')
          const route = url.pathname.replace('/api/', '')

          // Collect raw body
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          }
          const rawBody = Buffer.concat(chunks)

          // Parse body depending on content type
          const contentType = req.headers['content-type'] ?? ''
          let body: unknown
          if (contentType.includes('application/json')) {
            body = JSON.parse(rawBody.toString('utf-8'))
          } else {
            body = rawBody
          }

          // Build a minimal VercelRequest-like object
          const query: Record<string, string> = {}
          url.searchParams.forEach((v, k) => { query[k] = v })

          const fakeReq = {
            method: req.method,
            headers: req.headers,
            query,
            body,
          }

          // Build a minimal VercelResponse-like object
          let statusCode = 200
          const fakeRes = {
            status(code: number) { statusCode = code; return fakeRes },
            json(data: unknown) {
              res.writeHead(statusCode, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(data))
            },
          }

          // Load the right handler
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let handler: { default: (req: any, res: any) => Promise<void> }
          if (route === 'transcribe') {
            handler = await import('./api/transcribe')
          } else if (route === 'meeting-notes') {
            handler = await import('./api/meeting-notes')
          } else if (route === 'done-reflection') {
            handler = await import('./api/done-reflection')
          } else if (route === 'project-decisions') {
            handler = await import('./api/project-decisions')
          } else if (route === 'recent-meeting-summary') {
            handler = await import('./api/recent-meeting-summary')
          } else if (route === 'make-actionable') {
            handler = await import('./api/make-actionable')
          } else if (route === 'health') {
            handler = await import('./api/health')
          } else {
            res.writeHead(404)
            res.end('Not found')
            return
          }

          await handler.default(fakeReq, fakeRes)
        } catch (err) {
          console.error('[dev-api]', err)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(err) }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApiPlugin()],
  server: {
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-editor': ['@blocknote/core', '@blocknote/react', '@blocknote/mantine', '@mantine/core', '@mantine/hooks'],
          'vendor-dates': ['date-fns'],
        },
      },
    },
  },
})
