import { setTimeout as sleep } from 'node:timers/promises'
import { ProviderError } from '../../providers.mjs'
import { fitReferenceImage } from '../../media-edit.mjs'
import { catalog, resolveModels } from './catalog.mjs'
import { download, request } from '../http.mjs'

export const name = 'creativity-provider-hotapi'
export const inject = ['creativeProviders']

const title = 'HotAPI'
const base = 'https://api.hotapi.ai/v1/'
const videoModel = 'seedance-2.5-spicy'
const extensions = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4',
  'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
}

async function call(env, path, body, idempotencyKey) {
  const headers = { Authorization: 'Bearer ' + await env.secret('apiKey') }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(body)
  }
  const response = await request(title, base + path, { method: body ? 'POST' : 'GET', headers, body })
  return response.json()
}

async function upload(env, file, { resizeImage = false } = {}) {
  let mediaType = file.mediaType
  if (!extensions[mediaType]) throw new ProviderError('HotAPI unterstützt dieses Referenzformat nicht.', 400)
  let data = file.read ? file.read() : file.data
  const limit = mediaType.startsWith('image/') ? 10 : 25
  if (data.length > limit * 1_000_000) {
    if (!resizeImage || limit !== 10) throw new ProviderError('Das HotAPI-Uploadlimit beträgt ' + limit + ' MB pro Referenz.', 400)
    data = await fitReferenceImage(data, limit * 1_000_000)
    mediaType = 'image/png'
  }
  const form = new FormData()
  form.set('file', new Blob([data], { type: mediaType }), 'reference.' + extensions[mediaType])
  const { url } = await call(env, 'uploads', form)
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new ProviderError('HotAPI hat keine Upload-Adresse geliefert.')
  return url
}

async function submit(env, endpoint, input, requestId) {
  const task = await call(env, endpoint, input, requestId)
  if (typeof task.id !== 'string' || !task.id) throw new ProviderError('HotAPI hat keine Auftrags-ID geliefert.')
  return task.id
}

async function status(env, id, kind) {
  const task = await call(env, 'tasks/' + encodeURIComponent(id))
  if (['pending', 'queued', 'processing'].includes(task.status)) return { status: 'queued' }
  if (task.status !== 'succeeded') return { status: 'failed', error: task.error?.message ?? 'HotAPI-Auftrag: ' + task.status }
  const urls = (task.output?.assets ?? []).filter(asset => asset.type === kind && typeof asset.url === 'string' && asset.url.startsWith('https://')).map(asset => asset.url)
  if (!urls.length) return { status: 'failed', error: 'HotAPI hat keine Ergebnisdatei geliefert.' }
  return { status: 'done', urls, credits: task.actual_credits_cost ?? task.estimated_credits_cost }
}

const dimensions = {
  '1:1': [1024, 1024], '3:2': [1152, 768], '2:3': [768, 1152], '16:9': [1024, 576], '9:16': [576, 1024],
}

export function apply(ctx, { pollMs = 2500 } = {}) {
  if (process.env.ATELIER_INSTANCE !== 'nsfw') return
  async function renderImage(env,{variant,input,images}) {
    const fields = variant.fields.filter(f=>['image','images'].includes(f.type))
    const payload = {...input}
    let offset = 0
    const assignments = []
    for (const field of fields) {
      const capacity = field.type === 'image' ? 1 : field.maxItems ?? images.length
      const files = images.slice(offset,offset+capacity)
      if (!files.length && field.required) throw new ProviderError('Es fehlt eine Bildreferenz für '+field.label+'.',400)
      if (files.length) assignments.push({field,files})
      offset += files.length
    }
    if (offset < images.length) throw new ProviderError('Zu viele Bildreferenzen für '+variant.model+'.',400)
    for (const {field,files} of assignments) {
      const urls = []
      for (const file of files) urls.push(await upload(env, file, { resizeImage: true }))
      payload[field.key] = field.type === 'image' ? urls[0] : urls
    }
    const id = await submit(env,variant.model,payload)
    const deadline = Date.now() + 600_000
    while (Date.now() < deadline) {
      await sleep(pollMs)
      let result
      try { result = await status(env, id, 'image') }
      catch (error) {
        if (error.status === 429) continue
        throw error
      }
      if (result.status === 'failed') throw new ProviderError(result.error)
      if (result.status === 'done') {
        const images = await Promise.all(result.urls.map(url => download(title, url)))
        if (images.some(file => !file.mediaType.startsWith('image/'))) throw new ProviderError('HotAPI hat keine Bilddatei geliefert.')
        return { images, credits: result.credits }
      }
    }
    throw new ProviderError('HotAPI hat noch kein Ergebnis geliefert. Auftrags-ID: ' + id)
  }
  ctx.effect(() => ctx.creativeProviders.register({
    id: 'hotapi',
    title,
    description: 'Spicy-Bildmodelle und Seedance 2.5 Spicy für Video.',
    secrets: [{ key: 'apiKey', label: 'API-Schlüssel', credential: 'HOTAPI_KEY' }],
    models: catalog,
    resolveModels,
    runModel: renderImage,
    async generate(env, {model, prompt, references = [], aspect}) {
      const family = model.split('/')[0]
      const [entry] = await resolveModels(env, {url:'https://hotapi.ai/models/'+family})
      const variant = entry.variants[references.length ? 'edit' : 'text']
      if (!variant) throw new ProviderError('Für dieses Modell passt die Anzahl der Referenzen nicht.',400)
      const input = {}
      if (variant.fields.some(f=>f.type==='prompt')) input.prompt = prompt
      if (dimensions[aspect] && variant.fields.some(f=>f.key==='width')) [input.width,input.height] = dimensions[aspect]
      if (variant.fields.find(f=>f.key==='aspect_ratio')?.options?.includes(aspect)) input.aspect_ratio = aspect
      return renderImage(env,{variant,input,images:references})
    },
    async startVideo(env, { mode, prompt, seedance, requestId }) {
      const { first, last, refs, settings } = seedance
      const input = {
        ...(prompt && { prompt }), duration_seconds: settings.duration, resolution: settings.resolution,
        generate_audio: settings.audio, output_format: settings.format,
      }
      const endpoints = { text: 'text-to-video', frames: 'image-to-video', references: 'reference-to-video' }
      if (mode !== 'frames') input.ratio = settings.aspect
      if (first) input.image_url = await upload(env, first)
      if (last) input.last_frame_url = await upload(env, last)
      for (const [kind, files] of Object.entries(refs)) {
        if (!files.length) continue
        const urls = []
        for (const file of files) urls.push(await upload(env, file))
        input['reference_' + kind + '_urls'] = urls
      }
      const taskId = await submit(env, videoModel + '/' + endpoints[mode], input, requestId)
      return { taskId, model: videoModel }
    },
    async videoStatus(env, { taskId, format }) {
      const result = await status(env, taskId, 'video')
      if (result.status !== 'done') return result
      const file = await download(title, result.urls[0], format === 'mov' ? 'video/quicktime' : 'video/mp4')
      return { status: 'done', file, credits: result.credits }
    },
  }))
}
