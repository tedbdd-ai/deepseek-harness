/**
 * Plugin "LLM-Knoten": Flows nodes that work with a chat provider. All of them call the provider only when the node
 * runs, which needs a click.
 *
 * - „LLM“ writes or transforms text. It reads connected text, images, videos and sound (`@Bild1`, `@Video1`, `@Audio1`
 *   in the prompt) and gives one text on: expand a prompt, transcribe a voice clip to centiseconds for Seedance.
 * - „Moodboard“ is a free pinboard (pictures, colours, notes and keywords in `params.items`, placed by hand, no lines)
 *   whose pictures and notes go out without running. Its run condenses the board into a structured look (look, light,
 *   camera, palette, materials, `data`) and two or three key images, like Scrabble does for keywords. As project asset
 *   (@Look) it gives the look text and the key images.
 * - „Style-DNA“ does the same for whatever is wired into it.
 * - „Regie“ turns story, look and moodboard into a shot list with the needed figures and places. Its result `data`
 *   holds `{ shots: [{ title, duration, shot, prompt, motion }], assets: [{ name, kind, description }] }`; the editor
 *   creates Szene nodes from the shots.
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
/** Reads the JSON object in a model answer, also when the model wrapped it in a Markdown fence or a sentence. */
export function parseJson(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null } // a broken answer is reported by the caller
}
const textModel = id => !/image|banana|imagen|veo|tts|embed|whisper|dall|seedream|seedance|kling|flux/i.test(id)

/**
 * @param {ReturnType<typeof import('../../providers.mjs').createProviderRegistry>} providers
 * @param {ReturnType<typeof import('../../store.mjs').openStore>} store
 */
export function llmNode(providers, store) {
  const { fields, chat } = chatTools(providers, store)
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
    fields,
    async run({ inputs, params, prompt }) {
      const text = [...inputs.prompt, prompt].map(part => String(part).trim()).filter(Boolean).join('\n\n')
      if (!text) throw new InputError('Schreib eine Anweisung oder verbinde einen Text.')
      const answer = await chat(params, { system, prompt: text, images: inputs.images, videos: inputs.videos, audio: inputs.audio })
      return { outputs: { text: [answer.text] }, credits: null }
    },
  }
}

/** Model choice and the chat call, shared by the nodes of this plugin. */
function chatTools(providers, store) {
  const usable = async () => (await providers.list()).filter(item => item.capabilities.includes('chat') && item.secrets.every(secret => secret.configured))
  return {
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
    /** Sends one request with the attached files, labelled `@Bild1`, `@Video1`, `@Audio1` in input order. */
    async chat(params, { system, prompt, images = [], videos = [], audio = [] }) {
      const inputs = { images, videos, audio }
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
      return providers.call(provider.id, 'chat', { system, prompt, images: files, ...(rest.length && { model: rest.join(':') }) })
    },
  }
}

const dnaSystem = [
  'You are the art director of a film production. You get the contents of a moodboard: pictures (@Bild1 …), colours and notes.',
  'Condense them into a style guide that an image or video model can follow.',
  'Answer with one JSON object and nothing else: {"look": string, "light": string, "camera": string, "palette": string, "materials": string, "keyImages": number[]}.',
  'look: two or three sentences that describe the overall look. light, camera (lens, movement, film stock and grain), palette (named colours with hex codes when given) and materials: one short sentence each.',
  'keyImages: the numbers of the two or three pictures that carry the look best (1 for @Bild1).',
  'Write in the language of the notes; German if there are none.',
].join('\n')

/**
 * Asks the model for the look of `images` and `notes` and returns it as text, structured data and key images.
 * @returns {Promise<{ text: string, data: object, keys: string[] }>}
 */
async function condense(chat, params, notes, images) {
  const answer = await chat(params, { system: dnaSystem, prompt: notes.length ? 'Notizen, Stichworte und Farben:\n' + notes.join('\n') : 'Es gibt nur Bilder.', images: images.slice(0, 16) })
  const dna = parseJson(answer.text)
  if (!dna || typeof dna.look !== 'string' || !dna.look.trim()) throw new InputError('Das Modell hat keinen lesbaren Look geliefert. Führe den Knoten noch einmal aus oder wähle ein anderes Modell.')
  const field = value => (typeof value === 'string' ? value.trim().slice(0, 400) : '')
  const data = { look: field(dna.look), light: field(dna.light), camera: field(dna.camera), palette: field(dna.palette), materials: field(dna.materials) }
  const lines = [data.look, ['Licht', data.light], ['Kamera', data.camera], ['Palette', data.palette], ['Material', data.materials]]
    .map(line => (Array.isArray(line) ? (line[1] ? `${line[0]}: ${line[1]}` : '') : line)).filter(Boolean)
  const picked = (Array.isArray(dna.keyImages) ? dna.keyImages : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= Math.min(images.length, 16))
  const keys = [...new Set(picked)].slice(0, 3).map(n => images[n - 1])
  return { text: lines.join('\n'), data, keys: keys.length ? keys : images.slice(0, 3) }
}

const itemKinds = ['file', 'note', 'word', 'color']
/** The valid items of a moodboard, in reading order (top to bottom, left to right). */
export function boardItems(params) {
  const items = (Array.isArray(params.items) ? params.items : []).filter(item => item && itemKinds.includes(item.kind) && typeof item.id === 'string')
  return items.sort((a, b) => ((Number(a.y) || 0) - (Number(b.y) || 0)) || ((Number(a.x) || 0) - (Number(b.x) || 0)))
}
/**
 * Pictures, clips and the text of a moodboard (notes, keywords as one line, colours as „Farbe #…“).
 * @param {(assetId: string) => string | null} kindOf media kind of a Library file (`image`, `video`), null if it is gone.
 */
export function boardValues(params, kindOf) {
  const items = boardItems(params)
  const of = kind => items.filter(item => item.kind === kind)
  const files = of('file').filter(item => typeof item.assetId === 'string').map(item => [kindOf(item.assetId), item.assetId])
  const words = of('word').map(item => String(item.text ?? '').trim()).filter(Boolean)
  return {
    images: files.filter(([kind]) => kind === 'image').map(([, id]) => id),
    videos: files.filter(([kind]) => kind === 'video').map(([, id]) => id),
    notes: [...of('note').map(item => String(item.text ?? '').trim()).filter(Boolean), ...(words.length ? ['Stichworte: ' + words.join(', ')] : []),
      ...of('color').map(item => item.color).filter(color => /^#[0-9a-f]{6}$/i.test(color ?? '')).map(color => 'Farbe ' + color.toUpperCase())],
  }
}

/** „Moodboard“: a pinboard without lines inside; its run makes the structured look. */
export function moodboardNode(providers, store) {
  const { fields, chat } = chatTools(providers, store)
  const kindOf = id => {
    try { return store.asset(id).media_type?.split('/')[0] ?? null } catch (error) { if (error instanceof InputError) return null; throw error }
  }
  return {
    type: 'moodboard', title: 'Moodboard', group: 'board', icon: 'board', paid: true,
    description: 'Freie Pinnwand für Bilder, Farben, Notizen und Stichworte, ohne Linien. „Look erzeugen“ macht daraus Licht, Kamera, Palette, Material und Leitbilder. Als Projekt-Asset reicht @Look.',
    inputs: [],
    outputs: [
      { id: 'look', kind: 'text', label: 'Look' },
      { id: 'keys', kind: 'image', label: 'Leitbilder' },
      { id: 'images', kind: 'image', label: 'Alle Bilder', mention: false },
      { id: 'videos', kind: 'video', label: 'Clips', mention: false },
      { id: 'notes', kind: 'text', label: 'Notizen und Farben', mention: false },
    ],
    fields,
    passthrough({ params }) {
      const { images, videos, notes } = boardValues(params, kindOf)
      return { images, videos, notes }
    },
    async run({ params }) {
      const { images, notes } = boardValues(params, kindOf)
      if (!images.length && !notes.length) throw new InputError('Leg zuerst Bilder, Farben, Notizen oder Stichworte auf das Moodboard.')
      const { text, data, keys } = await condense(chat, params, notes, images)
      return { outputs: { look: [text], keys }, data, credits: null }
    },
  }
}

/** „Style-DNA“: one look text and the key images of whatever is wired into it. */
export function styleNode(providers, store) {
  const { fields, chat } = chatTools(providers, store)
  return {
    type: 'style-dna', title: 'Style-DNA', group: 'text', icon: 'color', paid: true, prompt: true,
    description: 'Verdichtet ein Moodboard zu einem Look-Text und zwei bis drei Leitbildern. Als Projekt-Asset festgelegt, reicht danach @Look in jedem Prompt.',
    inputs: [
      { id: 'text', kind: 'text', label: 'Notizen und Farben', multiple: true },
      { id: 'images', kind: 'image', label: 'Bilder', multiple: true, mark: 'Bild' },
    ],
    outputs: [{ id: 'text', kind: 'text', label: 'Look' }, { id: 'image', kind: 'image', label: 'Leitbilder' }],
    fields,
    async run({ inputs, params, prompt }) {
      if (!inputs.images.length && !inputs.text.length) throw new InputError('Verbinde ein Moodboard mit Bildern oder Notizen.')
      const notes = [...inputs.text, prompt].map(part => String(part).trim()).filter(Boolean)
      const { text, data, keys } = await condense(chat, params, notes, inputs.images)
      return { outputs: { text: [text], image: keys }, data, credits: null }
    },
  }
}

const shotSystem = [
  'You are the director of a short AI film. Break the story down into shots.',
  'Answer with one JSON object and nothing else: {"shots": [{"title": string, "duration": number, "shot": string, "prompt": string, "motion": string}], "assets": [{"name": string, "kind": "figur"|"ort"|"requisite", "description": string}]}.',
  'title: two or three words. duration: whole seconds from 4 to 15. shot: framing (Totale, Halbnahe, Nahaufnahme …).',
  'prompt: what the start frame shows, one or two sentences. motion: what moves and how the camera moves, one sentence.',
  'Refer to figures, places and the look only by their @names. Use the @names from the list of project assets when they fit; otherwise name the new figure or place in assets and write it as @Name without spaces.',
  'Write in the language of the instruction.',
].join('\n')

/** „Regie“: a shot list and the figures and places it needs, as structured data. */
export function directorNode(providers, store) {
  const { fields, chat } = chatTools(providers, store)
  return {
    type: 'director', title: 'Regie', group: 'text', icon: 'shot', paid: true, prompt: true,
    description: 'Macht aus der Story (oben im Knoten oder verbunden) und dem Look eine Shotliste mit Dauer, Ausschnitt und Bewegung. „Szenen anlegen“ legt daraus Szene-Knoten an.',
    inputs: [
      { id: 'prompt', kind: 'text', label: 'Story und Look', multiple: true },
      { id: 'images', kind: 'image', label: 'Moodboard', multiple: true, mark: 'Bild' },
    ],
    outputs: [{ id: 'text', kind: 'text', label: 'Shotliste' }],
    async fields() {
      return [...await fields(), { key: 'story', label: 'Story', type: 'longtext', rows: 5, placeholder: 'Worum geht es? Wer tut was, wo, und wie endet es?' }]
    },
    async run({ inputs, params, prompt, assets = [] }) {
      const story = typeof params.story === 'string' && params.story.trim() ? ['Story: ' + params.story.trim()] : []
      const text = [...story, ...inputs.prompt, prompt].map(part => String(part).trim()).filter(Boolean).join('\n\n')
      if (!text) throw new InputError('Verbinde eine Story oder schreib, worum es im Film geht.')
      const known = assets.length ? '\n\nProjekt-Assets: ' + assets.map(name => '@' + name).join(', ') : ''
      const answer = await chat(params, { system: shotSystem, prompt: text + known, images: inputs.images.slice(0, 12) })
      const plan = parseJson(answer.text)
      const shots = (Array.isArray(plan?.shots) ? plan.shots : []).filter(shot => shot && typeof shot.prompt === 'string' && shot.prompt.trim()).slice(0, 24).map((shot, i) => ({
        title: String(shot.title ?? '').trim().slice(0, 40) || `Einstellung ${i + 1}`,
        duration: Math.min(15, Math.max(4, Math.round(Number(shot.duration) || 5))),
        shot: String(shot.shot ?? '').trim().slice(0, 60),
        prompt: shot.prompt.trim().slice(0, 1200),
        motion: String(shot.motion ?? '').trim().slice(0, 600),
      }))
      if (!shots.length) throw new InputError('Das Modell hat keine lesbare Shotliste geliefert. Führe den Knoten noch einmal aus oder wähle ein anderes Modell.')
      const needed = (Array.isArray(plan.assets) ? plan.assets : []).filter(item => item && typeof item.name === 'string' && item.name.trim()).slice(0, 24).map(item => ({
        name: item.name.trim().replace(/^@/, '').slice(0, 40), kind: ['figur', 'ort', 'requisite'].includes(item.kind) ? item.kind : 'requisite', description: String(item.description ?? '').trim().slice(0, 600),
      }))
      const list = shots.map((shot, i) => `${i + 1}. ${shot.title} (${shot.duration} s${shot.shot ? ', ' + shot.shot : ''}): ${shot.prompt}${shot.motion ? ' Bewegung: ' + shot.motion : ''}`)
      return { outputs: { text: [list.join('\n')] }, data: { shots, assets: needed }, credits: null }
    },
  }
}

export function apply(ctx) {
  for (const make of [llmNode, moodboardNode, styleNode, directorNode]) ctx.effect(() => ctx.creativeNodes.register(make(ctx.creativeProviders, ctx.creativeStore)))
}
