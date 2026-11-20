/**
 * Media provider "LiteLLM": image generation through your LiteLLM proxy.
 *
 * Requests go to `/v1/chat/completions` with image output enabled; Gemini image models
 * (e.g. alias `nano-banana-2.1`) answer with `choices[0].message.images[].image_url.url` as data URLs.
 * References are sent as image parts. The model list comes from the proxy's `/v1/models`.
 */
import { ProviderError } from '../../providers.mjs'
import { dataUrl, download, request, sameImage } from '../http.mjs'

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

/** @param {{ baseURL?: string, defaultModel?: string, textModel?: string }} config defaults shown in the settings form. */
export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.creativeProviders.register({
    chatImages: true,
    chatFiles: true,
    id: 'litellm',
    title: 'LiteLLM',
    description: 'Bildmodelle über deinen LiteLLM-Proxy, z. B. nano-banana-2.1.',
    settings: [
      { key: 'baseURL', label: 'Proxy-Adresse', default: config.baseURL ?? 'http://localhost:4000' },
      { key: 'defaultModel', label: 'Standardmodell', default: config.defaultModel ?? 'nano-banana-2.1' },
      { key: 'textModel', label: 'Textmodell für Scrabble und Prompt-Verbesserung (leer: automatische Auswahl)', default: config.textModel ?? '' },
    ],
    secrets: [{ key: 'apiKey', label: 'Proxy-Schlüssel', credential: 'LITELLM_API_KEY' }],
    async models(env) {
      const response = await request('LiteLLM', endpoint(env.settings.baseURL, '/v1/models'), { headers: await headers(env), timeout: 15000 })
      const body = await response.json()
      const ids = Array.isArray(body.data) ? body.data.map(item => item.id).filter(id => typeof id === 'string') : []
      const preferred = env.settings.defaultModel
      return [...new Set([preferred, ...ids.sort()])].filter(Boolean).map(id => ({ id, title: id }))
    },
    async chat(env, { system, prompt, images = [], model: chosen }) {
      let model = chosen?.trim() || env.settings.textModel?.trim()
      if (!model) {
        const response = await request('LiteLLM', endpoint(env.settings.baseURL, '/v1/models'), { headers: await headers(env), timeout: 15000 })
        const ids = ((await response.json()).data ?? []).map(item => item.id).filter(id => typeof id === 'string')
        model = ids.find(id => /flash/i.test(id) && !/image|banana|imagen|veo|tts|embed/i.test(id)) ?? ids.find(id => /gemini|gpt|claude/i.test(id) && !/image|banana|imagen|veo|tts|embed/i.test(id))
        if (!model) throw new ProviderError('Der Proxy bietet kein Textmodell an. Trag unter „Anbieter“ ein Textmodell ein.', 400)
      }
      const content = [{ type: 'text', text: prompt }]
      for (const file of images) {
        if (file.referenceLabel) content.push({ type: 'text', text: file.referenceLabel + ':' })
        // Video and audio go as inline files, which LiteLLM passes on to Gemini.
        content.push(file.mediaType.startsWith('image/') ? { type: 'image_url', image_url: { url: dataUrl(file) } } : { type: 'file', file: { file_data: dataUrl(file) } })
      }
      const response = await request('LiteLLM', endpoint(env.settings.baseURL, '/v1/chat/completions'), {
        method: 'POST', headers: await headers(env), timeout: 180000,
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
      })
      const message = (await response.json()).choices?.[0]?.message ?? {}
      const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map(part => part.text ?? '').join('') : ''
      if (!text.trim()) throw new ProviderError(`Das Textmodell ${model} hat keine Antwort geliefert.`)
      return { text: text.trim(), model }
    },
    async generate(env, { model, prompt, references, aspect }) {
      const content = [{ type: 'text', text: prompt }]
      for (const file of references) {
        if (file.referenceLabel) content.push({ type: 'text', text: file.referenceLabel + ':' })
        content.push({ type: 'image_url', image_url: { url: dataUrl(file) } })
      }
      const chosen = model || env.settings.defaultModel
      const body = {
        model: chosen,
        messages: [{ role: 'user', content }],
        stream: false,
        modalities: /(?:^|[/:-])nano-banana(?:[-/]|$)/i.test(chosen) ? ['image'] : ['text', 'image'],
        ...(aspect && aspect !== 'auto' ? { extra_body: { generationConfig: { imageConfig: { aspectRatio: aspect } } } } : {}),
      }
      const response = await request('LiteLLM', endpoint(env.settings.baseURL, '/v1/chat/completions'), {
        method: 'POST', headers: await headers(env), body: JSON.stringify(body), timeout: 240000,
      })
      const choices = (await response.json()).choices ?? []
      const urls = choices.flatMap(({ message }) => [
        ...(message?.images ?? []),
        ...(Array.isArray(message?.content) ? message.content.filter(part => part?.type === 'image_url') : []),
      ]).map(part => part?.image_url?.url).filter(url => typeof url === 'string' && url.length)
      if (!urls.length) {
        const reason = choices.map(choice => choice.native_finish_reason || choice.finish_reason).filter(Boolean).join(', ')
        const reply = choices.map(({ message }) => typeof message?.content === 'string' ? message.content :
          (message?.content ?? []).map(part => part?.text || '').join(' ')).join(' ').trim().slice(0, 200)
        if (/content_filter|safety|prohibited_content|blocklist/i.test(reason)) throw new ProviderError('Das Modell hat die Ausgabe durch seinen Inhaltsfilter blockiert (moderation).')
        throw new ProviderError(`Das Modell ${body.model} hat kein Bild geliefert.${reason ? ' Abschlussgrund: ' + reason + '.' : ''}${reply ? ' Antwort: ' + reply : ''}`)
      }
      // Gemini image models behind LiteLLM may repeat an image in `images`, each copy with its own
      // C2PA manifest and slightly different pixels; keep each picture once.
      const files = await Promise.all([...new Set(urls)].map(url => download('LiteLLM', url)))
      const kept = []
      for (const file of files) if (!kept.some(other => sameImage(other.data, file.data))) kept.push(file)
      return { images: kept }
    },
  }))
}
