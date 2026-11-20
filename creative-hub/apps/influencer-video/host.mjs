import { randomUUID } from 'node:crypto'
import { defineApp } from '../define-app.mjs'
import { readBody, readUpload, responder } from '../../http.mjs'
import { InputError, httpUrl, mediaTypeOf } from '../../store.mjs'
import { download } from '../../providers/http.mjs'
import { assembleExtension, checkExtensionSource, mediaTimeline, extractLastFrame } from './video-extension.mjs'
import { improveSeedancePrompt } from './seedance-prompt-skill.mjs'
import { referenceKinds, seedanceAspects, seedanceFormats, seedanceFrames, seedanceModes,
  seedancePromptLimit, seedanceResolutions, seedanceTasks, seedanceUploadLimits } from './seedance-options.mjs'

const app = defineApp({
  id: 'video-playground', title: 'Video Playground', page: true,
  icon: 'M4 5h12v14H4zM16 10l5-3v10l-5-3',
  description: 'Videos inszenieren, prüfen und weiterverwenden',
}, import.meta.url)
export const name = app.name
export const inject = [...app.inject, 'creativeStore', 'creativeProviders', 'creativeNodes']

const base = '/creativity-influencer/api'
const namespace = 'influencer-video:jobs'
const jobId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const imageTypes = ['image/png', 'image/jpeg']
const imageLimit = 10_000_000

async function seedanceInputs(store, body, prompt, hotapi = false) {
  const { mode } = body
  if (!seedanceModes.some(([id]) => id === mode)) throw new InputError('Wähle einen Seedance-Modus.')
  if (prompt.length > seedancePromptLimit || (!prompt && mode !== 'frames')) throw new InputError('Gib einen Prompt mit höchstens 20.480 Zeichen ein.')
  const settings = body.settings ?? {}
  if (!(hotapi ? [...seedanceResolutions, '1080p'] : seedanceResolutions).includes(settings.resolution) || !seedanceAspects.includes(settings.aspect) ||
    !seedanceFormats.includes(settings.format) || !Number.isInteger(settings.duration) ||
    ((hotapi || settings.duration !== -1) && (settings.duration < 4 || settings.duration > 30))) {
    throw new InputError('Prüfe Auflösung, Seitenverhältnis, Dauer und Dateiformat.')
  }
  const names = []
  async function load(id, formats) {
    if (typeof id !== 'string' || !jobId.test(id)) throw new InputError('Wähle eine gültige Referenzdatei.')
    const asset = store.asset(id)
    const source = store.mediaInfo(id)
    const preview = !source && httpUrl(asset.preview)
    const remote = preview && formats.some(type => type.startsWith('image/')) ? await download('Keyframe', preview) : null
    const type = source?.media_type ?? remote?.mediaType
    const size = source?.size ?? remote?.data.length
    const hotapiLimit = type?.startsWith('image/') ? 10_000_000 : 25_000_000
    if (!formats.includes(type) || size > seedanceUploadLimits[type] || (hotapi && (type === 'image/gif' || size > hotapiLimit))) {
      throw new InputError(`„${asset.title}“ hat für diese Eingabe ein ungültiges Format oder ist zu groß.`)
    }
    names.push(asset.title)
    // Upload one file at a time instead of loading several large clips into memory before submission.
    return remote ?? { mediaType: type, read: () => {
      const stored = store.media(id)
      if (!stored) throw new InputError(`„${asset.title}“ wurde aus dem Atelier entfernt.`, 404)
      return stored.media
    } }
  }
  const task = mode === 'references' ? settings.task ?? 'auto' : undefined
  if (hotapi && task === 'edit') throw new InputError('Wähle eine für HotAPI angebotene Referenzaufgabe.')
  if (task && !seedanceTasks.some(([id]) => id === task)) throw new InputError('Wähle eine gültige Aufgabe für die Referenzen.')
  const first = mode === 'frames' ? await load(body.imageId, seedanceFrames) : undefined
  const last = mode === 'frames' && body.endId ? await load(body.endId, seedanceFrames) : undefined
  const refs = { image: [], video: [], audio: [] }
  if (mode === 'references') {
    for (const [kind, title, formats, max] of referenceKinds) {
      const ids = body.referenceIds?.[kind] ?? []
      if (!Array.isArray(ids) || ids.length > max || new Set(ids).size !== ids.length) {
        throw new InputError(`Wähle bis zu ${max} unterschiedliche Referenzen für „${title}“.`)
      }
      for (const id of ids) refs[kind].push(await load(id, formats))
    }
    if (!names.length) throw new InputError('Füge mindestens eine Bild-, Video- oder Audioreferenz hinzu.')
    if (['edit', 'extend'].includes(task) && !refs.video.length) throw new InputError('Zum Bearbeiten oder Verlängern brauchst du ein Referenzvideo.')
  }
  const direction = body.extensionDirection ?? 'after'
  if (task === 'extend' && !['before', 'after'].includes(direction)) throw new InputError('Wähle, wo die Fortsetzung eingefügt wird.')
  if (task === 'extend') await checkExtensionSource(refs.video[0].read)
  const extension = task === 'extend' ? { sourceId: body.referenceIds.video[0], direction } : undefined
  const adaptive = mode === 'frames' || ['edit', 'extend'].includes(task)
  return {
    title: extension ? store.asset(extension.sourceId).title : names[0] ?? prompt.slice(0, 100), names, extension,
    seedance: { first, last, refs, settings: {
      resolution: settings.resolution, format: settings.format, task, aspect: adaptive ? 'adaptive' : settings.aspect,
      duration: task === 'edit' ? -1 : settings.duration,
      audio: settings.audio !== false, filter: settings.filter !== false, lastFrame: settings.lastFrame === true,
      webSearch: mode === 'text' && settings.webSearch === true,
    } },
  }
}

const seconds = ['4', '5', '6', '8', '10', '12', '15']
const seedanceFields = (model, resolutions) => [
  { key: 'resolution', label: 'Auflösung', type: 'enum', options: resolutions, default: '720p', model },
  { key: 'aspect', label: 'Format', type: 'enum', options: seedanceAspects, default: 'adaptive', model },
  { key: 'duration', label: 'Dauer (s)', type: 'enum', options: seconds, default: '5', model },
  { key: 'audio', label: 'Ton erzeugen', type: 'boolean', default: true, model },
  { key: 'lastFrame', label: 'Letztes Bild speichern', type: 'boolean', default: false, model },
]

/**
 * The Flows node „Video“: one job of the Video Playground. Seedance picks its mode from the connections
 * (Startbild → Start- und Endframe, Referenzen → multimodal, sonst Text zu Video); Kling animates the Startbild.
 * The node waits for the provider and checks the job status every 8 s; status checks cost nothing.
 */
export function videoNode({ start, refresh, providers, stopped: unloaded, every = 8000 }) {
  return {
    type: 'video', title: 'Video', group: 'video', icon: 'video', paid: true, prompt: true,
    description: 'Erzeugt einen Clip mit Seedance oder Kling aus dem Video Playground.',
    inputs: [
      { id: 'prompt', kind: 'text', label: 'Prompt', multiple: true },
      { id: 'start', kind: 'image', label: 'Startbild' },
      { id: 'end', kind: 'image', label: 'Endbild' },
      { id: 'images', kind: 'image', label: 'Bildreferenzen', multiple: true },
      { id: 'videos', kind: 'video', label: 'Videoreferenzen', multiple: true },
      { id: 'audio', kind: 'audio', label: 'Tonreferenzen', multiple: true },
    ],
    outputs: [{ id: 'video', kind: 'video', label: 'Video' }, { id: 'frame', kind: 'image', label: 'Letztes Bild' }],
    async fields() {
      const hotapi = (await providers.list()).find(item => item.id === 'hotapi' && item.capabilities.includes('startVideo'))
      // Like the Video Playground: an instance with HotAPI offers only its Seedance, otherwise Kie.ai with Seedance and Kling.
      if (hotapi) return [{ key: 'modelId', label: 'Modell', type: 'enum', options: [{ value: 'seedance-hotapi', label: 'Seedance 2.5 Spicy · HotAPI' }], default: 'seedance-hotapi' },
        ...seedanceFields('seedance-hotapi', [...seedanceResolutions, '1080p'])]
      return [
        { key: 'modelId', label: 'Modell', type: 'enum', options: [{ value: 'seedance', label: 'Seedance 2.5 Flash' }, { value: 'kling', label: 'Kling 2.6' }], default: 'seedance' },
        ...seedanceFields('seedance', seedanceResolutions),
        { key: 'duration', label: 'Dauer (s)', type: 'enum', options: ['5', '10'], default: '5', model: 'kling' },
        { key: 'sound', label: 'Ton erzeugen', type: 'boolean', default: false, model: 'kling' },
      ]
    },
    async run({ inputs, params, prompt, projectId, stopped }) {
      const hotapi = (await providers.list()).some(item => item.id === 'hotapi' && item.capabilities.includes('startVideo'))
      const model = hotapi ? 'seedance-hotapi' : ['seedance', 'kling'].includes(params.modelId) ? params.modelId : 'seedance'
      const settings = params.settings?.[model] ?? {}
      const text = [...inputs.prompt, prompt].map(part => String(part).trim()).filter(Boolean).join('\n\n')
      const [first] = inputs.start
      const [last] = inputs.end
      const refs = { image: inputs.images, video: inputs.videos, audio: inputs.audio }
      const hasRefs = Object.values(refs).some(list => list.length)
      let body
      if (model === 'kling') {
        if (!first) throw new InputError('Verbinde ein Startbild. Kling animiert ein Bild.')
        body = { model, mode: 'keyframe', imageId: first, prompt: text, duration: settings.duration ?? '5', sound: settings.sound === true }
      } else {
        if (first && hasRefs) throw new InputError('Seedance nimmt entweder Start- und Endbild oder Referenzen. Trenne eine der beiden Verbindungen.')
        if (last && !first) throw new InputError('Ein Endbild braucht auch ein Startbild.')
        body = { model, mode: first ? 'frames' : hasRefs ? 'references' : 'text', prompt: text, imageId: first, endId: last, referenceIds: refs,
          settings: { resolution: settings.resolution ?? '720p', aspect: settings.aspect ?? 'adaptive', format: 'mp4', duration: Number(settings.duration ?? 5),
            audio: settings.audio !== false, lastFrame: settings.lastFrame === true, task: 'auto' } }
      }
      let job = await start({ ...body, requestId: randomUUID(), projectId })
      while (job.status === 'queued' || job.status === 'submitting') {
        await new Promise(resolve => setTimeout(resolve, every))
        if (stopped() || unloaded()) throw new InputError('Das Atelier wird neu gestartet. Der Auftrag erscheint im Video Playground.', 503)
        job = await refresh(job.id)
      }
      if (job.status !== 'done') throw new InputError(job.error ?? 'Der Anbieter hat kein Video geliefert.')
      return { outputs: { video: [job.assetId], frame: job.frameId ? [job.frameId] : [] }, credits: typeof job.credits === 'number' ? job.credits : null }
    },
  }
}

export function apply(ctx) {
  app.apply(ctx)
  const store = ctx.creativeStore
  const providers = ctx.creativeProviders
  const persisted = () => store.settings(namespace).list ?? []
  const jobs = () => persisted().filter((item, index) => index < 30 || item.status === 'queued' || item.status === 'submitting')
  const find = id => persisted().find(item => item.id === id)
  const save = job => store.setSettings(namespace, { list: [job, ...persisted().filter(item => item.id !== job.id)] })
  const refreshing = new Map()
  const timelines = new Map()
  async function timeline(id) {
    const info = store.mediaInfo(id)
    if (!info || !/^(audio|video)\//.test(info.media_type)) throw new InputError('Keine Video- oder Audiodatei gefunden.', 404)
    if (timelines.has(id)) return timelines.get(id)
    const overview = mediaTimeline(store.media(id).media).catch(error => {
      timelines.delete(id)
      if (error instanceof InputError) throw error
      throw new InputError('Einzelbilder und Tonspur konnten nicht ausgelesen werden.', 422)
    })
    timelines.set(id, overview)
    if (timelines.size > 24) timelines.delete(timelines.keys().next().value)
    return overview
  }
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  // The POST may have reached Kie even if the local server was stopped before it received the task ID.
  for (const job of persisted().filter(item => item.status === 'submitting')) {
    save({ ...job, status: 'unknown', error: 'Einreichung unterbrochen. Prüfe den Auftrag zuerst beim Anbieter.' })
  }

  async function start(body) {
    if (!jobId.test(body.requestId ?? '')) throw new InputError('Die Auftrags-ID ist ungültig.')
    const existing = find(body.requestId)
    if (existing) return existing
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const projectId = typeof body.projectId === 'string' && body.projectId ? body.projectId : null
    if (projectId) store.project(projectId)
    if (body.shotId && (!projectId || !store.appData(projectId,'storyboard').data.shots?.some(shot=>shot.id===body.shotId))) {
      throw new InputError('Die Storyboard-Einstellung fehlt im gewählten Projekt.')
    }
    const hotapi = body.model === 'seedance-hotapi'
    const provider = hotapi ? 'hotapi' : 'kie'
    if (hotapi) {
      const available = (await providers.list()).find(item => item.id === provider && item.capabilities.includes('startVideo'))
      if (!available?.secrets.every(secret => secret.configured)) throw new InputError('Richte HotAPI in der NSFW-Instanz unter „Anbieter“ ein.', 409)
    }
    const seed = hotapi || body.model === 'seedance' ? await seedanceInputs(store, body, prompt, hotapi) : null
    const motionMode = !seed && body.mode === 'motion'
    let title = seed?.title
    let names = seed?.names
    let image, motion
    if (!seed) {
      if (typeof body.imageId !== 'string' || !['keyframe', 'motion'].includes(body.mode)) throw new InputError('Wähle einen Keyframe und einen Videomodus.')
      if (prompt.length > 2500 || (!motionMode && !prompt)) throw new InputError('Beschreibe die Animation mit höchstens 2.500 Zeichen.')
      if (motionMode && (typeof body.motionId !== 'string' || !['720p', '1080p'].includes(body.resolution) || !['image', 'video'].includes(body.orientation))) {
        throw new InputError('Wähle einen Bewegungsclip, die Auflösung und die Ausrichtung.')
      }
      if (!motionMode && !['5', '10'].includes(body.duration)) throw new InputError('Wähle 5 oder 10 Sekunden.')
      const asset = store.asset(body.imageId)
      const source = store.media(body.imageId)
      const preview = !source && httpUrl(asset.preview)
      image = source ? { mediaType: source.media_type, data: source.media } : preview ? await download('Keyframe', preview) : null
      if (!imageTypes.includes(image?.mediaType) || image.data.length > imageLimit) throw new InputError('Kling braucht einen PNG- oder JPEG-Keyframe bis 10 MB.')
      const savedMotion = motionMode ? store.media(body.motionId) : null
      if (motionMode && savedMotion?.media_type !== 'video/mp4') throw new InputError('Wähle einen gespeicherten MP4-Bewegungsclip.')
      if (savedMotion) motion = { mediaType: savedMotion.media_type, data: savedMotion.media }
      title = asset.title
      names = [asset.title, ...(motionMode ? [store.asset(body.motionId).title] : [])]
    }
    if (stopped) throw new InputError('Das Atelier wird neu gestartet.', 503)
    const extension = seed?.extension
    const duration = seed?.seedance.settings.duration ?? body.duration
    const submittedPrompt = extension
      ? `Verlängere den Ausgangsclip @Video1 ${extension.direction === 'before'
        ? 'unmittelbar vor seiner ersten Einstellung' : 'direkt ab seinem letzten Bild und aus der laufenden Bewegung heraus'}${duration > 0 ? ' um ' + duration + ' Sekunden' : ''}. Erzeuge den zusätzlichen Abschnitt mit einem passenden Übergang zum Ausgangsclip.

${prompt}`
      : prompt
    if (extension && submittedPrompt.length > seedancePromptLimit) {
      throw new InputError('Kürze den Szenenprompt, damit die Anweisung zur Verlängerung hineinpasst.')
    }
    const pending = find(body.requestId)
    if (pending) return pending
    const job = {
      id: body.requestId, status: 'submitting', createdAt: new Date().toISOString(),
      provider, mode: body.mode, ...(body.shotId && {shotId:body.shotId}), imageId: body.imageId, title, names, prompt, projectId, format: seed?.seedance.settings.format ?? 'mp4',
      ...(seed && { referenceTask: seed.seedance.settings.task, duration, saveLastFrame: seed.seedance.settings.lastFrame }),
      ...(extension && { extension, submittedPrompt }),
      ...(motionMode && { motionId: body.motionId }),
    }
    save(job)
    try {
      const upstream = await providers.call(provider, 'startVideo', {
        requestId: job.id,
        mode: body.mode, image, motion, seedance: seed?.seedance,
        prompt: submittedPrompt, duration: body.duration, sound: body.sound === true, resolution: body.resolution, orientation: body.orientation,
      })
      Object.assign(job, upstream, { status: 'queued' })
    } catch (error) {
      Object.assign(job, { status: 'unknown', error: `${error.message} Prüfe den Auftrag bei ${hotapi ? 'HotAPI' : 'Kie.ai'} vor einem neuen Versuch.` })
    }
    if (!stopped) save(job)
    return job
  }

  function refresh(id) {
    if (refreshing.has(id)) return refreshing.get(id)
    const job = find(id)
    if (!job) throw new InputError('Auftrag nicht gefunden.', 404)
    if (job.status !== 'queued') return job
    const check = (async () => {
      const result = await providers.call(job.provider ?? 'kie', 'videoStatus', { taskId: job.taskId, format: job.format })
      if (stopped || result.status === 'queued') return job
      if (result.status === 'failed') Object.assign(job, { status: 'failed', error: result.error })
      else {
        let output = result
        let extensionError
        if (job.extension) {
          try {
            const original = store.media(job.extension.sourceId)
            if (!original) throw new InputError('Der Ausgangsclip fehlt in der Library oder Sammlung.')
            const joined = await assembleExtension({ original: original.media, extension: result.file.data,
              direction: job.extension.direction, format: job.format, lastFrame: job.saveLastFrame })
            output = { ...result, ...joined }
            if (job.extension.direction === 'before') {
              output.frame = joined.frame
              output.frameError = joined.frameError
            }
          } catch (error) {
            const reason = error instanceof InputError ? error.message : 'Ausgangsclip und Fortsetzung konnten lokal nicht zusammengesetzt werden.'
            extensionError = 'Die Fortsetzung wurde separat gespeichert. ' + reason
          }
        }
        if (stopped) return job
        if (job.provider === 'hotapi' && job.saveLastFrame && !output.frame) {
          try { output.frame = await extractLastFrame(output.file.data) }
          catch { output.frameError = 'Das Schlussbild konnte mit FFmpeg nicht gespeichert werden.' }
        }
        if (stopped) return job
        const knownProject = store.projects().some(project => project.id === job.projectId)
        const description = [`Modell: ${job.model} über ${job.provider === 'hotapi' ? 'HotAPI' : 'Kie.ai'}`, job.prompt && `Prompt: ${job.submittedPrompt ?? job.prompt}`,
          `Referenzen: ${(job.names ?? [job.title, job.motionTitle].filter(Boolean)).join(', ')}`].filter(Boolean).join('\n')
        const project = knownProject ? { projectId: job.projectId } : {}
        const asset = store.createAsset({
          library: 'generation', title: (extensionError ? 'Fortsetzung · ' : job.extension ? 'Verlängertes Video · ' : 'Video · ') + job.title,
          description, mediaType: output.file.mediaType, ...project,
        }, { bytes: output.file.data })
        Object.assign(job, { status: 'done', assetId: asset.id, credits: result.credits, frameError: output.frameError, extensionError })
        if (knownProject && job.shotId) {
          const links = store.appData(job.projectId,'storyboard-renders')
          store.setAppData(job.projectId,'storyboard-renders',{revision:links.revision,data:{...links.data,[job.shotId]:asset.id}})
        }
        if (output.frame) {
          try {
            const frame = store.createAsset({ library: 'generation', title: 'Letzter Frame · ' + job.title,
              description, mediaType: output.frame.mediaType, ...project }, { bytes: output.frame.data })
            job.frameId = frame.id
          } catch (error) { job.frameError = error.message }
        }
      }
      save(job)
      return job
    })().finally(() => refreshing.delete(id))
    refreshing.set(id, check)
    return check
  }

  ctx.effect(() => ctx.creativeNodes.register(videoNode({ start, refresh, providers, stopped: () => stopped })))

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/creativity-influencer', auth: 'required', handler: async (req, res) => {
    const { json } = responder(req, res)
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === base + '/jobs') return json(jobs())
      const overview = /^\/creativity-influencer\/api\/media\/([0-9a-f-]{36})\/timeline$/.exec(url.pathname)
      if (req.method === 'GET' && overview && jobId.test(overview[1])) return json(await timeline(overview[1]))
      if (req.method === 'POST' && url.pathname === base + '/jobs') return json(await start(await readBody(req)), 201)
      if (req.method === 'POST' && url.pathname === base + '/prompt/improve') {
        return json(await improveSeedancePrompt(providers, await readBody(req)))
      }
      const match = new RegExp('^' + base + '/jobs/([0-9a-f-]+)/refresh$').exec(url.pathname)
      if (req.method === 'POST' && match) {
        await readBody(req)
        return json(await refresh(match[1]))
      }
      if (req.method === 'POST' && url.pathname === base + '/media') {
        const suppliedType = req.headers['content-type']
        const type = ({ 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/mp3': 'audio/mpeg' })[suppliedType] ?? suppliedType
        if (!Object.hasOwn(seedanceUploadLimits, type)) throw new InputError('Wähle PNG, JPEG, WebP, GIF, MP4, MOV, MP3 oder WAV.', 415)
        const limit = seedanceUploadLimits[type]
        const bytes = await readUpload(req, limit)
        if (mediaTypeOf(bytes) !== type) throw new InputError('Dateiformat und Dateityp stimmen nicht überein.')
        if (stopped) throw new InputError('Das Atelier wird neu gestartet.', 503)
        const { id } = store.createAsset({ library: 'clips', title: url.searchParams.get('title') || 'Video-Referenz', mediaType: type }, { bytes, limit })
        return json(store.asset(id), 201)
      }
      return json({ error: 'Seite nicht gefunden.' }, 404)
    } catch (error) {
      return json({ error: error.status ? error.message : 'Der Videoauftrag konnte nicht verarbeitet werden.' }, error.status ?? 500)
    }
  } }))
}
