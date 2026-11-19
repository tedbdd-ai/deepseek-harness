/**
 * Plugin "creativity-playground": the Playground of the Atelier under `/creativity-playground/api`.
 *
 * Models are added by the address of their page at a provider (kie.ai, fal.ai); the provider's
 * `resolveModels` reads the published input schema, so the Playground never hard-codes a model.
 * A run sends one prompt (and optional reference images from the hub) to several models at once;
 * each result is saved as a generation in the Library and listed under the run.
 *
 * Routes (same-origin JSON, Harness session required):
 * - `GET /models`, `POST /models { url }`, `DELETE /models/<id>`
 * - `GET /runs`, `POST /runs { prompt, modelIds, referenceIds?, params?, modelParams?, studio?, count?, projectId?, title?, template? }`
 *
 * Models live in the hub setting `playground:models`, runs (the last 40) in `playground:runs`.
 */
import { compileDirection, referencePlan, roleNames } from './direction.mjs'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readBody, responder } from '../http.mjs'
import { download } from '../providers/http.mjs'
import { pickParams } from '../providers/schema.mjs'
import { InputError, httpUrl } from '../store.mjs'

export const name = 'creativity-playground'
export const inject = ['webServer', 'creativeStore', 'creativeProviders', 'creativeApps']
const base = '/creativity-playground'
const hosts = { 'kie.ai': 'kie', 'docs.kie.ai': 'kie', 'fal.ai': 'fal', 'queue.fal.run': 'fal', 'fal.run': 'fal' }
const keep = 40

/**
 * Turns a provider failure into a sentence for the run card.
 * @param {string} message the provider error.
 * @returns {{ error: string, retry: boolean, detail?: string }} `retry` is false when the same request would fail again.
 */
export function explain(message) {
  const detail = message.length > 160 || /[{[]/.test(message) ? message.slice(0, 600) : undefined
  if (/\b(422|400)\b.*(content|moderat|safety|policy|filter|flagged|nsfw|sensitive)|content (could|was|has been).*(flag|reject|block)|moderation/i.test(message))
    return { error: 'Der Anbieter hat den Prompt oder ein Bild abgelehnt (Inhaltsfilter). Formuliere den Prompt um oder tausche die Referenz.', retry: false, detail }
  if (/\b401\b|unauthori[sz]ed|authentication failed|fehlt „/i.test(message))
    return { error: 'Der Anbieter hat den Schlüssel abgelehnt. Trag ihn unter „Anbieter“ neu ein.', retry: false, detail }
  if (/\b402\b|insufficient|credits? (exhausted|insufficient)|balance/i.test(message))
    return { error: 'Beim Anbieter ist kein Guthaben mehr übrig.', retry: false, detail }
  if (/\b429\b|kontingent|rate.?limit/i.test(message))
    return { error: 'Der Anbieter ist gerade ausgelastet. Warte kurz und versuche es erneut.', retry: true }
  if (/nicht rechtzeitig|timeout|timed out|zeitüberschreitung/i.test(message))
    return { error: 'Der Anbieter hat nicht rechtzeitig geantwortet. Versuche es erneut.', retry: true }
  if (/nimmt höchstens|bearbeitet keine Bilder|braucht ein Eingabebild|nimmt keine Bilder/i.test(message))
    return { error: message, retry: false }
  return { error: message.replace(/\s*[{[][\s\S]*$/, '').trim() || 'Unbekannter Fehler beim Anbieter.', retry: true, detail }
}

/**
 * @param {ReturnType<typeof import('../store.mjs').openStore>} store
 * @param {ReturnType<typeof import('../providers.mjs').createProviderRegistry>} providers
 * @param {{ concurrency?: Record<string, number>, retryDelays?: number[] }} options parallel jobs per provider
 *   (default 3; LiteLLM 1, because the Gemini quota behind it answers parallel requests with 429) and the
 *   waits before retrying a 429 (default 10 s and 30 s). A 429 is rejected before any work, so a retry costs nothing.
 * @returns the Playground operations used by the HTTP handler and the tests.
 */
export function createPlayground(store, providers, { concurrency = { litellm: 1 }, retryDelays = [10000, 30000] } = {}) {
  const lanes = new Map()
  /** Runs `task` when its provider has a free slot. */
  function inLane(provider, task) {
    const lane = lanes.get(provider) ?? { active: 0, waiting: [] }
    lanes.set(provider, lane)
    return new Promise((resolve, reject) => {
      const go = () => { lane.active++; task().then(resolve, reject).finally(() => { lane.active--; lane.waiting.shift()?.() }) }
      if (lane.active < (concurrency[provider] ?? 3)) go(); else lane.waiting.push(go)
    })
  }
  const isQuota = error => /\b429\b|kontingent|rate.?limit|resource.?exhausted/i.test(error?.message ?? '')
  const models = () => store.settings('playground:models').list ?? []
  const saveModels = list => store.setSettings('playground:models', { list })
  const runs = () => store.settings('playground:runs').list ?? []
  const saveRuns = list => store.setSettings('playground:runs', { list: list.slice(0, keep) })
  let stopped = false
  // After the plugin is unloaded the store may be closed; late provider answers are dropped.
  const update = (id, change) => { if (!stopped) saveRuns(runs().map(run => run.id === id ? change(structuredClone(run)) : run)) }

  // Jobs do not survive a restart; mark what was still running so the run card says so.
  saveRuns(runs().map(run => ({ ...run, results: run.results.map(result => result.status === 'running' ? { ...result, status: 'failed', error: 'Unterbrochen, weil der Hub neu gestartet wurde.' } : result) })))

  async function referenceFile(id) {
    const asset = store.asset(id)
    const stored = store.media(id)
    if (stored?.media_type.startsWith('image/')) return { title: asset.title, file: { mediaType: stored.media_type, data: Buffer.from(stored.media) } }
    const preview = httpUrl(asset.preview)
    if (preview) {
      const file = await download('Bildquelle', preview)
      if (file.mediaType.startsWith('image/')) return { title: asset.title, file: { ...file, url: preview } }
    }
    throw new InputError(`„${asset.title}“ hat kein Bild, das sich als Referenz nutzen lässt.`)
  }

  async function job(runId, index, model, variant, input, images, run) {
    const started = Date.now()
    try {
      // Chat-style providers place this label right before each image (Fit-Checker: role next to the image, not only in a list).
      const files = images.map((item, i) => { const role = roleNames[run.studio?.roles?.[run.referenceIds[i]]]; return { ...item.file, referenceLabel: `Image ${i + 1}${role ? ` (${role})` : ''}` } })
      const call = () => variant.catalog
        ? providers.call(model.provider, 'generate', { model: variant.model, prompt: input.prompt, aspect: input.aspect_ratio ?? 'auto', references: files })
        : providers.call(model.provider, 'runModel', { variant, input, images: files })
      let result
      for (let attempt = 0; ; attempt++) {
        try { result = await inLane(model.provider, call); break } catch (error) {
          if (!isQuota(error) || attempt >= retryDelays.length || stopped) throw error
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
        }
      }
      const description = [`Prompt: ${run.prompt}`, `Modell: ${model.title} über ${model.providerTitle}`, input.prompt && input.prompt !== run.prompt ? `Bildregie: ${input.prompt}` : '', images.length ? `Referenzen: ${images.map(item => item.title).join(', ')}` : ''].filter(Boolean).join('\n')
      if (stopped) return
      const assetIds = result.images.map(file => store.createAsset({
        library: 'generation', title: run.title || run.prompt.slice(0, 120) || model.title, description, media: file.data.toString('base64'), mediaType: file.mediaType,
        ...(run.projectId ? { projectId: run.projectId } : {}),
      }).id)
      update(runId, current => { current.results[index] = { ...current.results[index], status: 'done', assetIds, ms: Date.now() - started, credits: result.credits ?? null }; return current })
    } catch (error) {
      const failure = explain(error.message || '')
      update(runId, current => { current.results[index] = { ...current.results[index], status: 'failed', ms: Date.now() - started, ...failure }; return current })
    }
  }

  return {
    /** Ends the plugin's lifetime: running jobs no longer write results. */
    stop() { stopped = true },
    models,
    runs,
    /** Reads the models behind a provider page and adds them, merging variants into models already added. */
    async addModels(url) {
      let parsed
      try { parsed = new URL(String(url ?? '').trim()) } catch { throw new InputError('Gib die Adresse einer Modellseite ein.') }
      const provider = hosts[parsed.hostname.replace(/^www\./, '')]
      if (!provider || parsed.protocol !== 'https:') throw new InputError('Der Playground kennt Modellseiten von kie.ai und fal.ai.')
      const found = await providers.call(provider, 'resolveModels', { url: parsed.href })
      const list = models()
      for (const model of found) {
        const endpoints = Object.values(model.variants).map(variant => variant.model)
        const existing = list.find(item => item.id === model.id) ?? list.find(item =>
          !item.id.startsWith('catalog:') && item.provider === model.provider && Object.values(item.variants).some(variant => endpoints.includes(variant.model)))
        if (existing) model.id = existing.id
        if (existing) existing.variants = { ...existing.variants, ...model.variants }
        else list.push({ ...model, addedAt: new Date().toISOString() })
      }
      saveModels(list)
      return found.map(model => list.find(item => item.id === model.id))
    },
    async addCatalog(providerId, modelId) {
      const provider = (await providers.list()).find(p => p.id === providerId && p.capabilities.includes('generate') && p.capabilities.includes('models'))
      if (!provider) throw new InputError('Wähle einen Bildanbieter mit Modellkatalog.')
      const item = (await providers.call(provider.id, 'models', {})).find(m => m.id === modelId)
      if (!item) throw new InputError('Modell im Anbieterkatalog nicht gefunden.')
      const variant = { model: item.id, catalog: true, fields: [
        { key: 'prompt', type: 'prompt' },
        { key: 'aspect_ratio', type: 'enum', label: 'Seitenverhältnis', options: ['auto', '1:1', '3:2', '2:3', '16:9', '9:16'], description: 'Gewünschtes Bildformat für diesen Anbieter.' },
      ] }
      const model = { id: 'catalog:' + provider.id + ':' + item.id, title: item.title, provider: provider.id, providerTitle: provider.title, variants: { text: variant, edit: variant } }
      const list = models()
      if (!list.some(m => m.id === model.id)) saveModels([...list, model])
      return [model]
    },
    removeModel(id) {
      saveModels(models().filter(model => model.id !== id))
      return { id }
    },
    /** Starts a run and returns it at once; its results fill in as the providers finish. */
    async start(body) {
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 32000) : ''
      const ids = Array.isArray(body.modelIds) ? [...new Set(body.modelIds.filter(id => typeof id === 'string'))] : []
      const referenceIds = Array.isArray(body.referenceIds) ? [...new Set(body.referenceIds.filter(id => typeof id === 'string'))].slice(0, 16) : []
      const count = [1, 2, 4].includes(body.count) ? body.count : 1
      const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
      const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {}
      // Apps that build on the Playground (e.g. the Styler) name their results and mark their runs.
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
      const template = typeof body.template === 'string' && /^[a-z0-9-]{1,40}$/.test(body.template) ? body.template : null
      if (!prompt) throw new InputError('Schreib einen Prompt.')
      if (!ids.length) throw new InputError('Wähle mindestens ein Modell.')
      if (projectId) store.project(projectId)
      const chosen = ids.map(id => models().find(model => model.id === id) ?? (() => { throw new InputError('Das Modell ist nicht mehr im Playground.', 404) })())
      const studio = body.studio ?? {}
      const positions = referencePlan(prompt, studio, referenceIds)
      const images = await Promise.all(referenceIds.map(referenceFile))
      const task = images.length ? 'edit' : 'text'
      const modelParams = body.modelParams ?? {}
      const run = { count, studio, modelParams, title, template, id: randomUUID(), createdAt: new Date().toISOString(), task, prompt, referenceIds, projectId, params, results: [] }
      const jobs = []
      for (const model of chosen) {
        const variant = model.variants[task]
        for (let n = 0; n < count; n++) {
          const index = run.results.length
          if (!variant) {
            run.results.push({ modelId: model.id, title: model.title, provider: model.providerTitle, status: 'failed', error: task === 'edit' ? 'Dieses Modell bearbeitet keine Bilder.' : 'Dieses Modell braucht ein Eingabebild.', assetIds: [] })
            continue
          }
          run.results.push({ modelId: model.id, title: model.title, provider: model.providerTitle, status: 'running', assetIds: [] })
          const imageField = variant.fields.find(field => field.type === 'images') ?? variant.fields.find(field => field.type === 'image')
          const limit = imageField?.type === 'image' ? 1 : imageField?.maxItems
          if (limit && images.length > limit) {
            Object.assign(run.results[index], { status: 'failed', error: `Dieses Modell nimmt höchstens ${limit} Referenzbilder.` })
            continue
          }
          const directed = compileDirection(prompt, studio, referenceIds, positions, variant.model, model.provider, n, count)
          run.results[index].sentPrompt = directed
          const input = { ...pickParams(variant.fields, modelParams[model.id] ?? modelParams[JSON.stringify([model.id, task, variant.model])] ?? modelParams[JSON.stringify([model.id, task === 'edit' ? 'text' : 'edit', model.variants[task === 'edit' ? 'text' : 'edit']?.model])] ?? params), ...(variant.fields.some(field => field.type === 'prompt') ? { prompt: directed } : {}) }
          jobs.push(() => job(run.id, index, model, variant, input, images, run))
        }
      }
      saveRuns([run, ...runs()])
      for (const start of jobs) start()
      return run
    },
  }
}

/** HTTP handler for the routes listed in the module comment. */
export function createHandler(playground) {
  return async (req, res) => {
    const { json, send } = responder(req, res)
    try {
      if ((req.method === 'GET' || req.method === 'HEAD') && new URL(req.url, 'http://localhost').pathname === base + '/web.mjs') {
        return send(200, 'text/javascript; charset=utf-8', await readFile(new URL('./web.mjs', import.meta.url)))
      }
      const path = new URL(req.url, 'http://localhost').pathname.replace(base + '/api', '')
      const model = /^\/models\/(.+)$/.exec(path)
      if (req.method === 'GET' && path === '/models') return json(playground.models())
      if (req.method === 'GET' && path === '/runs') return json(playground.runs())
      if (req.method === 'POST' && path === '/models') {
        const body = await readBody(req)
        return json(body.provider ? await playground.addCatalog(body.provider, body.modelId) : await playground.addModels(body.url), 201)
      }
      if (req.method === 'POST' && path === '/runs') return json(await playground.start(await readBody(req)), 201)
      if (req.method === 'DELETE' && model) {
        if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new InputError('Schreibzugriff aus dieser Quelle ist gesperrt.', 403)
        return json(playground.removeModel(decodeURIComponent(model[1])))
      }
      return json({ error: 'Nicht gefunden.' }, 404)
    } catch (error) {
      const status = error instanceof InputError || error?.status ? error.status ?? 400 : 500
      return json({ error: status === 500 ? 'Interner Fehler im Playground.' : error.message }, status)
    }
  }
}

export function apply(ctx) {
  const playground = createPlayground(ctx.creativeStore, ctx.creativeProviders)
  ctx.effect(() => () => playground.stop())
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, auth: 'required', handler: createHandler(playground) }))
  // The plugin ships its own page; the hub lists it in the sidebar and hands it the shared building blocks.
  ctx.effect(() => ctx.creativeApps.register({ id: 'playground', title: 'Playground', page: true, view: true, module: base + '/web.mjs',
    icon: 'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72M14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4',
    description: 'Ein Prompt, mehrere Bildmodelle, Ergebnisse in der Library.' }))
}
