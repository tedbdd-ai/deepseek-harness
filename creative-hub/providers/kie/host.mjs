/**
 * Media provider "Kie.ai" (https://docs.kie.ai): image and video generation and background removal.
 *
 * Kie.ai runs asynchronous tasks: `POST /api/v1/jobs/createTask`, then `GET /api/v1/jobs/recordInfo`
 * until `state` is `success` or `fail`. Errors arrive with HTTP 200 and a `code` in the body.
 * Model inputs take public URLs, so local references are uploaded first through
 * `/api/file-base64-upload` on the upload host (Kie.ai deletes uploads after 24 hours). A task may return multiple images.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { ProviderError } from '../../providers.mjs'
import { fitReferenceImage } from '../../media-edit.mjs'
import { dataUrl, download, request } from '../http.mjs'
import { catalog, taskFor } from './models.mjs'
import { fieldsOf, parseYaml } from '../schema.mjs'

export const name = 'creativity-provider-kie'
export const inject = ['creativeProviders']
const base = 'https://api.kie.ai'
const docs = 'https://docs.kie.ai'
// The File Upload API runs on its own host (docs.kie.ai/file-upload-api); api.kie.ai answers 404 there.
const uploadBase = 'https://kieai.redpandaai.co'

async function call(env, path, body, host = base) {
  const response = await request('Kie.ai', host + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + await env.secret('apiKey'), 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  })
  const json = await response.json()
  if (json.code !== 200 && json.success !== true) throw new ProviderError(`Kie.ai meldet ${json.code}: ${json.msg ?? 'unbekannter Fehler'}`)
  return json.data ?? {}
}

async function publicUrl(env, file) {
  if (file.url) return file.url
  const uploaded = await call(env, '/api/file-base64-upload', { base64Data: dataUrl(file), uploadPath: 'atelier' }, uploadBase)
  if (!uploaded.downloadUrl) throw new ProviderError('Kie.ai hat keine Upload-Adresse geliefert.')
  return uploaded.downloadUrl
}


/** Reads one model page of docs.kie.ai (Markdown with an OpenAPI YAML block) into `{ title, model, fields }`. */
async function describeDoc(url) {
  let text = ''
  let yaml
  // docs.kie.ai occasionally answers a burst of requests with a page without the spec; one retry covers it.
  for (let attempt = 0; attempt < 2 && !yaml; attempt++) {
    if (attempt) await sleep(1500)
    text = await (await request('Kie.ai-Doku', url, { timeout: 20000 })).text()
    yaml = /```yaml\n([\s\S]*?)\n```/.exec(text)?.[1]
  }
  if (!yaml) throw new ProviderError(`Unter ${url} steht keine Modellbeschreibung.`, 400)
  const spec = parseYaml(yaml)
  const schema = spec?.paths?.['/api/v1/jobs/createTask']?.post?.requestBody?.content?.['application/json']?.schema
  const model = schema?.properties?.model?.enum?.[0] ?? schema?.properties?.model?.default
  if (!model || !schema?.properties?.input) throw new ProviderError(`Die Beschreibung unter ${url} ist kein Kie.ai-Market-Modell.`, 400)
  return { title: (/^# (.+)$/m.exec(text)?.[1] ?? model).trim(), model, fields: fieldsOf(schema.properties.input) }
}

/**
 * Finds the doc pages for a kie.ai model family, including when the page URL names its currently selected model.
 */
async function docPages(url) {
  if (url.hostname === 'docs.kie.ai') return [url.origin + url.pathname.replace(/\/?$/, '').replace(/(?:\.md)?$/, '.md')]
  const slug = url.pathname.split('/').filter(Boolean).pop()
  const wanted = url.searchParams.get('model')
  if (!slug && !wanted) throw new ProviderError('Gib die Adresse einer Modellseite auf kie.ai an, z. B. kie.ai/gpt-image-2-6.', 400)
  if (slug === 'kling-image-4-0') {
    return ['image', 'long-image'].map(variant => docs + '/market/kling-4-0/' + variant + '.md')
  }
  const index = await (await request('Kie.ai-Doku', docs + '/llms.txt', { timeout: 20000 })).text()
  const links = [...index.matchAll(/\((https:\/\/docs\.kie\.ai\/market\/[^)]+\.md)\)/g)].map(match => match[1])
  const name = link => link.split('/').pop().replace(/\.md$/, '')
  const family = slug ? links.filter(link => name(link).startsWith(slug + '-') || name(link) === slug) : []
  const hits = family.length ? family : links.filter(link => name(link) === wanted || link.endsWith('/' + wanted + '.md'))
  if (!hits.length) throw new ProviderError(`Zu „${wanted || slug}“ hat Kie.ai keine Modellbeschreibung.`, 404)
  return [...new Set(hits)]
}

async function createTask(env, model, input) {
  const { taskId } = await call(env, '/api/v1/jobs/createTask', { model, input })
  if (typeof taskId !== 'string' || !taskId) throw new ProviderError('Kie.ai hat keine Auftrags-ID geliefert.')
  return taskId
}

async function taskStatus(env, taskId) {
  const record = await call(env, '/api/v1/jobs/recordInfo?taskId=' + encodeURIComponent(taskId))
  if (record.state === 'fail') return { status: 'failed', error: record.failMsg || 'Kie.ai hat den Auftrag abgelehnt.' }
  if (record.state !== 'success') return { status: 'queued' }
  let result
  try { result = JSON.parse(record.resultJson ?? '{}') } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new ProviderError('Kie.ai hat ein unlesbares Ergebnis geliefert.')
  }
  if (!Array.isArray(result?.resultUrls) || !result.resultUrls.length) throw new ProviderError('Kie.ai hat kein Ergebnis geliefert.')
  return { status: 'done', urls: result.resultUrls, lastFrameUrl: Array.isArray(result.lastFrameUrl) ? result.lastFrameUrl[0] : result.lastFrameUrl, credits: record.creditsConsumed == null ? null : Number(record.creditsConsumed) || 0 }
}

const uploadExtensions = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
}

async function uploadVideoInput(env, file) {
  const form = new FormData()
  form.set('file', new Blob([file.read ? file.read() : file.data], { type: file.mediaType }), 'reference.' + uploadExtensions[file.mediaType])
  form.set('uploadPath', 'atelier')
  const response = await request('Kie.ai', uploadBase + '/api/file-stream-upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + await env.secret('apiKey') }, body: form,
  })
  const json = await response.json()
  if (json.code !== 200 || !json.data?.downloadUrl) throw new ProviderError('Kie.ai konnte die Referenzdatei nicht hochladen.')
  return json.data.downloadUrl
}

/** @param {{ pollMs?: number, timeoutMs?: number }} config polling interval and limit. */
async function runTask(env, model, input, { pollMs = 2000, timeoutMs = 600000 } = {}) {
  const taskId = await createTask(env, model, input)
  for (const started = Date.now(); Date.now() - started < timeoutMs;) {
    await sleep(pollMs)
    const result = await taskStatus(env, taskId)
    if (result.status === 'failed') throw new ProviderError(`Kie.ai-Auftrag fehlgeschlagen: ${result.error}`)
    if (result.status === 'done') return { ...result, credits: result.credits ?? 0 }
  }
  throw new ProviderError(`Kie.ai hat nach ${Math.round(timeoutMs / 60000)} Minuten kein Ergebnis geliefert. Auftrag ${taskId} steht unter kie.ai/logs.`)
}

export function apply(ctx, config = {}) {
  const timing = { pollMs: config.pollMs, timeoutMs: config.timeoutMs }
  ctx.effect(() => ctx.creativeProviders.register({
    id: 'kie',
    title: 'Kie.ai',
    description: 'Generieren mit Nano Banana, GPT Image, Seedream, Flux und Grok, Freistellen mit Recraft. Abrechnung in Kie.ai-Credits.',
    settings: [
      { key: 'extraModels', label: 'Weitere Modell-IDs (durch Komma getrennt, Eingaben wie Nano Banana)', default: '' },
      { key: 'removeBackgroundModel', label: 'Modell zum Freistellen', default: 'recraft/remove-background' },
    ],
    secrets: [{ key: 'apiKey', label: 'API-Schlüssel (kie.ai/api-key)', credential: 'KIE_API_KEY' }],
    models: env => [
      ...catalog.map(({ id, title }) => ({ id, title })),
      ...env.settings.extraModels.split(',').map(id => id.trim()).filter(id => id && !catalog.some(entry => entry.id === id)).map(id => ({ id, title: id })),
    ],
    async generate(env, { model, prompt, references, aspect }) {
      taskFor(model || catalog[0].id, { prompt, aspect, refUrls: references.map(() => '') })
      const refUrls = await Promise.all(references.map(file => publicUrl(env, file)))
      const task = taskFor(model || catalog[0].id, { prompt, aspect, refUrls })
      const result = await runTask(env, task.model, task.input, timing)
      return { images: await Promise.all(result.urls.map(url => download('Kie.ai', url))), credits: result.credits }
    },
    async startVideo(env, { mode, image, motion, prompt, duration, sound, resolution, orientation, seedance }) {
      if (seedance) {
        const model = 'bytedance/seedance-2-5-flash'
        const { first, last, refs, settings } = seedance
        const input = {
          resolution: settings.resolution, aspect_ratio: settings.aspect, duration: settings.duration,
          output_format: settings.format, generate_audio: settings.audio, return_last_frame: settings.lastFrame,
          nsfw_checker: settings.filter,
        }
        if (prompt) input.prompt = prompt
        if (mode === 'frames') {
          input.first_frame_url = await uploadVideoInput(env, first)
          if (last) input.last_frame_url = await uploadVideoInput(env, last)
        } else if (mode === 'references') {
          const fields = { image: 'reference_image_urls', video: 'reference_video_urls', audio: 'reference_audio_urls' }
          for (const [kind, field] of Object.entries(fields)) {
            if (!refs[kind].length) continue
            input[field] = []
            for (const file of refs[kind]) input[field].push(await uploadVideoInput(env, file))
          }
          input.omni_reference_task_type = settings.task
        } else input.web_search = settings.webSearch
        return { taskId: await createTask(env, model, input), model }
      }
      const model = mode === 'motion' ? 'kling-2.6/motion-control' : 'kling-2.6/image-to-video'
      const imageUrl = await publicUrl(env, image)
      const input = mode === 'motion'
        ? { prompt, input_urls: [imageUrl], video_urls: [await uploadVideoInput(env, motion)], mode: resolution, character_orientation: orientation }
        : { prompt, image_urls: [imageUrl], duration, sound }
      if (!prompt) delete input.prompt
      return { taskId: await createTask(env, model, input), model }
    },
    async videoStatus(env, { taskId, format }) {
      const result = await taskStatus(env, taskId)
      if (result.status !== 'done') return result
      const file = await download('Kie.ai', result.urls[0], format === 'mov' ? 'video/quicktime' : 'video/mp4')
      const output = { status: 'done', credits: result.credits, file }
      if (result.lastFrameUrl) {
        try { output.frame = await download('Kie.ai', result.lastFrameUrl, 'image/jpeg') }
        catch (error) { output.frameError = error.message }
      }
      return output
    },
    async resolveModels(env, { url }) {
      const pages = await docPages(new URL(url))
      const models = new Map()
      for (const page of pages) {
        const doc = await describeDoc(page)
        const group = doc.model.replace(/(?:[-/](?:text-to-image|image-to-image|image-edit|edit))$/i, '')
        const id = 'kie:' + group
        const takesImages = doc.fields.some(field => field.type === 'images' || field.type === 'image')
        const task = takesImages && (/image[ -]to[ -]image|edit/i.test(doc.title + ' ' + doc.model) || doc.fields.some(field => (field.type === 'images' || field.type === 'image') && field.required)) ? 'edit' : 'text'
        const label = doc.model === 'kling-4-0/image' ? 'Kling Image 4.0' :
          doc.model === 'kling-4-0/long-image' ? 'Kling Image 4.0 · Langformat' : group.replace(/[-/]/g, ' ')
        const entry = models.get(id) ?? { id, title: label, provider: 'kie', providerTitle: 'Kie.ai', page: url, variants: {} }
        entry.variants[task] = { model: doc.model, fields: doc.fields, doc: page }
        if (takesImages && task === 'text') entry.variants.edit ??= entry.variants.text
        models.set(id, entry)
      }
      return [...models.values()]
    },
    async runModel(env, { variant, input, images }) {
      const field = variant.fields.find(item => item.type === 'images') ?? variant.fields.find(item => item.type === 'image')
      const body = { ...input }
      const kling = variant.model === 'kling-4-0/image'
      const long = variant.model === 'kling-4-0/long-image'
      const referenceUrl = async file => {
        if (!kling && !long) return publicUrl(env, file)
        if (['image/png', 'image/jpeg'].includes(file.mediaType) && file.url) return file.url
        if (['image/png', 'image/jpeg'].includes(file.mediaType) && file.data.length <= 20_000_000) return uploadVideoInput(env, file)
        return uploadVideoInput(env, { mediaType: 'image/png', data: await fitReferenceImage(file.data, 20_000_000) })
      }
      if (kling) {
        body.count ??= body.mode === 'series' ? 2 : 1
        const min = body.mode === 'series' ? 2 : 1
        const max = body.mode === 'series' ? 10 : 9
        if (body.count < min || body.count > max) throw new ProviderError(`Für diesen Kling-Modus sind ${min} bis ${max} Bilder möglich.`, 400)
      }
      if (long) {
        body.skill ??= images.length ? 'ecommerce' : 'webpage'
        if (body.skill === 'ecommerce' && !images.length) throw new ProviderError('Für eine Produktseite braucht Kling mindestens ein Produktbild.', 400)
        if (body.skill === 'webpage') {
          if (images.length > 2) throw new ProviderError('Für Webdesign sind höchstens zwei Bilder möglich: Stil und Motiv.', 400)
          delete body.length
          const [style, subject] = await Promise.all(images.map(referenceUrl))
          if (style) body.style_image = style
          if (subject) body.subject_image = subject
        }
      }
      if (images.length && !(long && body.skill === 'webpage')) {
        if (!field) throw new ProviderError('Dieses Modell nimmt keine Bilder.', 400)
        const urls = await Promise.all(images.map(referenceUrl))
        body[field.key] = field.type === 'images' ? urls.slice(0, field.maxItems ?? urls.length) : urls[0]
      }
      const result = await runTask(env, variant.model, body, timing)
      const limit = kling || long ? 48 * 1024 * 1024 : undefined
      const files = await Promise.all(result.urls.map(url => download('Kie.ai', url, undefined, { limit })))
      if (files.some(file => !file.mediaType.startsWith('image/'))) throw new ProviderError('Kie.ai hat kein Bild geliefert.')
      return { images: files, credits: result.credits, ...(limit && { limit }) }
    },
    async removeBackground(env, { image }) {
      const result = await runTask(env, env.settings.removeBackgroundModel, { image: await publicUrl(env, image) }, timing)
      return { image: await download('Kie.ai', result.urls[0]), credits: result.credits }
    },
  }))
}
