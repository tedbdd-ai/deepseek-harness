/**
 * Media provider "fal.ai": models added by their page address, run through the fal queue API.
 *
 * `resolveModels` reads `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` for the
 * model's input schema. `runModel` submits to `https://queue.fal.run/<id>`, polls the request's
 * status URL until `COMPLETED` and downloads the images from the response. Reference images are
 * sent as data URLs, which fal accepts for every URL input.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { ProviderError } from '../../providers.mjs'
import { dataUrl, download, request } from '../http.mjs'
import { fieldsOf } from '../schema.mjs'

export const name = 'creativity-provider-fal'
export const inject = ['creativeProviders']

/** Endpoint id from a fal.ai page or API address, e.g. `fal-ai/flux-2-pro/edit`. */
function endpointOf(url) {
  if (url.hostname === 'queue.fal.run' || url.hostname === 'fal.run') return url.pathname.replace(/^\/|\/$/g, '')
  const match = /^\/models\/(.+?)(\/(api|playground|llms\.txt))?\/?$/.exec(url.pathname)
  if (url.hostname !== 'fal.ai' || !match) throw new ProviderError('Gib die Adresse einer Modellseite auf fal.ai an, z. B. fal.ai/models/fal-ai/flux-2-pro.', 400)
  return match[1]
}

async function headers(env) {
  return { Authorization: 'Key ' + await env.secret('apiKey'), 'Content-Type': 'application/json', Accept: 'application/json' }
}

function queueUrl(value) {
  const url = URL.canParse(value) && new URL(value)
  if (!url || url.origin !== 'https://queue.fal.run' || url.username || url.password) throw new ProviderError('fal.ai hat eine ungültige Auftragsadresse geliefert.')
  return url.href
}

/** @param {{ pollMs?: number, timeoutMs?: number }} config polling interval (default 2 s) and limit (default 10 min). */
export function apply(ctx, config = {}) {
  const pollMs = config.pollMs ?? 2000
  const timeoutMs = config.timeoutMs ?? 600000
  const meshModel = config.meshModel ?? 'fal-ai/trellis-2'
  const videoModel = config.referenceVideoModel ?? 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'

  async function queue(env, model, body) {
    const auth = { headers: await headers(env), redirect: 'error' }
    const queued = await (await request('fal.ai', 'https://queue.fal.run/' + model, {
      ...auth, method: 'POST', body: JSON.stringify(body), timeout: 60000,
    })).json()
    const statusUrl = queueUrl(queued.status_url)
    const responseUrl = queueUrl(queued.response_url)
    for (const started = Date.now(); Date.now() - started < timeoutMs;) {
      await sleep(pollMs)
      const status = await (await request('fal.ai', statusUrl, { ...auth, timeout: 30000 })).json()
      if (status.status === 'COMPLETED') return (await request('fal.ai', responseUrl, { ...auth, timeout: 60000 })).json()
      if (status.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) throw new ProviderError(`fal.ai meldet ${status.status}.`)
    }
    throw new ProviderError(`fal.ai hat nach ${Math.round(timeoutMs / 60000)} Minuten kein Ergebnis geliefert.`)
  }

  ctx.effect(() => ctx.creativeProviders.register({
    id: 'fal',
    title: 'fal.ai',
    description: 'Jedes Bildmodell von fal.ai, im Playground per Adresse der Modellseite hinzugefügt.',
    secrets: [{ key: 'apiKey', label: 'API-Schlüssel (fal.ai/dashboard/keys)', credential: 'FAL_KEY' }],
    async resolveModels(env, { url }) {
      const endpoint = endpointOf(new URL(url))
      const spec = await (await request('fal.ai', 'https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=' + encodeURIComponent(endpoint), { timeout: 20000 })).json()
      const resolve = ref => ref.split('/').slice(1).reduce((node, key) => node?.[key], spec)
      const post = spec.paths?.['/' + endpoint]?.post
      const ref = post?.requestBody?.content?.['application/json']?.schema?.$ref
      const schema = ref ? resolve(ref) : Object.entries(spec.components?.schemas ?? {}).find(([key]) => key.endsWith('Input'))?.[1]
      if (!schema) throw new ProviderError(`fal.ai beschreibt „${endpoint}“ nicht.`, 404)
      const fields = fieldsOf(schema, resolve).filter(field => field.key !== 'sync_mode')
      const meta = spec.info?.['x-fal-metadata'] ?? {}
      const acceptsImages = fields.some(field => ['image', 'images'].includes(field.type))
      const task = fields.some(field => (field.type === 'images' || field.type === 'image') && field.required) ? 'edit' : 'text'
      const group = endpoint.replace(/\/(edit|image-to-image|text-to-image)$/, '')
      const title = (spec.info?.title?.replace(/^Queue OpenAPI for /, '') ?? group).split('/').slice(1).join(' ').replace(/-/g, ' ') || group
      return [{ id: 'fal:' + group, title: title.replace(/\b\w/g, c => c.toUpperCase()).replace(/ Edit$/i, ''), provider: 'fal', providerTitle: 'fal.ai', page: meta.playgroundUrl ?? url, variants: { ...(acceptsImages && { edit: { model: endpoint, fields } }), [task]: { model: endpoint, fields } } }]
    },
    async runModel(env, { variant, input, images }) {
      const body = { ...input }
      const field = variant.fields.find(item => item.type === 'images') ?? variant.fields.find(item => item.type === 'image')
      if (images.length) {
        if (!field) throw new ProviderError('Dieses Modell nimmt keine Bilder.', 400)
        const urls = images.map(file => file.url ?? dataUrl(file))
        body[field.key] = field.type === 'images' ? urls.slice(0, field.maxItems ?? urls.length) : urls[0]
      }
      const output = await queue(env, variant.model, body)
      const urls = [...(output.images ?? []), output.image, output.video].filter(Boolean).map(item => item.url).filter(Boolean)
      if (!urls.length) throw new ProviderError('fal.ai hat kein Bild geliefert.')
      return { images: await Promise.all(urls.map(url => download('fal.ai', url))) }
    },
    async referenceMedia(env, { kind, image }) {
      const mesh = kind === 'mesh'
      const model = mesh ? meshModel : videoModel
      const input = { image_url: dataUrl(image) }
      if (!mesh) Object.assign(input, {
        duration: '5',
        prompt: 'Uncut full-body fashion model reference video. The subject slowly turns from front to three-quarter and profile in place. Keep identity, face, body shape, base outfit, and lighting consistent. Locked camera, whole body and feet visible, seamless studio background.',
      })
      const output = await queue(env, model, input)
      const url = (mesh ? output.model_glb : output.video)?.url
      if (!url) throw new ProviderError('fal.ai hat keine Datei für die Referenz geliefert.')
      return { model, file: await download('fal.ai', url, mesh ? 'model/gltf-binary' : 'video/mp4') }
    },
  }))
}
