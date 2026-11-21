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
 * - `POST /scrabble { referenceIds?, words?, labels?, roles?, appearance?, previous?, prompt?, modelIds?, modelParams? }` → `{ prompts, model }`
 * - `GET /runs`, `POST /runs { prompt, modelIds, referenceIds?, params?, modelParams?, studio?, count?, projectId?, title?, template? }`
 *
 * Models live in the hub setting `playground:models`, runs (the last 40) in `playground:runs`.
 * The plugin also registers the Flows nodes „Bild“, „Charakterblatt“ and „Set“ (`imageNode`), which start one run and wait for it.
 */
import { appearanceText, compileDirection, referenceMarks, referenceOnlyPrompt, referencePlan, roleNames } from './direction.mjs'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readBody, responder } from '../http.mjs'
import { ProviderError } from '../providers.mjs'
import { download } from '../providers/http.mjs'
import { pickParams } from '../providers/schema.mjs'
import { InputError, httpUrl } from '../store.mjs'

export const name = 'creativity-playground'
export const inject = ['webServer', 'creativeStore', 'creativeProviders', 'creativeApps', 'creativeNodes']
const base = '/creativity-playground'
const hosts = { 'hotapi.ai': 'hotapi', 'api.hotapi.ai': 'hotapi', 'kie.ai': 'kie', 'docs.kie.ai': 'kie', 'fal.ai': 'fal', 'queue.fal.run': 'fal', 'fal.run': 'fal' }
const keep = 40

const imagePromptSystem = [
  'Turn the supplied keywords and references into one concise prompt for a still image. Describe only what is visible in the finished frame.',
  'Carry over the user’s wording, subject, style and details. Use the fewest added words needed to connect the inputs. Keep unspecified visual choices open. Exclude backstory, dialogue and events outside the frame.',
  'Mention every supplied @Bild number exactly as given. Follow explicit instructions about those images. Where the user has left a reference’s purpose open, use the image as visual guidance without assigning it a fabricated subject or role.',
  'Treat the originalPrompt as the creative brief and keywords as requested refinements. Keep its unusual wording, intentional ambiguity and visual choices. A complete brief may be returned verbatim. Use targetModels only as documentation about the selected inputs. Never borrow subjects, wardrobe, mood or style from documentation examples. Keep Atelier @Bild labels in the draft even when documentation uses other syntax. Do not add stock photographic terms or repeat settings configured as controls. A previous draft is context for rephrasing without adding details. Use the language of the original prompt, otherwise the keywords, defaulting to German. Return only valid JSON with one string in the prompts array.',
].join('\n')

const referenceDirectionSystem = [
  'The fixed appearance and the reference roles are separate instructions applied to the render. Respect them and do not reinvent or restate them.',
  'When a picture is not supplied to you, do not invent what it shows. Use the assigned role and its @Bild number.',
  'Keep the scene to one physically plausible moment, with consistent posture, weight, scale and contact with the surroundings.',
].join('\n')

// Resolve guidance from the selected endpoint so a schema re-import also updates Scrabble.
function promptGuide(model, task) {
  const variant = model.variants[task]
  const editing = task === 'edit'
  let tip = editing
    ? 'Benenne die gewünschte Änderung. Wenn ein Detail erhalten bleiben soll, verknüpfe es im Satz mit seinem Referenzbild.'
    : 'Beschreibe einen sichtbaren Moment. Konkrete Details, die dir wichtig sind, können in deinen eigenen Worten stehen.'
  let source = variant.doc || model.page
  if (/(?:^|[/:-])nano-banana(?:[-/]|$)/i.test(variant.model)) {
    tip = editing
      ? 'Verknüpfe Motiv und Änderung in einem Satz. Zum Beispiel „Die Person aus @Bild1 trägt die Jacke aus @Bild2. Ihr Gesicht und ihr Lächeln bleiben gleich.“'
      : 'Beschreibe das fertige Bild in zusammenhängenden Sätzen. Position, Blick oder Stimmung kannst du dort benennen, wo sie für dein Motiv zählen.'
    source = 'https://ai.google.dev/gemini-api/docs/image-generation#prompt-guide'
  } else if (editing && model.provider === 'hotapi' && /^seedream-5\.0-pro-spicy\//.test(variant.model)) {
    tip = 'Du kannst mehrere Bilder kombinieren. Benenne, welches Detail aus welcher Quelle ins Ergebnis soll, etwa die Jacke aus @Bild2 für die Person aus @Bild1.'
  }
  const schemaHint = String(variant.fields.find(field => field.type === 'prompt')?.description || '').trim().slice(0, 1800)
  return { tip, schemaHint, source: /^https:\/\//i.test(source || '') ? source : '' }
}

function parsePrompt(text, positions, maxLength) {
  let prompts
  try {
    prompts = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''))?.prompts
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new ProviderError('Das Textmodell hat keinen lesbaren Bildprompt geliefert.')
  }
  if (!Array.isArray(prompts) || prompts.length !== 1 || prompts.some(prompt => typeof prompt !== 'string' || !prompt.trim() || prompt.length > maxLength)) {
    throw new ProviderError('Das Textmodell hat die angeforderten Bildprompts nicht vollständig geliefert.')
  }
  const scenes = prompts.map(prompt => prompt.trim())
  for (const scene of scenes) {
    const mentioned = new Set(referenceMarks(scene))
    if ([...mentioned].some(label => !positions.has(label)) || mentioned.size !== positions.size) {
      throw new ProviderError('Das Textmodell hat die Bildmarken nicht vollständig übernommen. Würfle den Bildprompt erneut.')
    }
  }
  return scenes
}

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
          if (model.provider === 'hotapi' || !isQuota(error) || attempt >= retryDelays.length || stopped) throw error
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
        }
      }
      const description = [`Prompt: ${run.prompt}`, `Modell: ${model.title} über ${model.providerTitle}`, input.prompt && input.prompt !== run.prompt ? `Bildregie: ${input.prompt}` : '', images.length ? `Referenzen: ${images.map(item => item.title).join(', ')}` : ''].filter(Boolean).join('\n')
      if (stopped) return
      const assetIds = result.images.map(file => store.createAsset({
        library: 'generation', title: run.title || run.prompt.slice(0, 120) || model.title, description, mediaType: file.mediaType,
        runId, ...(run.projectId ? { projectId: run.projectId } : {}),
      }, { bytes: file.data, limit: result.limit }).id)
      for (const id of assetIds) store.inheritTags(id, run.referenceIds)
      update(runId, current => { current.results[index] = { ...current.results[index], status: 'done', assetIds, ms: Date.now() - started, credits: result.credits ?? null }; return current })
    } catch (error) {
      const failure = explain(error.message || '')
      update(runId, current => { current.results[index] = { ...current.results[index], status: 'failed', ms: Date.now() - started, ...failure }; return current })
    }
  }

  function controlsFor(model, variant, run) {
    const { task, modelParams = {}, params = {} } = run
    const other = task === 'edit' ? 'text' : 'edit'
    const saved = modelParams[model.id] ?? modelParams[JSON.stringify([model.id, task, variant.model])] ??
      modelParams[JSON.stringify([model.id, other, model.variants[other]?.model])] ?? params
    return pickParams(variant.fields, saved)
  }

  return {
    /** Ends the plugin's lifetime: running jobs no longer write results. */
    stop() { stopped = true },
    models() {
      return models().map(model => ({ ...model, guides: Object.fromEntries(
        Object.keys(model.variants).map(task => [task, promptGuide(model, task)])) }))
    },
    runs,
    /**
     * Waits until no result of the run is still running.
     * @param {string} id run id from `start()`.
     * @param {() => boolean} [cancelled] stops waiting when it turns true.
     * @returns the finished run.
     */
    async settle(id, cancelled = () => false) {
      for (;;) {
        if (stopped || cancelled()) throw new InputError('Das Atelier wird neu gestartet.', 503)
        const run = runs().find(item => item.id === id)
        if (!run) throw new InputError('Der Auftrag ist nicht mehr im Verlauf.', 404)
        if (!run.results.some(result => result.status === 'running')) return run
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    },
    /** Reads the models behind a provider page and adds them, merging variants into models already added. */
    async addModels(url) {
      let parsed
      try { parsed = new URL(String(url ?? '').trim()) } catch { throw new InputError('Gib die Adresse einer Modellseite ein.') }
      const provider = hosts[parsed.hostname.replace(/^www\./, '')]
      if (!provider || parsed.protocol !== 'https:') throw new InputError('Gib eine HTTPS-Modellseite eines unterstützten Anbieters ein.')
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
      if (item.modal && item.modal !== 'image') throw new InputError('Wähle ein Bildmodell für den Bild-Playground.')
      if (item.page && provider.capabilities.includes('resolveModels') && provider.id === 'hotapi') return this.addModels(item.page)
      const variant = { model: item.id, catalog: true, fields: [
        { key: 'prompt', type: 'prompt' },
        ...(item.aspect === false ? [] : [{ key: 'aspect_ratio', type: 'enum', label: 'Seitenverhältnis', options: ['auto', '1:1', '3:2', '2:3', '16:9', '9:16'], description: 'Gewünschtes Bildformat für diesen Anbieter.' }]),
      ] }
      const model = { id: 'catalog:' + provider.id + ':' + item.id, title: item.title, provider: provider.id, providerTitle: provider.title, variants: Object.fromEntries((item.modes ?? ['text', 'edit']).map(mode => [mode, variant])) }
      const list = models()
      if (!list.some(m => m.id === model.id)) saveModels([...list, model])
      return [model]
    },
    /**
     * Writes still-image prompts from reference images and a few keywords.
     * @param {{ referenceIds?: string[], words?: string, labels?: Record<string, number>, previous?: string[], prompt?: string, modelIds?: string[], modelParams?: object }} body
     * @returns {Promise<{ prompts: string[], model: string }>} one prompt for the whole run.
     */
    async scrabble(body) {
      const ids = Array.isArray(body.referenceIds) ? [...new Set(body.referenceIds.filter(id => typeof id === 'string'))] : []
      if (ids.length > 16) throw new InputError('Scrabble nimmt bis zu 16 Bildreferenzen.')
      const words = typeof body.words === 'string' ? body.words.trim().slice(0, 300) : ''
      const originalPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (originalPrompt.length > 32000) throw new InputError('Der Prompt darf höchstens 32.000 Zeichen enthalten.')
      const task = ids.length ? 'edit' : 'text'
      const targetModels = (Array.isArray(body.modelIds) ? [...new Set(body.modelIds)] : []).map(id => {
        const model = models().find(item => item.id === id)
        const variant = model?.variants[task]
        if (!variant) throw new InputError('Wähle ein Modell für diese Eingabe.')
        const { tip, schemaHint } = promptGuide(model, task)
        const controls = pickParams(variant.fields, body.modelParams?.[id] ?? {})
        const settings = Object.fromEntries(Object.entries(controls).filter(([key]) => ['skill', 'mode', 'aspect_ratio', 'resolution', 'count'].includes(key)))
        return { model: variant.model, provider: model.provider, task, tip, schemaHint, settings }
      })
      const studio = { referenceLabels: body.labels }
      const appearance = appearanceText(body.appearance)
      const positions = referencePlan(originalPrompt + '\n' + words + '\n' + appearance, studio, ids)
      const referenceRoles = Object.fromEntries(ids.flatMap((id, index) => {
        const role = body.roles?.[id]
        return Object.hasOwn(roleNames, role) ? [['@Bild' + (body.labels?.[id] ?? index + 1), roleNames[role]]] : []
      }))
      const fixed = Boolean(appearance || Object.keys(referenceRoles).length)
      if (!words && !originalPrompt) {
        if (!ids.length) throw new InputError('Hänge Referenzen an oder gib Stichworte ein.')
        for (const id of ids) store.asset(id)
        return { prompts: [referenceOnlyPrompt(positions)], model: '' }
      }
      const previous = Array.isArray(body.previous) ? body.previous.filter(scene => typeof scene === 'string').slice(0, 4).map(scene => scene.slice(0, 500)) : []
      const provider = (await providers.list()).find(p => p.capabilities.includes('chat') && p.secrets.every(s => s.configured))
      if (!provider) throw new InputError('Für Scrabble braucht es einen Anbieter mit Textmodell. Richte ihn unter „Anbieter“ ein.', 409)
      const images = provider.id === 'abliteration' ? [] : await Promise.all(ids.map(referenceFile))
      if (provider.id === 'abliteration') for (const id of ids) store.asset(id)
      const marks = [...positions.keys()].map(label => '@Bild' + label)
      const files = images.map((item, i) => ({ ...item.file, referenceLabel: marks[i] }))
      const ask = JSON.stringify({ count: 1, keywords: words, originalPrompt, targetModels, references: marks,
        ...(fixed && { referenceRoles, fixedSubjectAppearance: appearance }), previousScenes: previous })
      const system = fixed || provider.id === 'abliteration' ? imagePromptSystem + '\n' + referenceDirectionSystem : imagePromptSystem
      const answer = await inLane(provider.id, () => providers.call(provider.id, 'chat', { system, prompt: ask, images: files }))
      return { prompts: parsePrompt(answer.text, positions, Math.max(2000, originalPrompt.length + 500)), model: answer.model ?? '' }
    },
    async retryFailed(id) {
      const run = runs().find(item => item.id === id)
      if (!run) throw new InputError('Der Auftrag ist nicht mehr im Verlauf.', 404)
      const eligible = r => r.status === 'failed' && r.retry !== false && typeof r.sentPrompt === 'string'
      const candidates = run.results.flatMap((r, index) => eligible(r) ? [index] : [])
      if (!candidates.length) return run
      const images = await Promise.all(run.referenceIds.map(referenceFile))
      const positions = referencePlan(run.prompt, run.studio, run.referenceIds)
      const catalog = models()
      const jobs = []
      // Recheck after loading references so overlapping requests cannot submit a slot twice.
      update(id, current => {
        for (const index of candidates) {
          const result = current.results[index]
          if (!eligible(result) || (result.attempt ?? 0) !== (run.results[index].attempt ?? 0)) continue
          const model = catalog.find(item => item.id === result.modelId)
          const variant = model?.variants[run.task]
          if (!variant || (result.endpoint && result.endpoint !== variant.model)) throw new InputError('Das ursprüngliche Modell ist für diese Eingabe nicht verfügbar.')
          const controls = result.settings ?? controlsFor(model, variant, run)
          const scene = current.results.slice(0, index).filter(item => item.modelId === model.id).length
          const prompt = compileDirection(run.prompt, run.studio, run.referenceIds, positions, variant.model, model.provider, scene, run.count, controls)
          const input = { ...controls, ...(variant.fields.some(f => f.type === 'prompt') && { prompt }) }
          Object.assign(result, { attempt: (result.attempt ?? 0) + 1, status: 'running', sentPrompt: prompt,
            endpoint: variant.model, settings: controls, error: undefined, detail: undefined, retry: undefined })
          jobs.push(() => job(id, index, model, variant, input, images, run))
        }
        return current
      })
      for (const start of jobs) start()
      const current = runs().find(item => item.id === id)
      if (!current) throw new InputError('Der Auftrag ist nicht mehr im Verlauf.', 404)
      return current
    },
    removeModel(id) {
      saveModels(models().filter(model => model.id !== id))
      return { id }
    },
    /** Starts a run and returns it at once; its results fill in as the providers finish. */
    async start(body) {
      const text = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 32000) : ''
      const ids = Array.isArray(body.modelIds) ? [...new Set(body.modelIds.filter(id => typeof id === 'string'))] : []
      const referenceIds = Array.isArray(body.referenceIds) ? [...new Set(body.referenceIds.filter(id => typeof id === 'string'))].slice(0, 16) : []
      const count = [1, 2, 4].includes(body.count) ? body.count : 1
      const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
      const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {}
      // Apps that build on the Playground (e.g. the Styler) name their results and mark their runs.
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
      const template = typeof body.template === 'string' && /^[a-z0-9-]{1,40}$/.test(body.template) ? body.template : null
      if (!text && !referenceIds.length) throw new InputError('Schreib einen Prompt oder hänge Referenzbilder an.')
      if (!ids.length) throw new InputError('Wähle mindestens ein Modell.')
      if (projectId) store.project(projectId)
      const chosen = ids.map(id => models().find(model => model.id === id) ?? (() => { throw new InputError('Das Modell ist nicht mehr im Playground.', 404) })())
      const studio = body.studio && typeof body.studio === 'object' && !Array.isArray(body.studio) ? { ...body.studio } : {}
      const positions = referencePlan(text + '\n' + appearanceText(studio.appearance), studio, referenceIds)
      const prompt = text || referenceOnlyPrompt(positions)
      if (studio.prompts !== undefined) {
        if (!Array.isArray(studio.prompts) || studio.prompts.length !== count ||
          studio.prompts.some(scene => typeof scene !== 'string' || !scene.trim())) {
          throw new InputError('Für jede Aufnahme wird eine Szene benötigt.')
        }
        studio.prompts = [prompt, ...studio.prompts.slice(1).map(scene => scene.trim().slice(0, 2000))]
        for (const scene of studio.prompts.slice(1)) referencePlan(scene, studio, referenceIds)
      }
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
          const limits = variant.fields.filter(f=>f.type==='image' || f.type==='images').map(f=>f.type==='image' ? 1 : f.maxItems ?? Infinity)
          const limit = model.provider === 'hotapi' && !variant.catalog ? limits.reduce((sum,n)=>sum+n,0) : imageField?.type === 'image' ? 1 : imageField?.maxItems
          if (limit && images.length > limit) {
            Object.assign(run.results[index], { status: 'failed', error: `Dieses Modell nimmt höchstens ${limit} Referenzbilder.` })
            continue
          }
          const controls = controlsFor(model, variant, run)
          const directed = compileDirection(prompt, studio, referenceIds, positions, variant.model, model.provider, n, count, controls)
          run.results[index].endpoint = variant.model
          run.results[index].sentPrompt = directed
          run.results[index].settings = controls
          const input = { ...controls, ...(variant.fields.some(field => field.type === 'prompt') ? { prompt: directed } : {}) }
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
      const retry = /^\/runs\/([^/]+)\/retry$/.exec(path)
      if (req.method === 'POST' && retry) {
        await readBody(req)
        return json(await playground.retryFailed(retry[1]))
      }
      if (req.method === 'POST' && path === '/runs') return json(await playground.start(await readBody(req)), 201)
      if (req.method === 'POST' && path === '/scrabble') return json(await playground.scrabble(await readBody(req)))
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

/** How a preset turns the node's text into the image prompt, with its extra settings. */
const presets = {
  image: { title: 'Bild', icon: 'image', description: 'Erzeugt oder bearbeitet ein Bild mit einem Modell aus dem Foto Playground.', fields: [], compose: text => text },
  // Follows the character reference sheet rules: one sheet in one pass, mid-gray studio, a single face, visible teeth.
  character: {
    title: 'Charakterblatt', icon: 'person',
    description: 'Referenzblatt einer Figur in vier Feldern auf Studiograu: Gesicht nah, Outfit von vorn, Seite und schräg hinten. Für gleichbleibende Figuren in Bild und Video.',
    fields: [
      { key: 'outfit', label: 'Outfit', type: 'longtext', placeholder: 'Kleidung, Material, Farben, Accessoires, auch Seite und Rücken' },
      { key: 'outfitIds', label: 'Outfit-Bilder', type: 'assets' },
      { key: 'head', label: 'Kopf in Feld 2 bis 4', type: 'enum', options: [{ value: 'cropped', label: 'Beschnitten (empfohlen)' }, { value: 'back', label: 'Hinterkopf in Feld 4 sichtbar' }], default: 'cropped' },
      { key: 'mouth', label: 'Mund leicht offen (Zähne sichtbar)', type: 'boolean', default: true },
    ],
    compose: (text, params) => [
      '4-panel character reference sheet in front of a neutral mid-gray studio background, generated as one single image.',
      'Left panel: highly detailed close-up headshot of the face.',
      params.head === 'back'
        ? 'Three right panels: outfit views from the front, from the side and from the back at an angle. The head is cropped out of panels 2 and 3; panel 4 shows the back of the head.'
        : 'Three right panels: outfit views from the front, from the side and from the back at an angle, with the head cropped out of panels 2, 3 and 4.',
      'Character: ' + text + (params.mouth === false ? '' : ' Mouth slightly open so the teeth are clearly visible.'),
      params.outfit?.trim() ? 'Outfit: ' + params.outfit.trim() + ' Show the front, side and back details.' : '',
      params.outfitMarks?.length ? `Outfit references: ${params.outfitMarks.join(', ')}. Copy these garments exactly (cut, material, colour, closures) onto the character; ignore any person in them.` : '',
      'Even, neutral studio light without colored reflections. No text, no labels.',
    ].filter(Boolean).join('\n'),
  },
  set: {
    title: 'Set', icon: 'board',
    description: 'Ein Ort ohne Figuren. Als Referenz verhindert er, dass sich der Hintergrund im Video verwandelt.',
    fields: [],
    compose: text => text + '\nThe set is empty: no people, no characters, no animals. Keep the space clear where a character will enter later.',
  },
}

/**
 * A Flows image node: one Playground run with the connected prompt and reference images (`@Bild1` …).
 * Settings are the enum and boolean fields of each model's schema, stored per model; presets add their own fields.
 * @param {'image'|'character'|'set'} kind preset of the node.
 */
export function imageNode(playground, kind = 'image') {
  const preset = presets[kind]
  const settingFields = model => {
    const fields = model.variants.text?.fields ?? model.variants.edit?.fields ?? []
    return fields.filter(field => (field.type === 'enum' && field.options?.length) || field.type === 'boolean')
      .map(field => ({ key: field.key, label: field.label, type: field.type, options: field.options, default: field.default, model: model.id }))
  }
  return {
    type: kind, title: preset.title, group: 'image', icon: preset.icon, paid: true, prompt: true, description: preset.description,
    inputs: [{ id: 'prompt', kind: 'text', label: 'Prompt', multiple: true }, { id: 'refs', kind: 'image', label: 'Referenzbilder', multiple: true, mark: 'Bild' }],
    outputs: [{ id: 'image', kind: 'image', label: 'Bild' }],
    async fields() {
      const models = playground.models()
      return [
        { key: 'modelId', label: 'Modell', type: 'enum', default: models[0]?.id, empty: 'Noch kein Bildmodell. Füge im Foto Playground ein Modell hinzu.', options: models.map(model => ({ value: model.id, label: model.title,
          tags: [model.providerTitle, ...(model.variants.edit ? ['Bearbeiten'] : []), ...(model.variants.text ? ['Text zu Bild'] : [])].filter(Boolean) })) },
        { key: 'count', label: 'Anzahl', type: 'enum', options: ['1', '2', '4'], default: '1' },
        ...preset.fields,
        ...models.flatMap(settingFields),
      ]
    },
    async run({ inputs, params, prompt, projectId, stopped }) {
      const modelId = params.modelId ?? playground.models()[0]?.id
      if (!modelId) throw new InputError('Füge im Foto Playground zuerst ein Bildmodell hinzu.')
      const text = [...inputs.prompt, prompt].map(part => String(part).trim()).filter(Boolean).join('\n\n')
      if (kind !== 'image' && !text) throw new InputError(kind === 'character' ? 'Beschreibe die Figur: Alter, Gesicht, Haut, Haare, besondere Merkmale.' : 'Beschreibe den Ort.')
      // Outfit pictures of a character sheet follow the connected references and are named by their marks.
      const outfit = kind === 'character' && Array.isArray(params.outfitIds) ? params.outfitIds.filter(id => typeof id === 'string').slice(0, 8) : []
      const outfitMarks = outfit.map((_, i) => '@Bild' + (inputs.refs.length + i + 1))
      const run = await playground.start({
        prompt: kind === 'image' ? text : preset.compose(text, { ...params, outfitMarks }), modelIds: [modelId], referenceIds: [...inputs.refs, ...outfit],
        modelParams: { [modelId]: params.settings?.[modelId] ?? {} },
        count: Number(params.count ?? 1), projectId, title: (kind === 'image' ? '' : preset.title + ' · ') + text.slice(0, 120), template: 'flow',
      })
      const done = (await playground.settle(run.id, stopped)).results
      const images = done.filter(result => result.status === 'done').flatMap(result => result.assetIds)
      if (!images.length) throw new InputError(done.find(result => result.error)?.error ?? 'Das Modell hat kein Bild geliefert.')
      const credits = done.reduce((sum, result) => typeof result.credits === 'number' ? (sum ?? 0) + result.credits : sum, null)
      return { outputs: { image: images }, credits }
    },
  }
}

export function apply(ctx) {
  const playground = createPlayground(ctx.creativeStore, ctx.creativeProviders)
  ctx.effect(() => () => playground.stop())
  for (const kind of Object.keys(presets)) ctx.effect(() => ctx.creativeNodes.register(imageNode(playground, kind)))
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: base, auth: 'required', handler: createHandler(playground) }))
  // The plugin ships its own page; the hub lists it in the sidebar and hands it the shared building blocks.
  ctx.effect(() => ctx.creativeApps.register({ id: 'playground', title: 'Foto Playground', page: true, view: true, module: base + '/web.mjs',
    icon: 'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72M14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4',
    description: 'Ein Prompt, mehrere Bildmodelle, Ergebnisse in der Library.' }))
}
