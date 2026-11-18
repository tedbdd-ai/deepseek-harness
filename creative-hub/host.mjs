import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { InputError, openStore } from './store.mjs'

export const name = 'creativity-hub'
export const inject = ['webServer']
const base = '/creativity-hub'
const staticFiles = new Map([
  [base, ['index.html', 'text/html; charset=utf-8']],
  [base + '/', ['index.html', 'text/html; charset=utf-8']],
  [base + '/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  [base + '/app.css', ['app.css', 'text/css; charset=utf-8']],
])
const buildTypes = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', svg: 'image/svg+xml', png: 'image/png', json: 'application/json' }

export function apply(ctx, config = {}) {
  ctx.effect(() => {
    const store = openStore(config.databasePath ?? join(homedir(), '.creativity-hub', 'hub.sqlite'))
    try {
      const dispose = ctx.webServer.register({ kind: 'prefix', path: base, auth: 'required', handler: createHandler(store) })
      return () => { dispose(); store.close() }
    } catch (error) {
      store.close()
      throw error
    }
  })
  ctx.on('webserver/entry-url', (origin, entries) => {
    entries.push({ label: 'Creativity Hub', url: new URL(base, origin).href, open: false })
  })
}

async function readBody(request) {
  if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') {
    throw new InputError('Schreibzugriff aus dieser Quelle ist gesperrt.', 403)
  }
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new InputError('JSON erwartet.', 415)
  }
  let size = 0
  const chunks = []
  for await (const part of request.iterator({ destroyOnReturn: false })) {
    size += part.length
    if (size > 18 * 1024 * 1024) throw new InputError('Anfrage zu groß.', 413)
    chunks.push(part)
  }
  let data
  try { data = JSON.parse(Buffer.concat(chunks)) } catch { throw new InputError('Ungültiges JSON.') }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new InputError('JSON-Objekt erwartet.')
  return data
}

export function createHandler(store) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const send = (status, contentType, body) => {
      res.writeHead(status, { 'Content-Type': contentType })
      res.end(req.method === 'HEAD' ? undefined : body)
    }
    const json = (body, status = 200) => send(status, 'application/json; charset=utf-8', JSON.stringify(body))
    try {
      const url = new URL(req.url, 'http://localhost')
      const path = url.pathname
      const method = req.method
      const api = base + '/api'
      if (method === 'GET' || method === 'HEAD') {
        const entry = staticFiles.get(path)
        if (entry) return send(200, entry[1], await readFile(new URL('./web/' + entry[0], import.meta.url)))
        const asset = /^\/creativity-hub\/board-editor\/assets\/([\w.-]+)\.([a-z0-9]+)$/.exec(path)
        const type = asset && buildTypes[asset[2]]
        if (type) return send(200, type, await readFile(new URL('./dist/assets/' + asset[1] + '.' + asset[2], import.meta.url)))
        if (path === api + '/projects') return json(store.projects())
        if (path === api + '/assets') return json(store.assets(url.searchParams.get('library') ?? '', url.searchParams.get('q') ?? '', url.searchParams.get('project') ?? ''))
        const mediaId = matchId(path, api + '/media/')
        if (mediaId) {
          const item = store.media(mediaId)
          if (!item) throw new InputError('Datei nicht gefunden.', 404)
          return send(200, item.media_type, Buffer.from(item.media))
        }
      }
      const projectId = matchId(path, api + '/projects/')
      if (method === 'GET' && projectId) return json(store.project(projectId))
      if (method === 'POST' && path === api + '/projects') return json(store.createProject(await readBody(req)), 201)
      if (method === 'POST' && path === api + '/assets') return json(store.createAsset(await readBody(req)), 201)
      if (method === 'POST' && path === api + '/assign') {
        const body = await readBody(req)
        if (typeof body.id !== 'string' || typeof body.projectId !== 'string') throw new InputError('Asset und Projekt erforderlich.')
        return json(store.assign(body.id, body.projectId))
      }
      if (method === 'PUT' && projectId) return json(store.updateProject(projectId, await readBody(req)))
      throw new InputError('Seite nicht gefunden.', 404)
    } catch (error) {
      if (error instanceof InputError) return json({ error: error.message }, error.status)
      if (error.code === 'ENOENT') return json({ error: 'Datei nicht gefunden.' }, 404)
      console.error('Creativity Hub:', error)
      return json({ error: 'Der Hub konnte die Anfrage nicht abschließen.' }, 500)
    }
  }
}

function matchId(path, prefix) {
  if (!path.startsWith(prefix)) return ''
  const id = path.slice(prefix.length)
  return /^[0-9a-f-]{36}$/.test(id) ? id : ''
}
