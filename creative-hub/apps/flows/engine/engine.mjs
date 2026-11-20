/**
 * Flow engine: resolves the values on each port of a project's flow and runs node types from `creativeNodes`.
 *
 * The flow document (`app_data(flow)`: `{ nodes: [{ id, type, x, y, prompt, params }], edges: [{ id, source, sourceHandle,
 * target, targetHandle }] }`) is written by the editor. The run state lives apart in the setting `flows:state:<projectId>`
 * (`{ [nodeId]: { status, outputs, key, error, credits, ms, history } }`), so editor saves and finished jobs never collide.
 * Runs start only from `run()`, which callers expose behind an explicit user action.
 */
import { createHash } from 'node:crypto'
import { InputError } from '../../../store.mjs'
import { absolute, adoptIntoFrames } from './frames.mjs'

const keepHistory = 8
const kinds = ['text', 'image', 'video', 'audio']

/**
 * Orders nodes the way a person reads the canvas: along the axis on which they are spread wider
 * (left to right for a row of shots, top to bottom for a column), then along the other.
 */
export function readingOrder(nodes) {
  const spread = axis => Math.max(...nodes.map(node => node[axis])) - Math.min(...nodes.map(node => node[axis]))
  const [first, second] = nodes.length > 1 && spread('x') > spread('y') ? ['x', 'y'] : ['y', 'x']
  return [...nodes].sort((a, b) => (a[first] - b[first]) || (a[second] - b[second]))
}

/** Display name of a node: its own name or the title of its type. */
export const nodeName = (node, type) => String(node.name ?? '').trim() || type?.title || 'Knoten'

/**
 * Replaces `@Name` mentions of connected nodes with the reference marks the model understands (`@Bild1`, `@Image2` …).
 * @param {string} text prompt or incoming text.
 * @param {{ mark: string, name: string }[]} refs marks of the values on the node's inputs.
 * @param {string[]} names names of all nodes in the flow that carry media; mentioning one that is not connected fails.
 * @returns {string} the text with marks.
 */
export function resolveMentions(text, refs, names) {
  const all = [...new Set([...refs.map(ref => ref.name), ...names])].sort((a, b) => b.length - a.length)
  let result = text
  for (const name of all) {
    const pattern = new RegExp('@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu')
    if (!pattern.test(result)) continue
    const marks = refs.filter(ref => ref.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')).map(ref => ref.mark)
    if (!marks.length) throw new InputError(`„${name}“ ist nicht mit diesem Knoten verbunden. Verbinde den Knoten oder entferne @${name} aus dem Text.`)
    result = result.replace(pattern, marks.join(', '))
  }
  return result
}

/** Error text for the node card; unexpected errors are logged and replaced by a general sentence. */
function failureText(error) {
  if (error instanceof InputError || error?.name === 'ProviderError' || error?.status) return error.message
  console.error('Flows:', error)
  return 'Der Knoten konnte nicht ausgeführt werden.'
}

/**
 * @param {ReturnType<typeof import('../../../store.mjs').openStore>} store
 * @param {ReturnType<typeof import('../../../core.mjs').createNodeRegistry>} registry
 */
export function createEngine(store, registry) {
  // Node ids that run in this process; a stored `running` without an entry here was cut off by a restart.
  const active = new Map()
  let stopped = false
  const stateKey = projectId => 'flows:state:' + projectId
  const readState = projectId => store.settings(stateKey(projectId))
  const patch = (projectId, nodeId, change) => {
    if (stopped) return
    const state = readState(projectId)
    state[nodeId] = { ...state[nodeId], ...change(state[nodeId] ?? {}) }
    store.setSettings(stateKey(projectId), state)
  }

  function flow(projectId) {
    const data = store.appData(projectId, 'flow').data
    const doc = { nodes: Array.isArray(data.nodes) ? data.nodes : [], edges: Array.isArray(data.edges) ? data.edges : [] }
    // Flows saved before frames were sub-flows have no `parentId`; read them the same way the editor shows them.
    return adoptIntoFrames(doc, node => Boolean(registry.node(node.type)?.contains)).doc
  }

  function live(projectId, state, nodeId) {
    const entry = state[nodeId]
    if (entry?.status === 'running' || entry?.status === 'waiting') {
      if (!active.get(projectId)?.has(nodeId)) return { ...entry, status: 'failed', error: 'Unterbrochen, weil der Hub neu gestartet wurde. Ein Videoauftrag läuft beim Anbieter weiter und erscheint im Video Playground.' }
    }
    return entry
  }

  /** Values of the nodes inside a frame (its sub-flow children), by port kind and in reading order. */
  function membersOf(projectId, doc, state, frame) {
    const inside = doc.nodes.filter(node => node.parentId === frame.id)
    const members = Object.fromEntries(kinds.map(kind => [kind, []]))
    for (const node of readingOrder(inside)) {
      const type = registry.node(node.type)
      const outputs = type && outputsOf(projectId, doc, state, node)
      if (!outputs) continue
      for (const port of type.outputs) members[port.kind].push(...(outputs[port.id] ?? []))
    }
    return members
  }

  /** Outputs of one node: computed for source nodes, the last result for run nodes. */
  function outputsOf(projectId, doc, state, node) {
    const type = registry.node(node.type)
    if (!type) return null
    if (type.resolve) return type.resolve({ params: node.params ?? {}, prompt: node.prompt ?? '', projectId,
      ...(type.contains && { members: membersOf(projectId, doc, state, node) }) })
    const entry = live(projectId, state, node.id)
    return entry?.outputs ?? null
  }

  /**
   * Values arriving at each input of `node`. Several edges on one input are ordered by the source nodes' reading order.
   * Inputs with a `mark` number their values per mark (`@Bild1`, `@Bild2` …) in input order; `refs` lists them.
   * @returns {{ inputs: Record<string, string[]>, missing: string[], refs: { mark: string, nodeId: string, name: string, value: string }[] }}
   *   `missing` lists upstream nodes without a result.
   */
  function inputsOf(projectId, doc, state, node) {
    const byId = new Map(doc.nodes.map(item => [item.id, item]))
    const inputs = {}
    const missing = []
    const refs = []
    const counters = {}
    for (const port of registry.node(node.type)?.inputs ?? []) {
      const edges = doc.edges.filter(edge => edge.target === node.id && edge.targetHandle === port.id && byId.has(edge.source))
      const order = readingOrder(edges.map(edge => ({ id: edge.source, ...absolute(byId.get(edge.source), byId) }))).map(source => source.id)
      edges.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))
      const values = []
      for (const edge of edges) {
        const source = byId.get(edge.source)
        const outputs = outputsOf(projectId, doc, state, source)
        if (!outputs) { missing.push(edge.source); continue }
        for (const value of outputs[edge.sourceHandle] ?? []) values.push({ value, source })
      }
      const kept = port.multiple ? values : values.slice(-1)
      inputs[port.id] = kept.map(item => item.value)
      if (port.mark) {
        for (const item of kept) {
          counters[port.mark] = (counters[port.mark] ?? 0) + 1
          refs.push({ mark: '@' + port.mark + counters[port.mark], nodeId: item.source.id, name: nodeName(item.source, registry.node(item.source.type)), value: item.value })
        }
      }
    }
    return { inputs, missing, refs }
  }

  /** Names of all nodes that carry media, for checking `@` mentions. */
  function mediaNames(doc) {
    return doc.nodes.filter(node => registry.node(node.type)?.outputs.some(port => port.kind !== 'text'))
      .map(node => nodeName(node, registry.node(node.type)))
  }

  const keyOf = (node, inputs) => createHash('sha256').update(JSON.stringify([node.type, node.prompt ?? '', node.params ?? {}, inputs])).digest('hex').slice(0, 24)

  /** Upstream and downstream node ids, for planning and cycle checks. */
  function neighbours(doc) {
    const up = new Map(doc.nodes.map(node => [node.id, []]))
    const down = new Map(doc.nodes.map(node => [node.id, []]))
    for (const edge of doc.edges) {
      if (!up.has(edge.target) || !down.has(edge.source)) continue
      up.get(edge.target).push(edge.source)
      down.get(edge.source).push(edge.target)
    }
    return { up, down }
  }

  /** Orders `ids` so that every node comes after its upstream nodes; throws on a cycle. */
  function ordered(doc, ids) {
    const { up } = neighbours(doc)
    const result = []
    const seen = new Map()
    const visit = id => {
      if (seen.get(id) === 'done') return
      if (seen.get(id) === 'open') throw new InputError('Der Flow enthält einen Kreis. Entferne eine der Verbindungen im Kreis.')
      seen.set(id, 'open')
      for (const source of up.get(id) ?? []) visit(source)
      seen.set(id, 'done')
      if (ids.has(id)) result.push(id)
    }
    for (const id of ids) visit(id)
    return result
  }

  /**
   * Lists the run nodes that `run(projectId, nodeId, scope)` would start.
   * - `node`: only this node.
   * - `upstream`: run nodes before it that have no current result, then this node.
   * - `downstream`: this node and every run node after it; for a source node (Notiz, Datei …) the run nodes it feeds.
   */
  function plan(projectId, nodeId, scope) {
    const doc = flow(projectId)
    const state = readState(projectId)
    const node = doc.nodes.find(item => item.id === nodeId)
    if (!node) throw new InputError('Den Knoten gibt es im gespeicherten Flow nicht. Warte, bis „Gespeichert“ erscheint.', 404)
    // A source node has nothing to run itself; „Ab hier ausführen“ runs the nodes it feeds.
    const source = !registry.node(node.type)?.run
    if (source && scope !== 'downstream') throw new InputError('Dieser Knoten liefert seine Werte ohne Ausführen.')
    const { up, down } = neighbours(doc)
    const ids = new Set([nodeId])
    if (scope === 'downstream') {
      const walk = id => { for (const next of down.get(id) ?? []) if (!ids.has(next)) { ids.add(next); walk(next) } }
      walk(nodeId)
    } else if (scope === 'upstream') {
      const walk = id => {
        for (const prev of up.get(id) ?? []) {
          if (ids.has(prev)) continue
          const item = doc.nodes.find(n => n.id === prev)
          const type = registry.node(item.type)
          if (type?.run) {
            const entry = live(projectId, state, prev)
            const current = entry?.status === 'done' && entry.key === keyOf(item, inputsOf(projectId, doc, state, item).inputs)
            if (!current) ids.add(prev)
          }
          walk(prev)
        }
      }
      walk(nodeId)
    } else if (scope !== 'node') throw new InputError('Unbekannter Umfang für das Ausführen.')
    const steps = ordered(doc, ids).map(id => doc.nodes.find(n => n.id === id)).filter(item => registry.node(item.type)?.run)
      .map(item => ({ id: item.id, type: item.type, title: registry.node(item.type).title, paid: Boolean(registry.node(item.type).paid) }))
    if (source && !steps.length) throw new InputError('Mit diesem Knoten ist noch kein Knoten verbunden, der ausgeführt wird.')
    return steps
  }

  async function execute(projectId, nodeId, waitFor) {
    try { return await attempt(projectId, nodeId, waitFor) } finally { active.get(projectId)?.delete(nodeId) }
  }

  async function attempt(projectId, nodeId, waitFor) {
    const results = await Promise.all(waitFor)
    if (stopped) return false
    if (results.some(ok => !ok)) {
      patch(projectId, nodeId, () => ({ status: 'failed', error: 'Ein Schritt davor ist fehlgeschlagen. Er wurde nicht ausgeführt.' }))
      return false
    }
    const doc = flow(projectId)
    const node = doc.nodes.find(item => item.id === nodeId)
    const type = node && registry.node(node.type)
    if (!type) {
      patch(projectId, nodeId, () => ({ status: 'failed', error: 'Den Knoten oder seine Knotenart gibt es nicht mehr.' }))
      return false
    }
    const started = Date.now()
    try {
      const state = readState(projectId)
      const { inputs, missing, refs } = inputsOf(projectId, doc, state, node)
      if (missing.length) {
        const names = missing.map(id => registry.node(doc.nodes.find(n => n.id === id)?.type)?.title ?? 'Knoten')
        throw new InputError(`Führe zuerst ${[...new Set(names)].map(name => '„' + name + '“').join(', ')} aus.`)
      }
      for (const port of type.inputs) if (port.required && !inputs[port.id].length) throw new InputError(`Verbinde den Eingang „${port.label}“.`)
      const key = keyOf(node, inputs)
      // Mentions are resolved only on nodes that number references; elsewhere `@Name` stays text.
      let prompt = node.prompt ?? ''
      if (type.inputs.some(port => port.mark)) {
        const names = mediaNames(doc)
        prompt = resolveMentions(prompt, refs, names)
        for (const port of type.inputs) if (port.kind === 'text') inputs[port.id] = inputs[port.id].map(text => resolveMentions(text, refs, names))
      }
      patch(projectId, nodeId, () => ({ status: 'running', startedAt: new Date(started).toISOString(), error: undefined }))
      const result = await type.run({ inputs, params: node.params ?? {}, prompt, projectId, stopped: () => stopped })
      patch(projectId, nodeId, entry => {
        const done = { outputs: result.outputs, credits: result.credits ?? null, at: new Date().toISOString(), key }
        return { status: 'done', ...done, ms: Date.now() - started, error: undefined, history: [done, ...(entry.history ?? [])].slice(0, keepHistory) }
      })
      return true
    } catch (error) {
      patch(projectId, nodeId, () => ({ status: 'failed', error: failureText(error), ms: Date.now() - started }))
      return false
    }
  }

  return {
    /** Ends the plugin's lifetime: running node types see `stopped()` and results are no longer written. */
    stop() { stopped = true },
    plan,
    /**
     * Starts the planned nodes and returns at once; poll `view()` for progress.
     * @returns {{ id: string, title: string, paid: boolean }[]} the started nodes.
     */
    run(projectId, nodeId, scope = 'node') {
      if (stopped) throw new InputError('Das Atelier wird neu gestartet.', 503)
      const steps = plan(projectId, nodeId, scope)
      const running = active.get(projectId) ?? new Set()
      active.set(projectId, running)
      const busy = steps.find(step => running.has(step.id))
      if (busy) throw new InputError(`„${busy.title}“ läuft noch. Warte, bis der Knoten fertig ist.`, 409)
      const doc = flow(projectId)
      const { up } = neighbours(doc)
      const promises = new Map()
      for (const step of steps) {
        running.add(step.id)
        patch(projectId, step.id, () => ({ status: 'waiting', error: undefined }))
      }
      for (const step of steps) {
        const waitFor = []
        const collect = id => { for (const prev of up.get(id) ?? []) { if (promises.has(prev)) waitFor.push(promises.get(prev)); else collect(prev) } }
        collect(step.id)
        promises.set(step.id, execute(projectId, step.id, waitFor))
      }
      return steps
    },
    /**
     * Current state of every node: status, outputs (source nodes included), whether the result is stale and errors.
     * @returns {Record<string, { status: string, outputs: Record<string, string[]> | null, stale: boolean, error?: string, credits?: number | null, ms?: number, history?: object[] }>}
     */
    view(projectId) {
      const doc = flow(projectId)
      const state = readState(projectId)
      const nodes = {}
      for (const node of doc.nodes) {
        const type = registry.node(node.type)
        if (!type) { nodes[node.id] = { status: 'unknown', outputs: null, stale: false, error: 'Diese Knotenart ist gerade nicht geladen.' }; continue }
        try {
          if (type.resolve) { nodes[node.id] = { status: 'source', outputs: outputsOf(projectId, doc, state, node), stale: false }; continue }
          const entry = live(projectId, state, node.id) ?? { status: 'idle' }
          const { inputs, refs } = inputsOf(projectId, doc, state, node)
          const stale = entry.status === 'done' && entry.key !== keyOf(node, inputs)
          const warnings = type.check ? type.check({ inputs, params: node.params ?? {} }) : []
          nodes[node.id] = { status: entry.status, outputs: entry.outputs ?? null, stale, refs, warnings, error: entry.error, credits: entry.credits, ms: entry.ms, startedAt: entry.startedAt, history: entry.history ?? [] }
        } catch (error) {
          nodes[node.id] = { status: 'failed', outputs: null, stale: false, error: failureText(error) }
        }
      }
      return nodes
    },
    /** Makes an earlier result of a run node its current output again. */
    pick(projectId, nodeId, index) {
      const entry = readState(projectId)[nodeId]
      const chosen = entry?.history?.[index]
      if (!chosen) throw new InputError('Dieses Ergebnis ist nicht mehr im Verlauf.', 404)
      if (active.get(projectId)?.has(nodeId)) throw new InputError('Der Knoten läuft gerade.', 409)
      patch(projectId, nodeId, () => ({ outputs: chosen.outputs, credits: chosen.credits, at: chosen.at, key: chosen.key }))
      return this.view(projectId)
    },
  }
}
