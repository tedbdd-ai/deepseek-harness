/**
 * Hand-off from a storyboard to its film: the chosen scenes go, in strip order, into the film document made from that
 * storyboard (created the first time, `source` = the storyboard). Each scene comes with its text, framing, length and
 * its storyboard picture as start image, and gets a Video node and a place in the cut. Handing off again updates the
 * same scenes in place (their videos and lines stay) and adds new ones; nothing runs.
 */
import { randomUUID } from 'node:crypto'
import { InputError } from '../../../store.mjs'
import { createDoc, docKey, getDoc, listDocs, touchDoc } from './documents.mjs'

const row = 760
const column = 352

/**
 * @param {{ store: object, engine: object, isPicture: (node: object) => boolean, video: (seconds: number) => object }} env
 *   `isPicture` tells the storyboard's picture nodes (run nodes with only picture outputs); `video` gives the params of
 *   a new Video node for a clip of that length.
 * @param {string[]} sceneIds the scenes to hand off, in the order of the film strip.
 * @returns {{ doc: object, added: number, updated: number }}
 */
export function handOff({ store, engine, isPicture, video }, projectId, storyboardId, sceneIds) {
  const board = getDoc(store, projectId, storyboardId)
  if (board.kind !== 'storyboard') throw new InputError('Nur ein Storyboard gibt Szenen an einen Film weiter.')
  const canvas = store.appData(projectId, docKey(storyboardId)).data
  const nodes = canvas.nodes ?? []
  const edges = canvas.edges ?? []
  const scenes = sceneIds.map(id => nodes.find(node => node.id === id && node.type === 'scene'))
  if (!scenes.length || scenes.some(scene => !scene)) throw new InputError('Wähle Szenen aus dem Storyboard.')
  const view = engine.view(projectId, storyboardId)
  // The storyboard picture: the first result of a picture node the scene feeds, otherwise the scene's own start image.
  const pictureOf = scene => {
    for (const edge of edges.filter(item => item.source === scene.id)) {
      const target = nodes.find(node => node.id === edge.target)
      if (target && isPicture(target)) { const image = view[target.id]?.outputs?.image?.[0]; if (image) return image }
    }
    return scene.params?.assetIds?.[0] ?? null
  }
  const film = listDocs(store, projectId).find(doc => doc.kind === 'film' && doc.source === storyboardId)
    ?? createDoc(store, projectId, { kind: 'film', title: 'Film · ' + board.title, source: storyboardId })
  const record = store.appData(projectId, docKey(film.id))
  let filmNodes = [...(record.data.nodes ?? [])]
  const filmEdges = [...(record.data.edges ?? [])]
  let cut = filmNodes.find(node => node.type === 'composition')
  if (!cut) {
    cut = { id: randomUUID(), type: 'composition', name: 'Film', x: 2 * column + 160, y: 0, prompt: '', params: {} }
    filmNodes.push(cut)
  }
  const clipOf = scene => filmNodes.find(node => node.type === 'video' && filmEdges.some(edge => edge.source === scene.id && edge.target === node.id))
  let added = 0, updated = 0
  const handed = scenes.map(scene => {
    const key = `${storyboardId}:${scene.id}`
    const picture = pictureOf(scene)
    const fields = { name: scene.name, prompt: scene.prompt ?? '', params: { duration: scene.params?.duration ?? '5', ...(scene.params?.shot && { shot: scene.params.shot }), assetIds: picture ? [picture] : [], source: key } }
    const old = filmNodes.find(node => node.type === 'scene' && node.params?.source === key)
    if (old) {
      updated++
      filmNodes = filmNodes.map(node => (node.id === old.id ? { ...node, ...fields, params: { ...node.params, ...fields.params } } : node))
      return old.id
    }
    added++
    const id = randomUUID()
    const clip = { id: randomUUID(), type: 'video', name: 'Video ' + (scene.name || 'Szene'), x: 0, y: 0, prompt: '', params: video(Number(scene.params?.duration) || 5) }
    filmNodes.push({ id, type: 'scene', x: 0, y: 0, ...fields }, clip)
    filmEdges.push(
      { id: randomUUID(), source: id, sourceHandle: 'text', target: clip.id, targetHandle: 'prompt' },
      { id: randomUUID(), source: id, sourceHandle: 'image', target: clip.id, targetHandle: 'start' },
      { id: randomUUID(), source: clip.id, sourceHandle: 'video', target: cut.id, targetHandle: 'clips' },
    )
    return id
  })
  // Rows follow the strip: the handed scenes first in their order, then the film's other scenes. The cut reads its
  // clips in that reading order.
  const others = filmNodes.filter(node => node.type === 'scene' && !handed.includes(node.id)).sort((a, b) => a.y - b.y).map(node => node.id)
  const place = new Map()
  ;[...handed, ...others].forEach((id, i) => {
    place.set(id, { x: 0, y: i * row })
    const clip = clipOf({ id })
    if (clip) place.set(clip.id, { x: column, y: i * row })
  })
  filmNodes = filmNodes.map(node => (place.has(node.id) ? { ...node, ...place.get(node.id) } : node))
  store.setAppData(projectId, docKey(film.id), { revision: record.revision, data: { nodes: filmNodes, edges: filmEdges } })
  touchDoc(store, projectId, film.id)
  return { doc: listDocs(store, projectId).find(doc => doc.id === film.id), added, updated }
}
