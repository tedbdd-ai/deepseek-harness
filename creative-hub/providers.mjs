/**
 * Registry of media providers (image generation, background removal, image search).
 *
 * A provider plugin injects `creativeProviders` and calls `register(provider)`, which returns a
 * disposer. It declares its own settings and secrets; the registry stores settings in the hub
 * database and secrets in the Harness credential store (`ctx.credentials`), so no provider
 * keeps configuration of its own and every UI can render the same forms.
 *
 * Provider fields:
 * - `id`, `title`, `description`
 * - `settings`: `[{ key, label, default, placeholder? }]`, plain values such as a base URL
 * - `secrets`: `[{ key, label, credential }]`, `credential` is the credential name (e.g. `LITELLM_API_KEY`)
 * - optional actions, each called as `(env, input)` where `env = { settings, secret(key) }`:
 *   - `models(env)` → `[{ id, title }]`
 *   - `generate(env, { model, prompt, references, aspect })` → `{ images: [{ mediaType, data }], credits? }`;
 *     one call yields the images of one request; `references` are `[{ mediaType, data, url? }]`
 *   - `removeBackground(env, { image })` → `{ image: { mediaType, data }, credits? }`
 *   - `search(env, { query })` → `[{ title, pageUrl, imageUrl, thumbnailUrl, domain }]`
 *   - `resolveModels(env, { url })` → Playground models read from a model page:
 *     `[{ id, title, provider, providerTitle, page, variants: { text?, edit? } }]`, each variant
 *     `{ model, fields }` with `fields` from `providers/schema.mjs`
 *   - `referenceMedia(env, { kind, image })` → `{ file: { mediaType, data }, model }` for model clips and GLB files
 *   - `chat(env, { system, prompt, images, model? })` → `{ text, model }`: a text answer from a language model that may look at
 *     the files (`[{ mediaType, data, referenceLabel? }]`); used by Playground Scrabble and the Flows node „LLM“.
 *     `model` picks one of the provider's text models instead of its default.
 *     A provider whose model really reads images sets `chatImages: true` (needed for AI tagging); one that also reads
 *     video and audio files sets `chatFiles: true`.
 *   - `startVideo(env, { mode, image, motion?, prompt, duration?, sound?, resolution?, orientation?, seedance? })`
 *     → `{ taskId, model }` for an asynchronous image-to-video or motion-transfer job
 *   - `videoStatus(env, { taskId, format? })` → `{ status: 'queued'|'failed'|'done', error?, file?, frame?, frameError?, credits? }`
 *   - `runModel(env, { variant, input, images })` → `{ images, credits? }`; `input` holds only fields
 *     the variant declares, `images` are reference files `[{ mediaType, data, url? }]`
 */
import { InputError, idPattern } from './store.mjs'

const actions = ['models', 'generate', 'removeBackground', 'search', 'resolveModels', 'runModel', 'referenceMedia', 'chat', 'startVideo', 'videoStatus']
const credentialName = /^[A-Z_][A-Z0-9_]{0,127}$/

/** Thrown by providers for failures the user can fix or should read (missing key, quota, upstream error). */
export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

/**
 * @param {ReturnType<typeof import('./store.mjs').openStore>} store holds provider settings.
 * @param {() => any} credentials returns the Harness credential service or `undefined`.
 */
export function createProviderRegistry(store, credentials) {
  const providers = new Map()

  function get(id) {
    const provider = providers.get(id)
    if (!provider) throw new InputError(`Der Anbieter „${id}“ ist nicht installiert.`, 404)
    return provider
  }

  function settingsOf(provider) {
    const saved = store.settings('provider:' + provider.id)
    return Object.fromEntries(provider.settings.map(field => [field.key, typeof saved[field.key] === 'string' && saved[field.key] ? saved[field.key] : field.default ?? '']))
  }

  async function secretOf(provider, key) {
    const field = provider.secrets.find(item => item.key === key)
    if (!field) throw new Error(`Anbieter ${provider.id} kennt kein Geheimnis ${key}.`)
    const service = credentials()
    const value = service ? (await service.resolve(field.credential))?.value : process.env[field.credential]
    if (!value?.trim()) throw new ProviderError(`Für ${provider.title} fehlt „${field.label}“. Trag es in den Einstellungen des Hubs ein.`, 400)
    return value.trim()
  }

  return {
    register(provider) {
      if (!idPattern.test(provider.id)) throw new Error(`Ungültige Anbieter-ID "${provider.id}".`)
      if (providers.has(provider.id)) throw new Error(`Anbieter "${provider.id}" ist bereits registriert.`)
      const entry = { settings: [], secrets: [], description: '', ...provider }
      if (process.env.ATELIER_INSTANCE === 'nsfw') {
        entry.secrets = entry.secrets.map(secret => ({ ...secret, credential: 'NSFW_' + secret.credential }))
      }
      for (const secret of entry.secrets) if (!credentialName.test(secret.credential)) throw new Error(`Ungültiger Credential-Name "${secret.credential}".`)
      providers.set(provider.id, entry)
      return () => { if (providers.get(provider.id) === entry) providers.delete(provider.id) }
    },

    /** Providers with their capabilities, current settings and whether each secret is set; never secret values. */
    async list() {
      const service = credentials()
      return Promise.all([...providers.values()].sort((a, b) => a.title.localeCompare(b.title, 'de')).map(async provider => {
        const settings = settingsOf(provider)
        return {
          id: provider.id,
          title: provider.title,
          description: provider.description,
          capabilities: actions.filter(action => typeof provider[action] === 'function'),
          chatImages: Boolean(provider.chatImages),
          chatFiles: Boolean(provider.chatFiles),
          settings: provider.settings.map(field => ({ key: field.key, label: field.label, placeholder: field.placeholder ?? field.default ?? '', value: settings[field.key] })),
          secrets: await Promise.all(provider.secrets.map(async field => {
            const info = service ? await service.describe(field.credential) : { configured: Boolean(process.env[field.credential]?.trim()), writable: false }
            return { key: field.key, label: field.label, credential: field.credential, configured: Boolean(info.configured), source: info.source ?? '', writable: Boolean(info.writable) }
          })),
        }
      }))
    },

    /** Saves plain settings and, through the credential store, secrets. An empty secret removes it. */
    async configure(id, { settings = {}, secrets = {} }) {
      const provider = get(id)
      const values = {}
      for (const field of provider.settings) {
        if (typeof settings[field.key] === 'string') values[field.key] = settings[field.key].trim().slice(0, 2000)
      }
      store.setSettings('provider:' + id, { ...store.settings('provider:' + id), ...values })
      const pending = provider.secrets.filter(field => typeof secrets[field.key] === 'string')
      if (pending.length) {
        const service = credentials()
        if (!service) throw new InputError('Dieser Harness hat keinen Credential-Speicher. Setze die Umgebungsvariable stattdessen.', 409)
        for (const field of pending) {
          const value = secrets[field.key].trim()
          if (value) await service.set(field.credential, value)
          else await service.unset(field.credential)
        }
      }
    },

    /**
     * Runs one provider action with its resolved settings and secrets.
     * @throws {InputError} when the provider or action does not exist.
     */
    async call(id, action, input) {
      const provider = get(id)
      if (!actions.includes(action) || typeof provider[action] !== 'function') throw new InputError(`${provider.title} kann „${action}“ nicht.`)
      const env = { settings: settingsOf(provider), secret: key => secretOf(provider, key) }
      return provider[action](env, input)
    },
  }
}
