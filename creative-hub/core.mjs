/**
 * Creativity core: owns the shared SQLite store and the app registry.
 *
 * Provides `creativeStore` (the store returned by `openStore`), `creativeApps` and
 * `creativeProviders` (media providers, see providers.mjs) and `creativeNodes` (node types of the Flows canvas).
 * App plugins inject `creativeApps` and call `register()`, which returns a disposer;
 * the hub lists registered apps and loads each app's browser module into an idea.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createProviderRegistry } from './providers.mjs'
import { defaultSnapshots } from './snapshots.mjs'
import { idPattern, openStore } from './store.mjs'

export const name = 'creativity-core'

/**
 * Creates the app registry.
 * @param {typeof defaultSnapshots} snapshots templates for new ideas.
 * @returns {{
 *   register(app: { id: string, title: string, icon: string, module: string, description?: string, page?: boolean, view?: boolean }): () => void,
 *   `page` lists the app in the sidebar; with `view` its module exports `renderView(shared)` and draws the whole view,
 *   otherwise `render(container, context)` below the page title.
 *   apps(): object[], snapshots(): object[], snapshot(id: string): object | undefined
 * }}
 *   `icon` is an SVG path for a 24×24 stroke icon; `module` is the same-origin URL of an
 *   ES module exporting `render(container, context)`.
 */
export function createAppRegistry(snapshots) {
  for (const snapshot of snapshots) {
    if (!idPattern.test(snapshot.id) || !snapshot.apps.every(id => idPattern.test(id))) throw new Error(`Ungültiger Snapshot "${snapshot.id}".`)
  }
  const apps = new Map()
  return {
    register(app) {
      if (!idPattern.test(app.id)) throw new Error(`Ungültige App-ID "${app.id}".`)
      if (!app.module.startsWith('/')) throw new Error(`App "${app.id}" braucht ein Modul unter einem lokalen Pfad.`)
      if (apps.has(app.id)) throw new Error(`App "${app.id}" ist bereits registriert.`)
      const entry = { id: app.id, title: app.title, icon: app.icon, module: app.module, description: app.description ?? '', ...(app.page && { page: true }), ...(app.view && { view: true }) }
      apps.set(app.id, entry)
      return () => { if (apps.get(app.id) === entry) apps.delete(app.id) }
    },
    apps: () => [...apps.values()].sort((a, b) => a.title.localeCompare(b.title, 'de')),
    snapshots: () => snapshots,
    snapshot: id => snapshots.find(snapshot => snapshot.id === id),
  }
}

const portKinds = ['text', 'image', 'video', 'audio']
const portId = /^[a-z][a-zA-Z0-9]{0,31}$/

/**
 * Creates the registry of Flows node types. A plugin that produces or supplies media registers its node type here;
 * the Flows canvas lists them and its engine calls them.
 *
 * A node type is `{ type, title, group, icon, inputs, outputs, paid?, prompt?, description?, fields?, resolve? | run? }`:
 * - `inputs`/`outputs`: `{ id, kind: 'text'|'image'|'video'|'audio', label, multiple?, required?, mark? }[]`. Values on a port
 *   are strings for `text` and Library asset ids for media. An input with `mark` (e.g. `Bild`) numbers its values per mark
 *   (`@Bild1` …); before `run` the engine replaces `@Name` mentions of connected nodes in the prompt and incoming text with these marks.
 * - `check({ inputs, params })` (optional, synchronous) returns warnings shown on the node before it runs; it must not
 *   call providers.
 * - `contains: true` (frames): `resolve` also receives `members`, the values of the nodes lying inside, by kind.
 * - `fields()`: async list of settings `{ key, label, type: 'enum'|'boolean'|'longtext'|'assets'|'color'|'url', options?, default?, model?, empty? }`;
 *   enum options may be `{ value, label, tags? }` (tags become quick filters), `empty` is the hint shown when there are no options.
 *   A field with `model` belongs to that model and is stored at `params.settings[model][key]`; it shows only while
 *   `params.modelId` is that model.
 * - `resolve({ params, prompt, projectId })` returns `{ [outputId]: values }` at once (source nodes, free).
 * - `run({ inputs, params, prompt, projectId, stopped })` returns `Promise<{ outputs, credits? }>`; it may call paid providers
 *   and is started only by an explicit user action. `stopped()` turns true when the Flows plugin is unloaded.
 * @returns {{ register(node: object): () => void, nodes(): object[], node(type: string): object | undefined }}
 */
export function createNodeRegistry() {
  const nodes = new Map()
  const checkPorts = (node, list) => {
    if (!Array.isArray(list) || list.some(port => !portId.test(port.id) || !portKinds.includes(port.kind) || typeof port.label !== 'string' ||
      (port.mark !== undefined && !/^[A-Za-zÄÖÜäöü]{1,16}$/.test(port.mark)))) {
      throw new Error(`Knotenart "${node.type}" hat ungültige Ports.`)
    }
  }
  return {
    register(node) {
      if (!idPattern.test(node.type)) throw new Error(`Ungültige Knotenart "${node.type}".`)
      if (nodes.has(node.type)) throw new Error(`Knotenart "${node.type}" ist bereits registriert.`)
      if (typeof node.run === typeof node.resolve) throw new Error(`Knotenart "${node.type}" braucht genau eines von run und resolve.`)
      checkPorts(node, node.inputs)
      checkPorts(node, node.outputs)
      nodes.set(node.type, node)
      return () => { if (nodes.get(node.type) === node) nodes.delete(node.type) }
    },
    nodes: () => [...nodes.values()],
    node: type => nodes.get(type),
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ databasePath?: string, snapshots?: typeof defaultSnapshots }} config
 *   `databasePath` defaults to `~/.creativity-hub/hub.sqlite`; `snapshots` replaces the default templates.
 */
export function apply(ctx, config = {}) {
  const registry = createAppRegistry(config.snapshots ?? defaultSnapshots)
  const store = openStore(config.databasePath ?? join(homedir(), process.env.ATELIER_INSTANCE === 'nsfw' ? '.creativity-hub-nsfw' : '.creativity-hub', 'hub.sqlite'))
  ctx.effect(() => () => store.close())
  ctx.provide('creativeStore', store)
  ctx.provide('creativeApps', registry)
  ctx.provide('creativeNodes', createNodeRegistry())
  // The credential store is optional: compositions without it fall back to environment variables.
  ctx.provide('creativeProviders', createProviderRegistry(store, () => ctx.get('credentials')))
}
