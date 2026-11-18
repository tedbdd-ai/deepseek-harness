/**
 * Creativity core: owns the shared SQLite store and the app registry.
 *
 * Provides `creativeStore` (the store returned by `openStore`), `creativeApps` and
 * `creativeProviders` (media providers, see providers.mjs).
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
 *   register(app: { id: string, title: string, icon: string, module: string, description?: string }): () => void,
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
      const entry = { id: app.id, title: app.title, icon: app.icon, module: app.module, description: app.description ?? '' }
      apps.set(app.id, entry)
      return () => { if (apps.get(app.id) === entry) apps.delete(app.id) }
    },
    apps: () => [...apps.values()].sort((a, b) => a.title.localeCompare(b.title, 'de')),
    snapshots: () => snapshots,
    snapshot: id => snapshots.find(snapshot => snapshot.id === id),
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ databasePath?: string, snapshots?: typeof defaultSnapshots }} config
 *   `databasePath` defaults to `~/.creativity-hub/hub.sqlite`; `snapshots` replaces the default templates.
 */
export function apply(ctx, config = {}) {
  const registry = createAppRegistry(config.snapshots ?? defaultSnapshots)
  const store = openStore(config.databasePath ?? join(homedir(), '.creativity-hub', 'hub.sqlite'))
  ctx.effect(() => () => store.close())
  ctx.provide('creativeStore', store)
  ctx.provide('creativeApps', registry)
  // The credential store is optional: compositions without it fall back to environment variables.
  ctx.provide('creativeProviders', createProviderRegistry(store, () => ctx.get('credentials')))
}
