/**
 * Schnitt: cut a project's clips (trim, split, order), add music and sound, export to the Library.
 *
 * - `GET  /creativity-schnitt/api/status` → `{ ffmpeg: boolean }`
 * - `POST /creativity-schnitt/api/export { projectId }` → `{ id, seconds }`: renders the saved cut with ffmpeg.
 * The cut itself lives in `app_data(schnitt)` of the project: `{ clips: [{ id, assetId, in, out, volume }], audio: [{ id, assetId, start, volume }] }`.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readBody, responder } from '../../http.mjs'
import { InputError } from '../../store.mjs'
import { defineApp } from '../define-app.mjs'
import { exportCut } from './export.mjs'

const run = promisify(execFile)
const app = defineApp({
  id: 'schnitt', title: 'Schnitt', page: true,
  description: 'Clips eines Projekts schneiden, Musik und Ton legen und exportieren',
  icon: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
}, import.meta.url)

export const name = app.name
export const inject = [...app.inject, 'creativeStore']

export function apply(ctx) {
  app.apply(ctx)
  const store = ctx.creativeStore
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/creativity-schnitt',
    auth: 'required',
    handler: async (req, res) => {
      const { json } = responder(req, res)
      try {
        const path = new URL(req.url, 'http://localhost').pathname
        if (req.method === 'GET' && path === '/creativity-schnitt/api/status') {
          return json({ ffmpeg: await run('ffmpeg', ['-version'], { timeout: 5000 }).then(() => true, () => false) })
        }
        if (req.method === 'POST' && path === '/creativity-schnitt/api/export') {
          if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new InputError('Schreibzugriff aus dieser Quelle ist gesperrt.', 403)
          const { projectId } = await readBody(req)
          if (typeof projectId !== 'string') throw new InputError('Projekt erforderlich.')
          return json(await exportCut(store, projectId, store.appData(projectId, 'schnitt').data), 201)
        }
        throw new InputError('Seite nicht gefunden.', 404)
      } catch (error) {
        if (error instanceof InputError) return json({ error: error.message }, error.status)
        console.error('Schnitt:', error)
        return json({ error: 'Der Schnitt konnte die Anfrage nicht abschließen.' }, 500)
      }
    },
  }))
}
