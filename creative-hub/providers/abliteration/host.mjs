import { ProviderError } from '../../providers.mjs'
import { request } from '../http.mjs'

export const name = 'creativity-provider-abliteration'
export const inject = ['creativeProviders']
const title = 'Abliteration AI'
const base = 'https://api.abliteration.ai/v1/'

async function headers(env) {
  return { Authorization: 'Bearer ' + await env.secret('apiKey'), 'Content-Type': 'application/json' }
}

export function apply(ctx) {
  if (process.env.ATELIER_INSTANCE !== 'nsfw') return
  ctx.effect(() => ctx.creativeProviders.register({
    id: 'abliteration',
    title,
    description: 'Textmodell für Scrabble und die Video-Prompt-Verbesserung.',
    settings: [{ key: 'textModel', label: 'Textmodell', default: 'abliterated-model' }],
    secrets: [{ key: 'apiKey', label: 'API-Schlüssel', credential: 'ABLIT_KEY' }],
    async models(env) {
      const response = await request(title, base + 'models', { headers: await headers(env), timeout: 15000 })
      return ((await response.json()).data ?? []).filter(item => typeof item.id === 'string').map(item => ({ id: item.id, title: item.id }))
    },
    async chat(env, { system, prompt }) {
      const model = env.settings.textModel || 'abliterated-model'
      const response = await request(title, base + 'chat/completions', {
        method: 'POST', headers: await headers(env), timeout: 90000,
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      })
      const message = (await response.json()).choices?.[0]?.message?.content
      if (typeof message !== 'string' || !message.trim()) throw new ProviderError(title + ' hat keinen Text geliefert.')
      return { model, text: message.trim() }
    },
  }))
}
