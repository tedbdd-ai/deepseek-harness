/** Media provider "Brave Search": web image search through the Brave Search API. */
import { request } from '../http.mjs'

export const name = 'creativity-provider-brave'
export const inject = ['creativeProviders']

export function apply(ctx) {
  ctx.effect(() => ctx.creativeProviders.register({
    id: 'brave',
    title: 'Brave Search',
    description: 'Bildsuche im Web für Logos, Referenzen und Material.',
    secrets: [{ key: 'apiKey', label: 'Brave-Search-API-Schlüssel', credential: 'BRAVE_SEARCH_API_KEY' }],
    async search(env, { query }) {
      const url = new URL('https://api.search.brave.com/res/v1/images/search')
      url.searchParams.set('q', query)
      url.searchParams.set('count', '40')
      const response = await request('Brave Search', url, { headers: { Accept: 'application/json', 'X-Subscription-Token': await env.secret('apiKey') }, timeout: 20000 })
      const body = await response.json()
      return (body.results ?? []).flatMap(result => {
        const imageUrl = result.properties?.url ?? result.thumbnail?.src
        if (typeof imageUrl !== 'string') return []
        return [{ title: result.title ?? '', pageUrl: result.url ?? imageUrl, imageUrl, thumbnailUrl: result.thumbnail?.src ?? imageUrl, domain: result.source ?? new URL(imageUrl).host }]
      })
    },
  }))
}
