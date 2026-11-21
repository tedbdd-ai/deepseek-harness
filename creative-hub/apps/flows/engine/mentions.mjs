/**
 * Project assets and `@Name` mentions, shared by the engine (server) and the editor (browser).
 *
 * A node with `asset: true` is a project asset: its name can be mentioned with `@Name` in any prompt of the flow without
 * a line. The mention becomes an implicit edge from the asset to the mentioning node, so the engine orders, plans and
 * marks results stale as for a drawn line. Files go to the first input of their kind that numbers references
 * (`@Bild1` …); text goes to the virtual handle `textHandle` and is put into the prompt in place of the mention. Output
 * ports with `mention: false` (all pictures of a moodboard, say) travel only on drawn lines.
 * A run node reads mentions in its own prompt and in the prompts of source nodes (Notiz, Szene) wired straight into it.
 */

/** Target handle of an implicit edge that carries an asset's text into the mentioning prompt. */
export const textHandle = '@text'

/** Display name of a node: its own name or the title of its type. */
export const nodeName = (node, type) => String(node.name ?? '').trim() || type?.title || 'Knoten'

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Pattern for `@Name` that does not continue into a longer word (`@Bild` does not match `@Bild1`). */
export const mentionPattern = name => new RegExp('@' + escape(name) + '(?![\\p{L}\\p{N}_])', 'giu')

/**
 * @param {string} text
 * @param {string} name
 * @returns {boolean} whether `text` mentions `@name`.
 */
export const mentions = (text, name) => Boolean(name) && mentionPattern(name).test(String(text ?? ''))

/**
 * Implicit edges from project assets to the nodes whose prompts mention them. Drawn lines between the same ports
 * win; an asset never feeds itself.
 * @param {{ nodes: object[], edges: object[] }} doc
 * @param {(type: string) => ({ title: string, inputs: object[], outputs: object[], runs?: boolean } | undefined)} typeOf
 *   node type by name; `runs` is false for source nodes (their prompt travels on a line).
 * @returns {{ id: string, source: string, sourceHandle: string, target: string, targetHandle: string, implicit: true }[]}
 */
export function implicitEdges(doc, typeOf) {
  const assets = doc.nodes.filter(node => node.asset && typeOf(node.type))
  if (!assets.length) return []
  const byId = new Map(doc.nodes.map(node => [node.id, node]))
  const result = []
  for (const node of doc.nodes) {
    const type = typeOf(node.type)
    if (!type?.runs) continue
    const feeding = doc.edges.filter(edge => edge.target === node.id).map(edge => byId.get(edge.source))
      .filter(source => source && typeOf(source.type) && !typeOf(source.type).runs)
    const texts = [node.prompt, ...feeding.map(source => source.prompt)].filter(Boolean)
    if (!texts.length) continue
    for (const asset of assets) {
      if (asset.id === node.id) continue
      const name = nodeName(asset, typeOf(asset.type))
      if (!texts.some(text => mentions(text, name))) continue
      for (const out of typeOf(asset.type).outputs) {
        if (out.mention === false) continue
        const port = out.kind === 'text' ? { id: textHandle }
          : type.inputs.find(item => item.kind === out.kind && item.mark && item.multiple) ?? type.inputs.find(item => item.kind === out.kind && item.mark)
        if (!port) continue
        if (doc.edges.some(edge => edge.source === asset.id && edge.sourceHandle === out.id && edge.target === node.id)) continue
        result.push({ id: `implicit:${asset.id}:${out.id}:${node.id}`, source: asset.id, sourceHandle: out.id, target: node.id, targetHandle: port.id, implicit: true })
      }
    }
  }
  return result
}
