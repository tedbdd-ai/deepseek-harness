/**
 * Media provider "LiteLLM": image generation through your LiteLLM proxy.
 *
 * Requests go to `/v1/chat/completions` with `modalities: ["text", "image"]`; Gemini image models
 * (e.g. alias `nano-banana-2.1`) answer with `choices[0].message.images[].image_url.url` as data URLs.
 * References are sent as image parts. The model list comes from the proxy's `/v1/models`.
 */
import { ProviderError } from '../../providers.mjs'
import { dataUrl, download, imageFingerprint, request } from '../http.mjs'

export const name = 'creativity-provider-litellm'
export const inject = ['creativeProviders']

function endpoint(baseURL, path) {
  let base = baseURL.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  let url
  try { url = new URL(base + path) } catch { throw new ProviderError(`Ungültige LiteLLM-Adresse „${baseURL}“.`, 400) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ProviderError(`Ungültige LiteLLM-Adresse „${baseURL}“.`, 400)
  return url
}

async function headers(env) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await env.secret('apiKey') }
}

/** @param {{ baseURL?: string, defaultModel?: string }} config defaults shown in the settings form. */
export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.creativeProviders.register({
    id: 'litellm',
    title: 'LiteLLM',
    description: 'Bildmodelle über deinen LiteLLM-Proxy, z. B. nano-banana-2.1.',
    settings: [
      { key: 'baseURL', label: 'Proxy-Adresse', default: config.baseURL ?? 'http://localhost:4000' },
      { key: 'defaultModel', label: 'Standardmodell', default: config.defaultModel ?? 'nano-banana-2.1' },
    ],
    secrets: [{ key: 'apiKey', label: 'Proxy-Schlüssel', credential: 'LITELLM_API_KEY' }],
    async models(env) {
      const response = await request('LiteLLM', endpoint(env.settings.baseURL, '/v1/models'), { headers: await headers(env), timeout: 15000 })
      const body = await response.json()
      const ids = Array.isArray(body.data) ? body.data.map(item => item.id).filter(id => typeof id === 'string') : []
      const preferred = env.settings.defaultModel
      return [...new Set([preferred, ...ids.sort()])].filter(Boolean).map(id => ({ id, title: id }))
    },
    async generate(env, { model, prompt, references, aspect }) {
      const content = [{ type: 'text', text: prompt }]
      for (const file of references) {
        if (file.referenceLabel) content.push({ type: 'text', text: file.referenceLabel + ':' })
        content.push({ type: 'image_url', image_url: { url: dataUrl(file) } })
      }
      const body = {
        model: model || env.settings.defaultModel,
        messages: [{ role: 'user', content }],
        stream: false,
        modalities: ['text', 'image'],
        ...(aspect && aspect !== 'auto' ? { extra_body: { generationConfig: { imageConfig: { aspectRatio: aspect } } } } : {}),
      }
      const response = await request('LiteLLM', endpoint(env.settings.baseURL, '/v1/chat/completions'), {
        method: 'POST', headers: await headers(env), body: JSON.stringify(body), timeout: 180000,
      })
      const message = (await response.json()).choices?.[0]?.message ?? {}
      const urls = (message.images ?? []).map(image => image?.image_url?.url).filter(url => typeof url === 'string')
      if (!urls.length) {
        const text = typeof message.content === 'string' ? message.content.slice(0, 200) : ''
        throw new ProviderError(`Das Modell ${body.model} hat kein Bild geliefert.${text ? ' Antwort: ' + text : ''}`)
      }
      // Gemini image models behind LiteLLM may repeat an image in `images`, each copy with its own
      // C2PA manifest; keep each picture once.
      const files = await Promise.all([...new Set(urls)].map(url => download('LiteLLM', url)))
      const seen = new Set()
      return { images: files.filter(file => { const key = imageFingerprint(file.data); return !seen.has(key) && seen.add(key) }) }
    },
  }))
}
