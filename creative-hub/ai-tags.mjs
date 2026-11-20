/**
 * AI tagging on explicit request: a provider with an image-reading chat model suggests tags
 * from the starter vocabulary. Results are suggestions (origin `ki`); this is the only paid tag source.
 */
import { fitReferenceImage } from './media-edit.mjs'
import { InputError } from './store.mjs'

const maxPerCall = 12
const imageLimit = 4 * 1024 * 1024

const system = `Du verschlagwortest Bilder für eine Medienbibliothek. Antworte ausschließlich mit JSON ohne Erklärung: {"tags": {"<gruppe>": ["<tag>", …]}}.
Verwende die Gruppen und, wo möglich, nur Namen aus dem gegebenen Vokabular. Höchstens 4 Tags pro Gruppe. Für Dinge, die das Vokabular nicht kennt, nutze die Gruppe "frei" mit kurzen deutschen Begriffen (höchstens 5). Nenne nur, was im Bild klar zu sehen ist.`

/** Extracts the JSON object of a model answer (plain or inside a code fence). */
export function parseAnswer(text) {
  const body = String(text ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  const start = body.indexOf('{'), end = body.lastIndexOf('}')
  if (start < 0 || end < start) throw new InputError('Das Textmodell hat keine Tags geliefert. Versuche es erneut.', 502)
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    if (!parsed || typeof parsed.tags !== 'object' || Array.isArray(parsed.tags)) throw new Error('shape')
    return parsed.tags
  } catch {
    throw new InputError('Das Textmodell hat keine Tags geliefert. Versuche es erneut.', 502)
  }
}

/**
 * @param {object} store creativeStore.
 * @param {object} providers creativeProviders.
 * @param {string[]} ids at most 12 assets with an image; others are skipped.
 * @returns {{ provider: string, model: string, tagged: {id: string, added: number}[], skipped: string[] }}
 */
export async function aiTagAssets(store, providers, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > maxPerCall) throw new InputError(`Wähle bis zu ${maxPerCall} Bilder pro Durchgang.`)
  const provider = (await providers.list()).find(item => item.capabilities.includes('chat') && item.chatImages && item.secrets.every(secret => secret.configured))
  if (!provider) throw new InputError('Richte unter „Anbieter“ einen Textanbieter mit Bildeingabe ein, um mit KI zu verschlagworten.', 409)
  const vocabulary = store.tagVocabulary().filter(facet => facet.editable && facet.id !== 'frei' && facet.tags.length)
    .map(facet => `${facet.id} (${facet.name}): ${facet.tags.map(tag => tag.name).join(', ')}`).join('\n')
  const tagged = [], skipped = []
  let model = ''
  for (const id of [...new Set(ids)]) {
    const file = store.media(id)
    if (!file?.media_type?.startsWith('image/')) { skipped.push(id); continue }
    let data = Buffer.from(file.media)
    if (data.length > imageLimit) data = await fitReferenceImage(data, imageLimit).catch(() => data)
    const result = await providers.call(provider.id, 'chat', {
      system, prompt: `Vokabular:\n${vocabulary}\n\nTitel: ${store.asset(id).title}`, images: [{ mediaType: data.length === file.media.length ? file.media_type : 'image/png', data }],
    })
    model = result.model ?? model
    const answer = parseAnswer(result.text)
    const found = new Map()
    for (const [facet, names] of Object.entries(answer)) {
      if (!Array.isArray(names)) continue
      for (const raw of names.slice(0, facet === 'frei' ? 5 : 4)) {
        if (typeof raw !== 'string' || !raw.trim() || raw.length > 40) continue
        const known = store.resolveTag(raw)
        if (known) found.set(known, 0.7)
        else if (facet === 'frei') found.set(store.resolveTag(raw, { create: true }), 0.6)
      }
    }
    store.addSuggestions(id, [...found].map(([tagId, confidence]) => ({ tagId, origin: 'ki', confidence })))
    tagged.push({ id, added: found.size })
  }
  return { provider: provider.id, model, tagged, skipped }
}
