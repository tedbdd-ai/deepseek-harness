import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function httpUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) return ''
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const formats = {
  'image/png': bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': bytes => bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
  'image/webp': bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': bytes => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
  'video/mp4': bytes => bytes.toString('ascii', 4, 8) === 'ftyp',
  'video/webm': bytes => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')),
}

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      scene TEXT NOT NULL DEFAULT '{"elements":[],"files":{}}', revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, library TEXT NOT NULL CHECK (library IN ('clips', 'generation')),
      title TEXT NOT NULL, source TEXT NOT NULL, preview TEXT NOT NULL, description TEXT NOT NULL,
      created_at TEXT NOT NULL, media_type TEXT, media BLOB
    );
    CREATE TABLE IF NOT EXISTS project_assets (
      project_id TEXT NOT NULL REFERENCES projects(id),
      asset_id TEXT NOT NULL REFERENCES assets(id), PRIMARY KEY (project_id, asset_id)
    );
  `)
  const project = id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  return {
    close: () => db.close(),
    projects: () => db.prepare('SELECT id, title, notes, revision FROM projects ORDER BY title COLLATE NOCASE').all(),
    project(id) {
      const row = project(id)
      if (!row) throw new InputError('Projekt nicht gefunden.', 404)
      return { ...row, scene: JSON.parse(row.scene) }
    },
    createProject(body) {
      const title = text(body.title, 160)
      if (!title) throw new InputError('Gib einen Projektnamen ein.')
      const id = randomUUID()
      db.prepare('INSERT INTO projects (id, title, notes) VALUES (?, ?, ?)').run(id, title, text(body.notes, 24000))
      return this.project(id)
    },
    updateProject(id, body) {
      const current = this.project(id)
      if (body.revision !== current.revision) throw new InputError('Das Projekt wurde zwischenzeitlich geändert. Lade den aktuellen Stand.', 409)
      const notes = 'notes' in body ? text(body.notes, 24000) : current.notes
      const scene = 'scene' in body ? body.scene : current.scene
      if (!scene || !Array.isArray(scene.elements) || scene.elements.length > 5000 ||
        !scene.files || typeof scene.files !== 'object' || Array.isArray(scene.files)) throw new InputError('Ungültige Excalidraw-Szene.')
      const change = db.prepare('UPDATE projects SET notes = ?, scene = ?, revision = revision + 1 WHERE id = ? AND revision = ?')
        .run(notes, JSON.stringify(scene), id, current.revision)
      if (!change.changes) throw new InputError('Das Projekt wurde zwischenzeitlich geändert. Lade den aktuellen Stand.', 409)
      return this.project(id)
    },
    assets(library, query = '', projectId = '') {
      const terms = text(query, 300).toLocaleLowerCase().split(/\s+/).filter(Boolean)
      return db.prepare(`
        SELECT id, library, title, source, preview, description, created_at, media_type
        FROM assets WHERE (? = '' OR library = ?) AND
        (? = '' OR EXISTS (SELECT 1 FROM project_assets WHERE project_id = ? AND asset_id = assets.id))
        ORDER BY created_at DESC
      `).all(library, library, projectId, projectId).filter(item => {
        const searchable = [item.title, item.source, item.description].join(' ').toLocaleLowerCase()
        return terms.every(term => searchable.includes(term))
      })
    },
    createAsset(body) {
      const id = randomUUID()
      const title = text(body.title, 200)
      const source = httpUrl(body.source)
      const preview = httpUrl(body.preview)
      const description = text(body.description, 4000)
      const library = body.library
      if (!title) throw new InputError('Gib einen Titel ein.')
      if (library !== 'clips' && library !== 'generation') throw new InputError('Unbekannte Sammlung.')
      let mediaType = null
      let media = null
      if (library === 'generation' && body.media) {
        mediaType = body.mediaType
        media = typeof body.media === 'string' ? Buffer.from(body.media, 'base64') : Buffer.alloc(0)
        if (media.length > 12 * 1024 * 1024 || !Object.hasOwn(formats, mediaType) || !formats[mediaType](media)) {
          throw new InputError('Erlaubt sind PNG, JPEG, WebP, GIF, MP4 und WebM bis 12 MB.')
        }
      }
      if (library === 'clips' && !source) throw new InputError('Gib eine gültige Webseiten-URL ein.')
      if (library === 'generation' && !media && !source) throw new InputError('Wähle eine Datei oder gib eine URL ein.')
      const projectId = typeof body.projectId === 'string' ? body.projectId : ''
      if (projectId) this.project(projectId)
      db.exec('BEGIN')
      try {
        db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          id, library, title, source, preview, description, new Date().toISOString(), mediaType, media,
        )
        if (projectId) db.prepare('INSERT INTO project_assets VALUES (?, ?)').run(projectId, id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return { id }
    },
    media(id) {
      return db.prepare('SELECT media_type, media FROM assets WHERE id = ? AND media IS NOT NULL').get(id)
    },
    assign(id, projectId) {
      this.project(projectId)
      if (!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(id)) throw new InputError('Asset nicht gefunden.', 404)
      db.prepare('INSERT OR IGNORE INTO project_assets VALUES (?, ?)').run(projectId, id)
      return { id, projectId }
    },
  }
}
