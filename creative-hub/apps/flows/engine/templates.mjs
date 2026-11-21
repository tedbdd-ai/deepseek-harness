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

/**
 * Moodboard phase: a free container without lines (notes, colours, references from the Library), and beside it the
 * Style-DNA that condenses the frame into the project asset @Look. Outfits, places and figures are project assets too.
 */
function moodboard(x, y) {
  return {
    nodes: [
      frame('mood', '1 · Moodboard', x, y, 4 * W + 64, 880),
      note('notiz', 'Notizen', x + 32, y + 72, 'Analoger Film, sichtbares Korn, harte Schatten. Glänzendes Latex gegen kalte Klinikfliesen, einzelne Neonakzente. Ruhige, lange Einstellungen.'),
      color('rot', 'Akzent', x + 32, y + 432, '#B3122E'),
      color('kalt', 'Grundton', x + 32 + W, y + 432, '#5E7A82'),
      { ...files('outfits', 'Outfits', x + 32 + W, y + 72, 'Outfit', 4), asset: true },
      { ...files('orte', 'Orte', x + 32 + 2 * W, y + 72, 'Location', 4), asset: true },
      { ...files('figuren', 'Figuren', x + 32 + 3 * W, y + 72, 'Person', 4), asset: true },
      { key: 'look', type: 'style-dna', name: 'Look', asset: true, x: x + 4 * W + 160, y: y + 72, prompt: '' },
    ],
    edges: [link('mood', 'image', 'look', 'images'), link('mood', 'text', 'look', 'text')],
  }
}
/** Width the moodboard phase takes, Style-DNA included. */
const moodWidth = 5 * W + 160

/**
 * Storyboard phase: the story goes to Regie, which writes the shot list from it and @Look; „Szenen anlegen“ turns the
 * shots into the scenes beside it. The three scenes here are examples that Regie updates.
 */
function storyboard(x, y, mood = true) {
  const look = mood ? ' Halte dich an @Look.' : ''
  return {
    nodes: [
      frame('story', '2 · Storyboard', x, y, 5 * W + 64, 880),
      note('idee', 'Story', x + 32, y + 72, 'Eine Frau im schwarzen Latexmantel wacht in einer verlassenen Klinik auf. Sie folgt einem flackernden Neonlicht durch den Flur und spricht am Ende direkt in die Kamera.'),
      { key: 'regie', type: 'director', name: 'Regie', x: x + 32, y: y + 432,
        // Regie gets the names of all project assets (@Figur, @Set …) with its request; mentioning them here would make it
        // wait for the rendered sheet and set.
        prompt: 'Teile die Story in drei Einstellungen von 5 bis 10 Sekunden. Die Frau ist die Figur, der Ort das Set.' + look },
      scene('s1', 'Erwachen', x + 32 + W + 32, y + 72, 'Totale: @Figur liegt in @Set auf einer Metallliege und richtet sich langsam auf. Bewegung: Staub in der Luft, die Kamera steht.', 6),
      scene('s2', 'Flur', x + 32 + 2 * W + 32, y + 72, 'Halbnahe: @Figur geht durch @Set, ein Neonrohr flackert über ihr. Bewegung: Kamerafahrt rückwärts vor ihr her.', 8),
      scene('s3', 'Ansprache', x + 32 + 3 * W + 32, y + 72, 'Nahaufnahme: @Figur bleibt in @Set stehen, sieht in die Kamera und spricht. Bewegung: langsamer Zoom, Gegenlicht aus der offenen Tür.', 10),
    ].map(node => (node.type === 'scene' ? { ...node, params: { ...node.params, from: 'regie' } } : node)),
    edges: [link('idee', 'text', 'regie', 'prompt')],
  }
}

/** Character and set phase: a reference sheet and a set without people, both project assets (@Figur, @Set). */
function cast(x, y, mood = true) {
  return {
    nodes: [
      frame('cast', '3 · Figur und Set', x, y, 2 * W + 64, 880),
      { key: 'figur', type: 'character', name: 'Figur', asset: true, x: x + 32, y: y + 72,
        prompt: 'Frau Anfang 30, kantiges Gesicht, helle Haut mit feinen Sommersprossen, schwarzer Bob, kleine Narbe über der linken Augenbraue.' + (mood ? ' Outfit-Details aus @Outfits, Look aus @Look.' : ''),
        params: { outfit: 'Knielanger schwarzer Latexmantel mit hohem Kragen, schwarze Latexhandschuhe, kniehohe Lackstiefel. Rücken: durchgehender Reißverschluss.', head: 'cropped', mouth: true } },
      { key: 'set', type: 'set', name: 'Set', asset: true, x: x + 32 + W, y: y + 72,
        prompt: 'Verlassener Klinikflur mit weißen Fliesen, Metalltüren und einem flackernden Neonrohr.' + (mood ? ' Angelehnt an @Orte, Look aus @Look.' : ' Analoger Film, Korn.') },
    ],
    edges: [],
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

/** Shot phase: one video per scene; the scene text names @Figur and @Set, which arrive as image references. The third one speaks. */
function shots(x, y, { story = true, speaking = true } = {}) {
  const video = (key, name, dy, prompt, sceneKey, seconds) => ({ key, type: 'video', name, x: x + 32, y: y + dy, prompt,
    params: { modelId: 'seedance', settings: { seedance: { duration: String(seconds), resolution: '720p', aspect: '16:9', audio: true } } }, sceneKey })
  const list = [
    video('v1', 'Video Erwachen', 72, story ? '' : '@Figur liegt in @Set auf einer Metallliege und richtet sich langsam auf.', 's1', 6),
    video('v2', 'Video Flur', 72 + 760, story ? '' : '@Figur geht durch @Set, die Kamera fährt vor ihr rückwärts.', 's2', 8),
    video('v3', 'Video Ansprache', 72 + 1520, speaking ? '@Figur kommt in @Set zum Stehen, sieht in die Kamera und spricht den Text aus @Schwarzes Video. Die Zeitstempel oben geben vor, wann sie welches Wort sagt; vorher bewegt sie sich nur.' : '@Figur bleibt in @Set stehen und sieht in die Kamera.', 's3', speaking ? 15 : 10),
  ]
  return {
    nodes: [frame('dreh', '5 · Videos', x, y, W + 64, 2360), ...list],
    edges: [
      // Figur, Set and Look arrive through their @mentions; the line carries only the scene text.
      ...(story ? list.map(item => link(item.sceneKey, 'text', item.key, 'prompt')) : []),
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
    description: 'Der ganze Ablauf: Moodboard ohne Linien mit Style-DNA (@Look), Regie mit Shotliste und Szenen, Figur und Set als @Assets, Stimme mit Transkript, drei Videos und der Schnitt. Rahmen 1 bis 6 von links nach rechts.',
    build: () => {
      const at = [0, moodWidth + 160]
      for (const width of [5 * W + 64, 2 * W + 64, 3 * W + 64, W + 64]) at.push(at.at(-1) + width + 160)
      return merge(moodboard(at[0], 0), storyboard(at[1], 0), cast(at[2], 0), voice(at[3], 0), shots(at[4], 0), edit(at[5], 0))
    } },
  { id: 'look-und-story', title: 'Moodboard und Storyboard', phases: 2,
    description: 'Freies Moodboard mit Style-DNA (@Look), daneben Story, Regie mit Shotliste und die Szenen daraus.',
    build: () => merge(moodboard(0, 0), storyboard(moodWidth + 160, 0)) },
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
    params: { ...node.params, ...(node.type === 'library' && { assetIds: find ? pick(find, count) : [] }), ...(node.params?.from && { from: ids.get(node.params.from) }) },
  }))
  const placed = new Set(added.map(node => node.id))
  const newEdges = edges.map(edge => ({ id: randomUUID(), source: ids.get(edge.source), sourceHandle: edge.sourceHandle, target: ids.get(edge.target), targetHandle: edge.targetHandle }))
    .filter(edge => placed.has(edge.source) && placed.has(edge.target))
  const merged = adoptIntoFrames({ ...data, nodes: [...data.nodes, ...added], edges: [...data.edges, ...newEdges] }, node => node.type === 'frame').doc
  const record = store.setAppData(projectId, 'flow', { revision, data: merged })
  return { record, added: added.length, skipped }
}
