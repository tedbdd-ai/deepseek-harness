/**
 * Plugin "LLM-Knoten": the Flows node „LLM“, which writes or transforms text with a chat provider.
 *
 * It reads connected text, images, videos and sound (`@Bild1`, `@Video1`, `@Audio1` in the prompt) and gives one text
 * on. Typical uses: expand a prompt, write a scene list from a story, or transcribe a voice clip to centiseconds with a
 * start offset for Seedance. Calls the provider only when the node runs, which needs a click.
 */
import { ProviderError } from '../../providers.mjs'
import { InputError } from '../../store.mjs'

export const name = 'creativity-node-llm'
export const inject = ['creativeNodes', 'creativeProviders', 'creativeStore']

const system = [
  'You are one step in a creative workflow for photo and film production.',
  'Follow the instruction and return only the requested text, without preamble, explanations or Markdown fences.',
  'Marks like @Bild1, @Video1 or @Audio1 name the attached files; keep such marks when the answer is a prompt for the next step.',
  'Answer in the language of the instruction unless it asks for another.',
].join('\n')
const textModel = id => !/image|banana|imagen|veo|tts|embed|whisper|dall|seedream|seedance|kling|flux/i.test(id)

/**
 * @param {ReturnType<typeof import('../../providers.mjs').createProviderRegistry>} providers
 * @param {ReturnType<typeof import('../../store.mjs').openStore>} store
 */
export function llmNode(providers, store) {
  const usable = async () => (await providers.list()).filter(item => item.capabilities.includes('chat') && item.secrets.every(secret => secret.configured))
  return {
    type: 'llm', title: 'LLM', group: 'text', icon: 'sparkle', paid: true, prompt: true,
    description: 'Schreibt oder verwandelt Text mit einem Sprachmodell. Liest auch Bilder, Videos und Ton, etwa für ein Transkript mit Zeitstempeln.',
    inputs: [
      { id: 'prompt', kind: 'text', label: 'Text', multiple: true },
      { id: 'images', kind: 'image', label: 'Bilder', multiple: true, mark: 'Bild' },
      { id: 'videos', kind: 'video', label: 'Videos', multiple: true, mark: 'Video' },
      { id: 'audio', kind: 'audio', label: 'Ton', multiple: true, mark: 'Audio' },
    ],
    outputs: [{ id: 'text', kind: 'text', label: 'Text' }],
    async fields() {
      const options = []
      for (const provider of await usable()) {
        const tags = [provider.title, ...(provider.chatImages ? ['Bilder'] : []), ...(provider.chatFiles ? ['Video und Ton'] : [])]
        options.push({ value: provider.id, label: `${provider.title} · Standard`, tags })
        if (!provider.chatFiles) continue
        try {
          for (const model of await providers.call(provider.id, 'models', {})) {
            if (textModel(model.id)) options.push({ value: provider.id + ':' + model.id, label: model.title, tags })
          }
        } catch (error) {
          // An unreachable proxy still leaves its default model selectable; running shows the real error.
          if (!(error instanceof ProviderError)) throw error
        }
      }
      return [{ key: 'modelId', label: 'Modell', type: 'enum', options, default: options[0]?.value, empty: 'Noch kein Textmodell. Richte unter „Anbieter“ LiteLLM oder einen anderen Anbieter mit Textmodell ein.' }]
    },
    async run({ inputs, params, prompt }) {
      const available = await usable()
      const [providerId, ...rest] = String(params.modelId ?? available[0]?.id ?? '').split(':')
      const provider = available.find(item => item.id === providerId)
      if (!provider) throw new InputError('Richte unter „Anbieter“ einen Anbieter mit Textmodell ein.', 409)
      const media = [...inputs.images.map(id => ['@Bild', id]), ...inputs.videos.map(id => ['@Video', id]), ...inputs.audio.map(id => ['@Audio', id])]
      if (inputs.images.length && !provider.chatImages) throw new InputError(`${provider.title} liest keine Bilder. Wähle ein anderes Modell.`)
      if ((inputs.videos.length || inputs.audio.length) && !provider.chatFiles) throw new InputError(`${provider.title} liest keine Videos oder Tondateien. Wähle ein anderes Modell.`)
      const counts = {}
      const files = media.map(([mark, id]) => {
        const stored = store.media(id)
        if (!stored) throw new InputError(`„${store.asset(id).title}“ hat keine gespeicherte Datei.`, 409)
        counts[mark] = (counts[mark] ?? 0) + 1
        return { mediaType: stored.media_type, data: Buffer.from(stored.media), referenceLabel: mark + counts[mark] }
      })
      const text = [...inputs.prompt, prompt].map(part => String(part).trim()).filter(Boolean).join('\n\n')
      if (!text) throw new InputError('Schreib eine Anweisung oder verbinde einen Text.')
      const answer = await providers.call(provider.id, 'chat', { system, prompt: text, images: files, ...(rest.length && { model: rest.join(':') }) })
      return { outputs: { text: [answer.text] }, credits: null }
    },
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.creativeNodes.register(llmNode(ctx.creativeProviders, ctx.creativeStore)))
}
