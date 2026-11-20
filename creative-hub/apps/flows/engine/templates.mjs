/**
 * Flow templates: ready canvases for a whole production or one phase of it. A template lists nodes with local keys
 * and edges between those keys; `insertTemplate` gives them fresh ids, places them right of the existing content and
 * fills Datei nodes from the Library (`find`: search words such as tags, the project's own files first).
 *
 * Templates only arrange nodes. Nothing runs on insertion; paid nodes still start only on a click.
 */
import { randomUUID } from 'node:crypto'
import { InputError } from '../../../store.mjs'
import { adoptIntoFrames } from './frames.mjs'

const W = 352 // column width of a node plus gap
const frame = (key, name, x, y, width, height) => ({ key, type: 'frame', name, x, y, params: { width, height } })
const note = (key, name, x, y, prompt) => ({ key, type: 'text', name, x, y, prompt })
const files = (key, name, x, y, find, count = 4) => ({ key, type: 'library', name, x, y, find, count })
const color = (key, name, x, y, value) => ({ key, type: 'color', name, x, y, params: { color: value } })
const scene = (key, name, x, y, prompt, duration) => ({ key, type: 'scene', name, x, y, prompt, params: { duration: String(duration) } })
const link = (source, sourceHandle, target, targetHandle) => ({ source, sourceHandle, target, targetHandle })

/** Moodboard phase: look, colours and references from the Library. */
function moodboard(x, y) {
  return {
    nodes: [
      frame('mood', '1 · Moodboard', x, y, 4 * W + 64, 880),
      note('look', 'Look', x + 32, y + 72, 'Analoger Film, sichtbares Korn, harte Schatten. Glänzendes Latex gegen kalte Klinikfliesen, einzelne Neonakzente. Ruhige, lange Einstellungen.'),
      color('rot', 'Akzent', x + 32, y + 432, '#B3122E'),
      color('kalt', 'Grundton', x + 32 + W, y + 432, '#5E7A82'),
      files('outfits', 'Outfits', x + 32 + W, y + 72, 'Outfit', 4),
      files('orte', 'Orte', x + 32 + 2 * W, y + 72, 'Location', 4),
      files('figuren', 'Figuren', x + 32 + 3 * W, y + 72, 'Person', 4),
    ],
    edges: [],
  }
}

/** Storyboard phase: story, a scene list written by the LLM from story and look, and three scenes. */
function storyboard(x, y, mood = true) {
  return {
    nodes: [
      frame('story', '2 · Storyboard', x, y, 4 * W + 64, 880),
      note('idee', 'Story', x + 32, y + 72, 'Eine Frau im schwarzen Latexmantel wacht in einer verlassenen Klinik auf. Sie folgt einem flackernden Neonlicht durch den Flur und spricht am Ende direkt in die Kamera.'),
      { key: 'szenenliste', type: 'llm', name: 'Szenenliste', x: x + 32, y: y + 432,
        prompt: 'Teile die Story in drei Einstellungen von je 5 bis 10 Sekunden. Nenne pro Einstellung Bildausschnitt, Bewegung und Licht in einem Satz. Halte dich an den Look.' },
      scene('s1', 'Erwachen', x + 32 + W, y + 72, 'Totale: Sie liegt auf einer Metallliege im Klinikraum und richtet sich langsam auf. Kaltes Licht, Staub in der Luft.', 6),
      scene('s2', 'Flur', x + 32 + 2 * W, y + 72, 'Halbnahe Kamerafahrt rückwärts: Sie geht den gefliesten Flur entlang, ein Neonrohr flackert über ihr.', 8),
      scene('s3', 'Ansprache', x + 32 + 3 * W, y + 72, 'Nahaufnahme: Sie bleibt stehen, sieht in die Kamera und spricht. Gegenlicht aus der offenen Tür.', 10),
    ],
    edges: [link('idee', 'text', 'szenenliste', 'prompt'), ...(mood ? [link('look', 'text', 'szenenliste', 'prompt'), link('mood', 'image', 'szenenliste', 'images')] : [])],
  }
}

/** Character and set phase: a reference sheet from the outfits and a set without people from the locations. */
function cast(x, y, mood = true) {
  return {
    nodes: [
      frame('cast', '3 · Figur und Set', x, y, 2 * W + 64, 880),
      { key: 'figur', type: 'character', name: 'Figur', x: x + 32, y: y + 72,
        prompt: mood ? 'Frau Anfang 30, kantiges Gesicht, helle Haut mit feinen Sommersprossen, schwarzer Bob, kleine Narbe über der linken Augenbraue. Outfit-Details aus @Outfits.' : 'Frau Anfang 30, kantiges Gesicht, helle Haut mit feinen Sommersprossen, schwarzer Bob, kleine Narbe über der linken Augenbraue.',
        params: { outfit: 'Knielanger schwarzer Latexmantel mit hohem Kragen, schwarze Latexhandschuhe, kniehohe Lackstiefel. Rücken: durchgehender Reißverschluss.', head: 'cropped', mouth: true } },
      { key: 'set', type: 'set', name: 'Set', x: x + 32 + W, y: y + 72,
        prompt: mood ? 'Verlassener Klinikflur mit weißen Fliesen, Metalltüren und einem flackernden Neonrohr, angelehnt an @Orte. Analoger Film, Korn.' : 'Verlassener Klinikflur mit weißen Fliesen, Metalltüren und einem flackernden Neonrohr. Analoger Film, Korn.' },
    ],
    edges: mood ? [link('outfits', 'image', 'figur', 'refs'), link('orte', 'image', 'set', 'refs')] : [],
  }
}

/** Voice phase (audio first): the voice clip, its black video for Seedance and a shifted centisecond transcript. */
function voice(x, y) {
  return {
    nodes: [
      frame('stimme', '4 · Stimme', x, y, 3 * W + 64, 880),
      files('ton', 'Stimme', x + 32, y + 72, null, 0),
      note('skript', 'Sprechtext', x + 32, y + 432, '[ruhig, heiser] Ich war schon einmal hier. [Pause] Und diesmal gehe ich nicht allein.'),
      { key: 'schwarz', type: 'black-video', name: 'Schwarzes Video', x: x + 32 + W, y: y + 72 },
      { key: 'transkript', type: 'llm', name: 'Transkript', x: x + 32 + 2 * W, y: y + 72,
        prompt: 'Transkribiere den Ton aus @Stimme mit Zeitstempeln auf Hundertstelsekunden. Addiere 3 Sekunden zu jedem Zeitstempel, damit die Figur erst nach ihrer Bewegung spricht. Gib nur die Zeilen „mm:ss.cc Text“ aus.' },
    ],
    edges: [link('ton', 'audio', 'schwarz', 'audio'), link('ton', 'audio', 'transkript', 'audio')],
  }
}

/** Shot phase: one video per scene with the sheet and the set as image references; the third one speaks. */
function shots(x, y, { story = true, speaking = true } = {}) {
  const video = (key, name, dy, prompt, sceneKey, seconds) => ({ key, type: 'video', name, x: x + 32, y: y + dy, prompt,
    params: { modelId: 'seedance', settings: { seedance: { duration: String(seconds), resolution: '720p', aspect: '16:9', audio: true } } }, sceneKey })
  const list = [
    video('v1', 'Video Erwachen', 72, '@Figur liegt in @Set auf einer Metallliege und richtet sich langsam auf.', 's1', 6),
    video('v2', 'Video Flur', 72 + 760, '@Figur geht durch @Set, die Kamera fährt vor ihr rückwärts.', 's2', 8),
    video('v3', 'Video Ansprache', 72 + 1520, speaking ? '@Figur kommt in @Set zum Stehen, sieht in die Kamera und spricht den Text aus @Schwarzes Video. Die Zeitstempel oben geben vor, wann sie welches Wort sagt; vorher bewegt sie sich nur.' : '@Figur bleibt in @Set stehen und sieht in die Kamera.', 's3', speaking ? 15 : 10),
  ]
  return {
    nodes: [frame('dreh', '5 · Videos', x, y, W + 64, 2360), ...list],
    edges: [
      ...list.flatMap(item => [link('figur', 'image', item.key, 'images'), link('set', 'image', item.key, 'images'), ...(story ? [link(item.sceneKey, 'text', item.key, 'prompt')] : [])]),
      ...(speaking ? [link('schwarz', 'video', 'v3', 'videos'), link('transkript', 'text', 'v3', 'prompt')] : []),
    ],
  }
}

/** Edit phase: the clips in order and the voice under the film. */
function edit(x, y) {
  return {
    nodes: [frame('schnitt', '6 · Schnitt', x, y, W + 64, 880), { key: 'film', type: 'composition', name: 'Film', x: x + 32, y: y + 72 }],
    edges: [link('v1', 'video', 'film', 'clips'), link('v2', 'video', 'film', 'clips'), link('v3', 'video', 'film', 'clips')],
  }
}

const merge = (...parts) => ({ nodes: parts.flatMap(part => part.nodes), edges: parts.flatMap(part => part.edges) })

/** All templates: id, title, description and a builder returning nodes and edges at the origin. */
export const templates = [
  { id: 'kurzfilm', title: 'Kurzfilm mit sprechender Figur', phases: 6,
    description: 'Der ganze Ablauf: Moodboard, Storyboard, Charakterblatt und Set, Stimme mit schwarzem Video und Transkript, drei Videos und der Schnitt. Rahmen 1 bis 6 von links nach rechts.',
    build: () => merge(moodboard(0, 0), storyboard(4 * W + 160, 0), cast(8 * W + 320, 0), voice(10 * W + 480, 0), shots(13 * W + 640, 0), edit(14 * W + 800, 0)) },
  { id: 'look-und-story', title: 'Moodboard und Storyboard', phases: 2,
    description: 'Look, Farben und Referenzen aus deiner Sammlung, daneben Story, Szenenliste vom LLM und drei Szenen.',
    build: () => merge(moodboard(0, 0), storyboard(4 * W + 160, 0)) },
  { id: 'figur-und-set', title: 'Figur und Set', phases: 1,
    description: 'Charakterblatt in vier Feldern auf Studiograu und ein Set ohne Personen, für gleichbleibende Figuren und Orte.',
    build: () => cast(0, 0, false) },
  { id: 'sprechende-figur', title: 'Sprechende Figur', phases: 3,
    description: 'Figur und Set, Stimme als schwarzes Video mit Transkript und ein Seedance-Video, in dem die Figur genau diesen Text spricht.',
    build: () => {
      const one = shots(3 * W + 64 + 160 + 3 * W + 64 + 160, 0, { story: false })
      one.nodes = one.nodes.filter(node => node.key === 'dreh' || node.key === 'v3')
      one.nodes[0].params.height = 880
      one.nodes[1].y = 72
      one.edges = one.edges.filter(edge => edge.target === 'v3')
      return merge(cast(0, 0, false), voice(2 * W + 64 + 160, 0), one)
    } },
  { id: 'bild-zu-video', title: 'Bild zu Video', phases: 0,
    description: 'Der kürzeste Weg: Notiz als Prompt, ein Bild, daraus ein Clip.',
    build: () => ({ nodes: [note('t', 'Prompt', 0, 160, ''), { key: 'b', type: 'image', x: 400, y: 80 }, { key: 'v', type: 'video', x: 880, y: 80 }],
      edges: [link('t', 'text', 'b', 'prompt'), link('b', 'image', 'v', 'start')] }) },
]

/**
 * Places a template in the project's flow, right of what is already there, and stores it.
 * @param {(type: string) => boolean} known whether a node type is registered; unknown types are left out with their edges.
 * @returns {{ record: { data: object, revision: number }, added: number, skipped: string[] }}
 */
export function insertTemplate(store, projectId, templateId, revision, known) {
  const template = templates.find(item => item.id === templateId)
  if (!template) throw new InputError('Diese Vorlage gibt es nicht.', 404)
  const current = store.appData(projectId, 'flow')
  if (current.revision !== revision) throw new InputError('Der Flow wurde inzwischen geändert. Lade die Seite neu und versuche es erneut.', 409)
  const data = { nodes: [], edges: [], ...current.data }
  const { nodes, edges } = template.build()
  const skipped = [...new Set(nodes.filter(node => !known(node.type)).map(node => node.type))]
  // Top-level nodes carry canvas positions; children of frames lie within their frame.
  const outer = data.nodes.filter(node => !node.parentId)
  const right = outer.length ? Math.max(...outer.map(node => node.x + (node.params?.width ?? 320))) + 320 : 0
  const top = outer.length ? Math.min(...outer.map(node => node.y)) : 0
  const ids = new Map(nodes.map(node => [node.key, randomUUID()]))
  const used = new Set()
  // Files for the moodboard: the project's own first, then the whole Library, each file only once per template.
  const pick = (words, count) => {
    const found = []
    for (const scope of [{ project: projectId }, {}]) {
      for (const item of store.search({ q: words, ...scope, limit: 40 }).items) {
        if (found.length >= count) break
        if (!used.has(item.id) && /^image\//.test(item.media_type ?? '')) { used.add(item.id); found.push(item.id) }
      }
    }
    return found
  }
  const added = nodes.filter(node => known(node.type)).map(({ key, find, count, sceneKey, ...node }) => ({
    ...node, id: ids.get(key), x: Math.round(node.x + right), y: Math.round(node.y + top), prompt: node.prompt ?? '',
    params: { ...node.params, ...(node.type === 'library' && { assetIds: find ? pick(find, count) : [] }) },
  }))
  const placed = new Set(added.map(node => node.id))
  const newEdges = edges.map(edge => ({ id: randomUUID(), source: ids.get(edge.source), sourceHandle: edge.sourceHandle, target: ids.get(edge.target), targetHandle: edge.targetHandle }))
    .filter(edge => placed.has(edge.source) && placed.has(edge.target))
  const merged = adoptIntoFrames({ ...data, nodes: [...data.nodes, ...added], edges: [...data.edges, ...newEdges] }, node => node.type === 'frame').doc
  const record = store.setAppData(projectId, 'flow', { revision, data: merged })
  return { record, added: added.length, skipped }
}
