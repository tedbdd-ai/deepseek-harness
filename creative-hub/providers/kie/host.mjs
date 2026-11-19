/**
 * Media provider "Kie.ai" (https://docs.kie.ai): image generation and background removal.
 *
 * Kie.ai runs asynchronous tasks: `POST /api/v1/jobs/createTask`, then `GET /api/v1/jobs/recordInfo`
 * until `state` is `success` or `fail`. Errors arrive with HTTP 200 and a `code` in the body.
 * Model inputs take public URLs, so local references are uploaded first through
 * `/api/file-base64-upload` on the upload host (Kie.ai deletes uploads after 24 hours). One task yields one image.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { ProviderError } from '../../providers.mjs'
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
  const index = await (await request('Kie.ai-Doku', docs + '/llms.txt', { timeout: 20000 })).text()
  const links = [...index.matchAll(/\((https:\/\/docs\.kie\.ai\/market\/[^)]+\.md)\)/g)].map(match => match[1])
  const name = link => link.split('/').pop().replace(/\.md$/, '')
  const family = slug ? links.filter(link => name(link).startsWith(slug + '-') || name(link) === slug) : []
  const hits = family.length ? family : links.filter(link => name(link) === wanted || link.endsWith('/' + wanted + '.md'))
  if (!hits.length) throw new ProviderError(`Zu „${wanted || slug}“ hat Kie.ai keine Modellbeschreibung.`, 404)
  return [...new Set(hits)]
}

/** @param {{ pollMs?: number, timeoutMs?: number }} config polling interval (default 2 s) and limit (default 10 min). */
async function runTask(env, model, input, { pollMs = 2000, timeoutMs = 600000 } = {}) {
  const { taskId } = await call(env, '/api/v1/jobs/createTask', { model, input })
  if (!taskId) throw new ProviderError('Kie.ai hat keinen Auftrag angelegt.')
  for (const started = Date.now(); Date.now() - started < timeoutMs;) {
    await sleep(pollMs)
    const record = await call(env, '/api/v1/jobs/recordInfo?taskId=' + encodeURIComponent(taskId))
    if (record.state === 'fail') throw new ProviderError(`Kie.ai-Auftrag fehlgeschlagen: ${record.failMsg || 'ohne Begründung'}`)
    if (record.state === 'success') {
      let urls = []
      try { urls = JSON.parse(record.resultJson || '{}').resultUrls ?? [] } catch { urls = [] }
      if (!urls.length) throw new ProviderError('Kie.ai hat kein Ergebnis geliefert.')
      return { urls, credits: Number(record.creditsConsumed) || 0 }
    }
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
    async resolveModels(env, { url }) {
      const pages = await docPages(new URL(url))
      const models = new Map()
      for (const page of pages) {
        const doc = await describeDoc(page)
        const group = doc.model.replace(/(?:[-/](?:text-to-image|image-to-image|image-edit|edit))$/i, '')
        const id = 'kie:' + group
        const takesImages = doc.fields.some(field => field.type === 'images' || field.type === 'image')
        const task = takesImages && (/image[ -]to[ -]image|edit/i.test(doc.title + ' ' + doc.model) || doc.fields.some(field => (field.type === 'images' || field.type === 'image') && field.required)) ? 'edit' : 'text'
        const entry = models.get(id) ?? { id, title: group.replace(/[-/]/g, ' '), provider: 'kie', providerTitle: 'Kie.ai', page: url, variants: {} }
        entry.variants[task] = { model: doc.model, fields: doc.fields, doc: page }
        if (takesImages && task === 'text') entry.variants.edit ??= entry.variants.text
        models.set(id, entry)
      }
      return [...models.values()]
    },
    async runModel(env, { variant, input, images }) {
      const field = variant.fields.find(item => item.type === 'images') ?? variant.fields.find(item => item.type === 'image')
      const body = { ...input }
      if (images.length) {
        if (!field) throw new ProviderError('Dieses Modell nimmt keine Bilder.', 400)
        const urls = await Promise.all(images.map(file => publicUrl(env, file)))
        body[field.key] = field.type === 'images' ? urls.slice(0, field.maxItems ?? urls.length) : urls[0]
      }
      const result = await runTask(env, variant.model, body, timing)
      return { images: await Promise.all(result.urls.map(url => download('Kie.ai', url))), credits: result.credits }
    },
    async removeBackground(env, { image }) {
      const result = await runTask(env, env.settings.removeBackgroundModel, { image: await publicUrl(env, image) }, timing)
      return { image: await download('Kie.ai', result.urls[0]), credits: result.credits }
    },
  }))
}
