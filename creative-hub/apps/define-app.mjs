/**
 * Builds the Cordis plugin of one hub app. The app's browser module is the file
 * `block.js` beside its `host.mjs`; it is served at `/creativity-apps/<id>/block.js`
 * and must export `render(container, context)` (see apps/README.md).
 */
import { readFile } from 'node:fs/promises'
import { responder } from '../http.mjs'

/**
 * @param {{ id: string, title: string, icon: string, description?: string }} app
 * @param {string} hostUrl `import.meta.url` of the app's `host.mjs`.
 * @returns {{ name: string, inject: string[], apply(ctx: any): void }}
 */
export function defineApp(app, hostUrl) {
  const module = `/creativity-apps/${app.id}/block.js`
  return {
    name: 'creativity-app-' + app.id,
    inject: ['webServer', 'creativeApps'],
    apply(ctx) {
      ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: `/creativity-apps/${app.id}`,
        auth: 'required',
        handler: async (req, res) => {
          const { send, json } = responder(req, res)
          if ((req.method === 'GET' || req.method === 'HEAD') && new URL(req.url, 'http://localhost').pathname === module) {
            return send(200, 'text/javascript; charset=utf-8', await readFile(new URL('./block.js', hostUrl)))
          }
          json({ error: 'Seite nicht gefunden.' }, 404)
        },
      }))
      ctx.effect(() => ctx.creativeApps.register({ ...app, module }))
    },
  }
}
