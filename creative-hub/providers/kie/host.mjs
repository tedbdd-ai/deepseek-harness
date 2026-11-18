/**
 * Media provider "Kie.ai" (https://docs.kie.ai): image generation and background removal.
 *
 * Kie.ai runs asynchronous tasks: `POST /api/v1/jobs/createTask`, then `GET /api/v1/jobs/recordInfo`
 * until `state` is `success` or `fail`. Errors arrive with HTTP 200 and a `code` in the body.
 * Model inputs take public URLs, so local references are uploaded first through
 * `/api/file-base64-upload` (Kie.ai deletes uploads after 24 hours). One task yields one image.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { ProviderError } from '../../providers.mjs'
import { dataUrl, download, request } from '../http.mjs'
import { catalog, taskFor } from './models.mjs'

export const name = 'creativity-provider-kie'
export const inject = ['creativeProviders']
const base = 'https://api.kie.ai'

async function call(env, path, body) {
  const response = await request('Kie.ai', base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + await env.secret('apiKey'), 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  })
  const json = await response.json()
  if (json.code !== 200) throw new ProviderError(`Kie.ai meldet ${json.code}: ${json.msg ?? 'unbekannter Fehler'}`)
  return json.data ?? {}
}

async function publicUrl(env, file) {
  if (file.url) return file.url
  const uploaded = await call(env, '/api/file-base64-upload', { base64Data: dataUrl(file), uploadPath: 'atelier' })
  if (!uploaded.downloadUrl) throw new ProviderError('Kie.ai hat keine Upload-Adresse geliefert.')
  return uploaded.downloadUrl
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
    async removeBackground(env, { image }) {
      const result = await runTask(env, env.settings.removeBackgroundModel, { image: await publicUrl(env, image) }, timing)
      return { image: await download('Kie.ai', result.urls[0]), credits: result.credits }
    },
  }))
}
