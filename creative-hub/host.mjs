/**
 * Creativity Hub page and JSON API under `/creativity-hub`: ideas with notes,
 * Excalidraw board and app blocks, plus the Inspiration (clips) and Library
 * (generations) collections.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readBody, responder } from './http.mjs'
import { ProviderError } from './providers.mjs'
import { download } from './providers/http.mjs'
import { InputError, httpUrl, idPattern } from './store.mjs'

export const name = 'creativity-hub'
export const inject = ['webServer', 'creativeStore', 'creativeApps', 'creativeProviders']
const base = '/creativity-hub'
const staticFiles = new Map([
  [base, ['index.html', 'text/html; charset=utf-8']],
  [base + '/', ['index.html', 'text/html; charset=utf-8']],
  [base + '/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  [base + '/ui.js', ['ui.js', 'text/javascript; charset=utf-8']],
  [base + '/app.css', ['app.css', 'text/css; charset=utf-8']],
])
const buildTypes = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', svg: 'image/svg+xml', png: 'image/png', json: 'application/json' }
const uuid = '([0-9a-f-]{36})'

/**
 * Reads the token of the browser extension (file name kept from the former launcher), creating a random one readable only by this OS user.
 * @param {string} path token file.
 */
export function launcherToken(path) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' })
  }
  chmodSync(path, 0o600)
  return readFileSync(path, 'utf8').trim()
}

/**
 * The same API as `/creativity-hub` under `/creativity-launcher`, for native clients and the browser
 * extension, which cannot hold a Harness browser session. Requests must carry `Authorization: Bearer <token>` from `launcherToken()`.
 */
export function createLauncherHandler(token, hub) {
  const expected = Buffer.from('Bearer ' + token)
  return (req, res) => {
    const given = Buffer.from(String(req.headers.authorization ?? ''))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      const { json } = responder(req, res)
      return json({ error: 'Hub-Schlüssel fehlt oder ist falsch.' }, 401)
    }
    req.url = req.url.replace(/^\/creativity-launcher/, base)
    // The bearer token is not an ambient browser credential, so another site cannot forge these
    // requests; browser-extension requests (Sec-Fetch-Site: cross-site/none) are therefore allowed.
    delete req.headers['sec-fetch-site']
    return hub(req, res)
  }
}

/** @param {{ launcherTokenPath?: string }} config token file, default `~/.creativity-hub/launcher-token`. */
export function apply(ctx, config = {}) {
  const hub = createHandler(ctx.creativeStore, ctx.creativeApps, ctx.creativeProviders)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, auth: 'required', handler: hub }))
  const token = launcherToken(config.launcherTokenPath ?? join(homedir(), '.creativity-hub', 'launcher-token'))
  // Anonymous to the Harness session check; the handler requires the extension token instead.
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/creativity-launcher', auth: 'anonymous', handler: createLauncherHandler(token, hub) }))
  ctx.on('webserver/entry-url', (origin, entries) => {
    entries.push({ label: 'Creativity Hub', url: new URL(base, origin).href, open: false })
  })
}

/**
 * @param {ReturnType<typeof import('./store.mjs').openStore>} store
 * @param {ReturnType<typeof import('./core.mjs').createAppRegistry>} apps
 */
/** Loads an asset as provider input `{ mediaType, data, url? }`: stored bytes, else its preview image. */
async function assetFile(store, id) {
  const asset = store.asset(id)
  const preview = httpUrl(asset.preview)
  const stored = store.media(id)
  if (stored && stored.media_type.startsWith('image/')) return { mediaType: stored.media_type, data: Buffer.from(stored.media), ...(preview && { url: preview }) }
  if (preview) return { ...(await download('Bildquelle', preview)), url: preview }
  throw new InputError(`„${asset.title}“ hat kein Bild.`)
}

function saveImage(store, file, { title, source = '', description, ideaId }) {
  const { id } = store.createAsset({
    library: 'generation', title, source, description, media: file.data.toString('base64'), mediaType: file.mediaType,
    ...(typeof ideaId === 'string' && ideaId ? { projectId: ideaId } : {}),
  })
  return store.asset(id)
}

/**
 * Image routes: provider listing and configuration, search, generation and background removal.
 * Results are saved to the Library (and to `ideaId` when given) before the response.
 */
async function imageRoute(store, providers, method, path, req) {
  const api = base + '/api'
  if (method === 'GET' && path === api + '/providers') return providers.list()
  const provider = /^\/creativity-hub\/api\/providers\/([a-z0-9-]+)(\/models)?$/.exec(path)
  if (provider && method === 'GET' && provider[2]) return providers.call(provider[1], 'models', {})
  if (provider && method === 'PUT' && !provider[2]) {
    await providers.configure(provider[1], await readBody(req))
    return (await providers.list()).find(item => item.id === provider[1])
  }
  if (method !== 'POST' || !path.startsWith(api + '/images/')) return undefined
  const body = await readBody(req)
  if (typeof body.provider !== 'string') throw new InputError('Wähle einen Anbieter.')
  switch (path.slice((api + '/images/').length)) {
    case 'search': {
      const query = typeof body.query === 'string' ? body.query.trim().slice(0, 300) : ''
      if (!query) throw new InputError('Gib einen Suchbegriff ein.')
      return providers.call(body.provider, 'search', { query })
    }
    case 'generate': {
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 8000) : ''
      if (!prompt) throw new InputError('Schreib einen Prompt.')
      const count = Number.isInteger(body.count) ? Math.min(Math.max(body.count, 1), 4) : 1
      const ids = Array.isArray(body.referenceIds) ? body.referenceIds.filter(id => typeof id === 'string').slice(0, 14) : []
      const references = await Promise.all(ids.map(id => assetFile(store, id)))
      const names = ids.map(id => store.asset(id).title)
      const input = { model: typeof body.model === 'string' ? body.model : '', prompt, references, aspect: typeof body.aspect === 'string' ? body.aspect : 'auto' }
      const results = await Promise.all(Array.from({ length: count }, () => providers.call(body.provider, 'generate', input)))
      const description = `Prompt: ${prompt}\nModell: ${input.model || 'Standard'} über ${body.provider}` + (names.length ? `\nReferenzen: ${names.join(', ')}` : '')
      const assets = results.flatMap(result => result.images).map(file => saveImage(store, file, { title: prompt.slice(0, 80), description, ideaId: body.ideaId }))
      return { assets, credits: results.reduce((sum, result) => sum + (result.credits ?? 0), 0) }
    }
    case 'remove-background': {
      const source = typeof body.assetId === 'string' ? await assetFile(store, body.assetId)
        : httpUrl(body.imageUrl) ? { ...(await download('Bildquelle', body.imageUrl)), url: body.imageUrl } : null
      if (!source) throw new InputError('Gib ein Asset oder eine Bild-URL an.')
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Bild'
      const origin = httpUrl(body.source) || source.url || ''
      const result = await providers.call(body.provider, 'removeBackground', { image: source })
      const asset = saveImage(store, result.image, { title: 'Freigestellt: ' + title, source: origin, description: `Freigestellt über ${body.provider}.${origin ? '\nQuelle: ' + origin : ''}`, ideaId: body.ideaId })
      return { asset, credits: result.credits ?? 0 }
    }
    default:
      return undefined
  }
}

export function createHandler(store, apps, providers) {
  return async (req, res) => {
    const { send, json } = responder(req, res)
    try {
      const url = new URL(req.url, 'http://localhost')
      const path = url.pathname
      const method = req.method
      const api = base + '/api'
      const route = pattern => new RegExp('^' + api + pattern + '$').exec(path)
      const image = await imageRoute(store, providers, method, path, req)
      if (image !== undefined) return json(image)
      if (method === 'GET' || method === 'HEAD') {
        const entry = staticFiles.get(path)
        if (entry) return send(200, entry[1], await readFile(new URL('./web/' + entry[0], import.meta.url)))
        const asset = /^\/creativity-hub\/board-editor\/assets\/([\w.-]+)\.([a-z0-9]+)$/.exec(path)
        const type = asset && buildTypes[asset[2]]
        if (type) return send(200, type, await readFile(new URL('./dist/assets/' + asset[1] + '.' + asset[2], import.meta.url)))
        if (path === api + '/projects') return json(store.projects())
        if (path === api + '/apps') return json(apps.apps())
        if (path === api + '/snapshots') return json(apps.snapshots())
        if (path === api + '/journal') return json(store.journal())
        if (path === api + '/feed') return json(store.feed())
        if (path === api + '/todo') return json(store.settings('page:todo'))
        if (path === api + '/sidebar') return json(store.settings('page:sidebar'))
        if (path === api + '/assets') return json(store.assets(url.searchParams.get('library') ?? '', url.searchParams.get('q') ?? '', url.searchParams.get('project') ?? ''))
        const media = route('/media/' + uuid)
        if (media) {
          const item = store.media(media[1])
          if (!item) throw new InputError('Datei nicht gefunden.', 404)
          return send(200, item.media_type, Buffer.from(item.media))
        }
        const project = route('/projects/' + uuid)
        if (project) return json(store.project(project[1]))
      }
      const appData = route('/projects/' + uuid + '/apps/([a-z0-9-]+)')
      if (appData && idPattern.test(appData[2])) {
        if (method === 'GET') return json(store.appData(appData[1], appData[2]))
        if (method === 'PUT') return json(store.setAppData(appData[1], appData[2], await readBody(req)))
      }
      if (method === 'POST' && path === api + '/projects') {
        const body = await readBody(req)
        const snapshot = apps.snapshot(typeof body.snapshot === 'string' ? body.snapshot : 'blank')
        if (!snapshot) throw new InputError('Unbekannter Snapshot.')
        return json(store.createProject({ title: body.title, notes: body.notes, snapshot: snapshot.id, apps: snapshot.apps }), 201)
      }
      if (method === 'POST' && path === api + '/assets') return json(store.createAsset(await readBody(req)), 201)
      if (method === 'POST' && (path === api + '/assign' || path === api + '/unassign')) {
        const body = await readBody(req)
        if (typeof body.id !== 'string' || typeof body.projectId !== 'string') throw new InputError('Asset und Idee erforderlich.')
        return json(path.endsWith('/assign') ? store.assign(body.id, body.projectId) : store.unassign(body.id, body.projectId))
      }
      const day = route('/journal/(\\d{4}-\\d{2}-\\d{2})')
      if (method === 'PUT' && day) return json(store.setJournal(day[1], await readBody(req)))
      if (method === 'PUT' && (path === api + '/todo' || path === api + '/sidebar')) {
        const body = await readBody(req)
        if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 256 * 1024) throw new InputError('Ungültige Daten.')
        store.setSettings(path.endsWith('/todo') ? 'page:todo' : 'page:sidebar', body)
        return json(body)
      }
      const removable = route('/assets/' + uuid)
      if (method === 'DELETE' && removable) {
        if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new InputError('Schreibzugriff aus dieser Quelle ist gesperrt.', 403)
        return json(store.deleteAsset(removable[1]))
      }
      const project = route('/projects/' + uuid)
      if (method === 'PUT' && project) return json(store.updateProject(project[1], await readBody(req)))
      throw new InputError('Seite nicht gefunden.', 404)
    } catch (error) {
      if (error instanceof InputError || error instanceof ProviderError) return json({ error: error.message }, error.status)
      if (error.code === 'ENOENT') return json({ error: 'Datei nicht gefunden.' }, 404)
      console.error('Creativity Hub:', error)
      return json({ error: 'Der Hub konnte die Anfrage nicht abschließen.' }, 500)
    }
  }
}
