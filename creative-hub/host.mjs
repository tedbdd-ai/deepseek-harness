/**
 * Creativity Hub page and JSON API under `/creativity-hub`: ideas with notes,
 * Excalidraw board and app blocks, plus the Inspiration (clips) and Library
 * (generations) collections.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readBody, readUpload, responder } from './http.mjs'
import { compressVideo } from './media-edit.mjs'
import { aiTagAssets } from './ai-tags.mjs'
import { createAssetAnalyzer, resolveAnalysisConfig } from './asset-analysis.mjs'
import { ProviderError } from './providers.mjs'
import { download } from './providers/http.mjs'
import { InputError, httpUrl, idPattern, mediaLimit, mediaTypeOf } from './store.mjs'

export const name = 'creativity-hub'
export const inject = ['webServer', 'creativeStore', 'creativeApps', 'creativeProviders']
const base = '/creativity-hub'
const staticFiles = new Map([
  [base, ['index.html', 'text/html; charset=utf-8']],
  [base + '/', ['index.html', 'text/html; charset=utf-8']],
  [base + '/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  [base + '/media-editor.js', ['media-editor.js', 'text/javascript; charset=utf-8']],
  [base + '/tags.js', ['tags.js', 'text/javascript; charset=utf-8']],
  [base + '/app.css', ['app.css', 'text/css; charset=utf-8']],
  [base + '/fonts/inter-latin-wght-normal.woff2', ['fonts/inter-latin-wght-normal.woff2', 'font/woff2']],
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

/** @param {{ launcherTokenPath?: string, analysis?: { labelThreshold?: number } }} config token file, default `~/.creativity-hub/launcher-token`; `analysis.labelThreshold` is the minimum Vision confidence for a label tag (0.05–0.95, default 0.25). */
export function apply(ctx, config = {}) {
  const tagger = createAssetAnalyzer(ctx.creativeStore, resolveAnalysisConfig(config.analysis))
  ctx.effect(() => {
    tagger.schedule()
    return () => tagger.stop()
  })
  const hub = createHandler(ctx.creativeStore, ctx.creativeApps, ctx.creativeProviders, tagger)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, auth: 'required', handler: hub }))
  const token = launcherToken(config.launcherTokenPath ?? join(homedir(), process.env.ATELIER_INSTANCE === 'nsfw' ? '.creativity-hub-nsfw' : '.creativity-hub', 'launcher-token'))
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

function saveGeneratedMedia(store, file, { title, source = '', description, ideaId, runId = '' }) {
  const { id } = store.createAsset({
    library: 'generation', title, source, description, media: file.data.toString('base64'), mediaType: file.mediaType, runId,
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
    case 'reference-media': {
      if (!['mesh', 'video'].includes(body.kind) || typeof body.assetId !== 'string') throw new InputError('Wähle ein Referenzbild und ein Ausgabeformat.')
      if (typeof body.ideaId === 'string' && body.ideaId) store.project(body.ideaId)
      const reference = store.asset(body.assetId).title
      const image = await assetFile(store, body.assetId)
      if (!image.mediaType.startsWith('image/')) throw new InputError('Für diese Ausgabe wird ein Referenzbild benötigt.')
      const { model, file } = await providers.call(body.provider, 'referenceMedia', { kind: body.kind, image })
      const title = body.kind === 'mesh' ? '3D-Model-Referenz' : 'Model-Referenzclip'
      const asset = saveGeneratedMedia(store, file, { title, description: `Modell: ${model} über ${body.provider}\nReferenzen: ${reference}`, ideaId: body.ideaId })
      return { assets: [asset] }
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
      const runId = randomUUID()
      const assets = results.flatMap(result => result.images).map(file => saveGeneratedMedia(store, file, { title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : prompt.slice(0, 80), description, ideaId: body.ideaId, runId }))
      for (const asset of assets) store.inheritTags(asset.id, ids)
      return { assets, credits: results.reduce((sum, result) => sum + (result.credits ?? 0), 0) }
    }
    case 'remove-background': {
      const source = typeof body.assetId === 'string' ? await assetFile(store, body.assetId)
        : httpUrl(body.imageUrl) ? { ...(await download('Bildquelle', body.imageUrl)), url: body.imageUrl } : null
      if (!source) throw new InputError('Gib ein Asset oder eine Bild-URL an.')
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Bild'
      const origin = httpUrl(body.source) || source.url || ''
      const result = await providers.call(body.provider, 'removeBackground', { image: source })
      const asset = saveGeneratedMedia(store, result.image, { title: 'Freigestellt: ' + title, source: origin, description: `Freigestellt über ${body.provider}.${origin ? '\nQuelle: ' + origin : ''}`, ideaId: body.ideaId })
      return { asset, credits: result.credits ?? 0 }
    }
    default:
      return undefined
  }
}

const mediaTag = bytes => '"' + createHash('sha256').update(bytes).digest('hex') + '"'

function serveMedia(store, id, req, res, send) {
  const info = store.mediaInfo(id)
  if (!info) throw new InputError('Datei nicht gefunden.', 404)
  const { size, media_type: type } = info
  const seekable = /^(audio|video)\//.test(type)
  if (seekable) res.setHeader('Accept-Ranges', 'bytes')
  const header = seekable && req.headers.range
  if (header && !req.headers['if-range']) {
    const range = /^bytes=(\d*)-(\d*)$/i.exec(header)
    if (range) {
      const [, from, to] = range
      const start = from ? Number(from) : Math.max(0, size - Number(to))
      const end = from && to ? Math.min(size - 1, Number(to)) : size - 1
      if (!Number.isSafeInteger(start) || start >= size || end < start) {
        res.setHeader('Content-Range', 'bytes */' + size)
        return send(416, type)
      }
      const length = end - start + 1
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', length)
      return send(206, type, req.method === 'HEAD' ? undefined : Buffer.from(store.mediaSlice(id, start, length)))
    }
  }
  res.setHeader('Content-Length', size)
  return send(200, type, req.method === 'HEAD' ? undefined : Buffer.from(store.media(id).media))
}

/** Maps `GET /api/search` parameters to `store.search` input. */
function searchQuery(params) {
  const list = name => (params.get(name) ?? '').split(',').filter(Boolean)
  return {
    q: params.get('q') ?? '', library: params.get('library') ?? '', project: params.get('project') ?? '',
    tags: list('tags'), exclude: list('exclude'), colors: list('colors'), rating: params.get('rating') ?? '',
    untagged: params.has('untagged'), suggestions: params.has('suggestions'), unreviewed: params.has('unreviewed'), stack: params.has('stack'),
    run: params.get('run') ?? '', sort: params.get('sort') ?? '', limit: params.get('limit'), offset: params.get('cursor'),
  }
}

export function createHandler(store, apps, providers, tagger) {
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
        if (path === api + '/instance') return json({ mode: process.env.ATELIER_INSTANCE === 'nsfw' ? 'nsfw' : 'standard' })
        if (path === api + '/projects') return json(store.projects())
        if (path === api + '/apps') return json(apps.apps())
        if (path === api + '/snapshots') return json(apps.snapshots())
        if (path === api + '/journal') return json(store.journal())
        if (path === api + '/feed') return json(store.feed())
        if (path === api + '/todo') return json(store.settings('page:todo'))
        if (path === api + '/sidebar') return json(store.settings('page:sidebar'))
        if (path === api + '/saved-searches') return json(store.settings('hub:saved-searches').items ?? [])
        if (path === api + '/search') return json(store.search(searchQuery(url.searchParams)))
        if (path === api + '/tags') return json(store.tagVocabulary())
        if (path === api + '/assets/tags') return json(store.assetTags((url.searchParams.get('ids') ?? '').split(',').filter(Boolean)))
        const similar = route('/assets/' + uuid + '/(similar|analysis)')
        if (similar) return json(similar[2] === 'similar' ? store.similar(similar[1], Number(url.searchParams.get('limit')) || 50).map(hit => ({ ...store.asset(hit.id), distance: hit.distance })) : store.analysis(similar[1]))
        if (path === api + '/assets' && url.searchParams.get('q')) {
          return json(store.search({ ...searchQuery(url.searchParams), rating: 'all', limit: 500 }).items)
        }
        if (path === api + '/assets') {
          const library = url.searchParams.get('library') ?? ''
          const assets = store.assets(library, url.searchParams.get('q') ?? '', url.searchParams.get('project') ?? '')
          if (assets.some(asset => asset.library === 'clips' && !asset.tag_source)) tagger?.schedule()
          return json(assets)
        }
        const media = route('/media/' + uuid)
        if (media && method === 'GET' && url.searchParams.has('edit')) {
          const file = store.media(media[1])
          if (!file) throw new InputError('Datei nicht gefunden.', 404)
          res.setHeader('ETag', mediaTag(file.media))
          return send(200, file.media_type, Buffer.from(file.media))
        }
        if (media) return serveMedia(store, media[1], req, res, send)
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
      const edit = route('/assets/' + uuid + '/(image-edit|compress-video)')
      if (method === 'POST' && edit) {
        const [, id, action] = edit
        const body = await readBody(req)
        const original = store.media(id)
        if (!original) throw new InputError('Datei nicht gefunden.', 404)
        if (action === 'compress-video') {
          if (typeof body.size !== 'number' || body.size !== original.media.length) throw new InputError('Die Datei wurde inzwischen geändert. Öffne die Details erneut.', 409)
          return json(store.replaceMedia(id, await compressVideo(original), original, { smaller: true }))
        }
        if (!original.media_type.startsWith('image/') || typeof body.media !== 'string' || !['reduce','crop'].includes(body.action)) {
          throw new InputError('Ungültige Bildbearbeitung.')
        }
        if (body.tag !== mediaTag(original.media)) throw new InputError('Das Bild wurde inzwischen geändert. Öffne die Details erneut.', 409)
        return json(store.replaceMedia(id, Buffer.from(body.media, 'base64'), original, { smaller: body.action === 'reduce' }))
      }
      if (method === 'POST' && path === api + '/clips/video') {
        if (req.headers['content-type'] !== 'application/octet-stream') throw new InputError('Videodatei erwartet.',415)
        const bytes = await readUpload(req, mediaLimit('video/mp4'))
        const mediaType = mediaTypeOf(bytes)
        if (!mediaType?.startsWith('video/')) throw new InputError('Der Player liefert keine MP4-, MOV- oder WebM-Datei.')
        const created = store.createAsset({library:'clips', mediaType, title:url.searchParams.get('title'),
          source:url.searchParams.get('source'), projectId:url.searchParams.get('projectId')}, {bytes})
        tagger?.schedule()
        return json(created, 201)
      }
      if (method === 'POST' && path === api + '/assets') {
        const body = await readBody(req)
        const created = store.createAsset(body)
        tagger?.schedule()
        return json(created, 201)
      }
      if (method === 'POST' && path === api + '/assets/tags') return json(store.editTags(await readBody(req)))
      if (method === 'POST' && path === api + '/assets/tag-state') return json(store.setTagState(await readBody(req)))
      if (method === 'POST' && path === api + '/assets/ai-tags') return json(await aiTagAssets(store, providers, (await readBody(req)).ids))
      if (method === 'POST' && path === api + '/assets/accept-suggestions') return json(store.acceptSuggestions((await readBody(req)).ids))
      if (method === 'POST' && path === api + '/assets/reviewed') return json(store.markReviewed((await readBody(req)).ids))
      if (method === 'POST' && path === api + '/assets/rating') {
        const body = await readBody(req)
        return json(store.setRating(body.ids, body.rating))
      }
      if (method === 'POST' && path === api + '/tags') return json(store.createTag(await readBody(req)), 201)
      const tag = route('/tags/([^/]+)')
      if (tag) {
        const id = decodeURIComponent(tag[1])
        if (method === 'PUT') {
          const body = await readBody(req)
          if ('name' in body) store.renameTag(id, body.name)
          if ('aliases' in body) store.setAliases(id, body.aliases)
          if ('facet' in body) store.moveTag(id, body.facet)
          return json(store.tagVocabulary())
        }
        if (method === 'DELETE') return json(store.deleteTag(id))
      }
      const merge = route('/tags/([^/]+)/merge')
      if (method === 'POST' && merge) return json(store.mergeTags(decodeURIComponent(merge[1]), (await readBody(req)).target))
      if (method === 'POST' && (path === api + '/assign' || path === api + '/unassign')) {
        const body = await readBody(req)
        if (typeof body.id !== 'string' || typeof body.projectId !== 'string') throw new InputError('Asset und Idee erforderlich.')
        return json(path.endsWith('/assign') ? store.assign(body.id, body.projectId) : store.unassign(body.id, body.projectId))
      }
      if (method === 'PUT' && path === api + '/saved-searches') {
        const items = (await readBody(req)).items
        if (!Array.isArray(items) || items.length > 100 || items.some(item => typeof item?.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 ||
          typeof item.href !== 'string' || !/^#\/(sammlung|library)(\?|$)/.test(item.href) || item.href.length > 600)) throw new InputError('Ungültige gespeicherte Suche.')
        store.setSettings('hub:saved-searches', { items })
        return json(items)
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
