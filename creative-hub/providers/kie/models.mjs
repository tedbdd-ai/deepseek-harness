/**
 * Image models of the Kie.ai Market that the plugin can drive (docs.kie.ai/market). Kie.ai has no
 * model-list endpoint and every model takes its own input fields, so each entry states:
 * - `text`/`edit`: the Kie.ai model id without and with reference images (`edit` absent = no references),
 * - `refs`: the input field for reference URLs and `maxRefs` its limit,
 * - `aspects`: accepted `aspect_ratio` values; `input`: fixed extra fields per model id.
 */
import { ProviderError } from '../../providers.mjs'

const nano = ['auto', '1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9']
const gpt = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21']
const gpt25 = ['auto', '1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9', '27:16', '16:27', '9:8', '8:9']

/** @type {Array<{ id: string, title: string, text: string, edit?: string, refs?: string, maxRefs?: number, aspects: string[], editAspects?: string[], input?: Record<string, Record<string, unknown>> }>} */
export const catalog = [
  { id: 'nano-banana-2', title: 'Nano Banana 2', text: 'nano-banana-2', edit: 'nano-banana-2', refs: 'image_input', maxRefs: 10, aspects: nano, input: { 'nano-banana-2': { output_format: 'png' } } },
  { id: 'nano-banana-2-1', title: 'Nano Banana 2.1', text: 'nano-banana-2-1', edit: 'nano-banana-2-1', refs: 'image_input', maxRefs: 10, aspects: nano, input: { 'nano-banana-2-1': { output_format: 'png' } } },
  { id: 'nano-banana-pro', title: 'Nano Banana Pro', text: 'nano-banana-pro', edit: 'nano-banana-pro', refs: 'image_input', maxRefs: 8, aspects: nano.filter(a => !['1:4', '4:1', '1:8', '8:1'].includes(a)), input: { 'nano-banana-pro': { output_format: 'png', resolution: '1K' } } },
  { id: 'gpt-image-2', title: 'GPT Image 2', text: 'gpt-image-2-text-to-image', edit: 'gpt-image-2-image-to-image', refs: 'input_urls', maxRefs: 16, aspects: gpt, input: { 'gpt-image-2-text-to-image': { resolution: '1K' }, 'gpt-image-2-image-to-image': { resolution: '1K' } } },
  ...['sunburst', 'flare'].map(variant => {
    const text = `gpt-image-2-5-${variant}-text-to-image`, edit = `gpt-image-2-5-${variant}-image-to-image`
    return { id: 'gpt-image-2-5-' + variant, title: 'GPT Image 2.5 ' + variant[0].toUpperCase() + variant.slice(1), text, edit, refs: 'input_urls', maxRefs: 16, aspects: gpt25, input: { [text]: { resolution: '1K' }, [edit]: { resolution: '1K' } } }
  }),
  { id: 'seedream-5-5', title: 'Seedream 5.5', text: 'seedream/5-5-text-to-image', edit: 'seedream/5-5-image-to-image', refs: 'image_urls', maxRefs: 10, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], editAspects: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], input: { 'seedream/5-5-text-to-image': { output_format: 'png' }, 'seedream/5-5-image-to-image': { output_format: 'png' } } },
  { id: 'flux-2-pro', title: 'Flux 2 Pro', text: 'flux-2/pro-text-to-image', edit: 'flux-2/pro-image-to-image', refs: 'input_urls', maxRefs: 8, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], editAspects: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], input: { 'flux-2/pro-text-to-image': { resolution: '1K' }, 'flux-2/pro-image-to-image': { resolution: '1K' } } },
  { id: 'grok-imagine-2', title: 'Grok Imagine 2', text: 'grok-imagine-image-2-0/text-to-image', edit: 'grok-imagine-image-2-0/image-edit', refs: 'image_urls', maxRefs: 5, aspects: ['1:1', '2:3', '3:2', '16:9', '9:16'], editAspects: ['auto', '1:1', '2:3', '3:2', '16:9', '9:16'] },
]

const ratio = value => { const [w, h] = value.split(':').map(Number); return Math.log(w / h) }

/**
 * Picks an accepted aspect ratio: the requested one, else `auto` when allowed, else the closest ratio
 * (`auto` without support becomes `1:1`).
 * @param {string[]} accepted the model's `aspect_ratio` values.
 * @param {string} requested the client's choice, e.g. `4:5` or `auto`.
 * @returns {string} a value from `accepted`.
 */
export function pickAspect(accepted, requested) {
  if (accepted.includes(requested)) return requested
  if (accepted.includes('auto')) return 'auto'
  const target = ratio(requested === 'auto' || !/^\d+:\d+$/.test(requested) ? '1:1' : requested)
  return accepted.reduce((best, value) => Math.abs(ratio(value) - target) < Math.abs(ratio(best) - target) ? value : best)
}

/**
 * Builds the createTask request for a catalog model; a model id outside the catalog is sent with
 * the Nano Banana input fields.
 * @param {string} id catalog id or raw Kie.ai model id.
 * @param {{ prompt: string, aspect: string, refUrls: string[] }} request prompt, aspect and public reference URLs.
 * @returns {{ model: string, input: Record<string, unknown> }} the task body.
 */
export function taskFor(id, { prompt, aspect, refUrls }) {
  const spec = catalog.find(entry => entry.id === id) ?? { id, title: id, text: id, edit: id, refs: 'image_input', maxRefs: 10, aspects: nano }
  const withRefs = refUrls.length > 0
  if (withRefs && !spec.edit) throw new ProviderError(`${spec.title} nimmt keine Referenzbilder.`, 400)
  if (withRefs && refUrls.length > spec.maxRefs) throw new ProviderError(`${spec.title} nimmt höchstens ${spec.maxRefs} Referenzbilder, du hast ${refUrls.length} angehängt.`, 400)
  const model = withRefs ? spec.edit : spec.text
  const input = { prompt, aspect_ratio: pickAspect((withRefs && spec.editAspects) || spec.aspects, aspect || 'auto'), ...spec.input?.[model] }
  if (withRefs) input[spec.refs] = refUrls
  return { model, input }
}
