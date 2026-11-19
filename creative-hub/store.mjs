/**
 * SQLite store of the Creativity Hub: ideas (table `projects`), their per-app data,
 * clips and generations (table `assets`) and the idea–asset assignment.
 *
 * Several processes may open the same file (Harness and the MCP server); the
 * database runs in WAL mode and every write is guarded by a revision check.
 */
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

/** App and snapshot ids: lower case letters, digits and `-`, at most 40 characters. */
export const idPattern = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Kanban columns of an idea, in board order. */
export const statuses = ['idee', 'arbeit', 'review', 'fertig']
const dayPattern = /^\d{4}-\d{2}-\d{2}$/
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const maxAppData = 1024 * 1024
const formats = {
  'image/png': bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': bytes => bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
  'image/webp': bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': bytes => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
  'video/mp4': bytes => bytes.toString('ascii', 4, 8) === 'ftyp',
  'model/gltf-binary': bytes => bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'glTF' &&
    bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length,
  'video/webm': bytes => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')),
}

export const mediaLimit = mediaType => (mediaType === 'model/gltf-binary' || mediaType?.startsWith('video/') ? 80 : 12) * 1024 * 1024

/** @returns the hub media type of `bytes` by file signature, or `undefined`. */
export function mediaTypeOf(bytes) {
  return Object.keys(formats).find(type => formats[type](bytes))
}

function appList(value) {
  if (!Array.isArray(value) || value.length > 40 || !value.every(id => typeof id === 'string' && idPattern.test(id))) {
    throw new InputError('Apps müssen eine Liste gültiger App-IDs sein.')
  }
  return [...new Set(value)]
}

function migrate(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(projects)').all().map(column => column.name))
  const added = {
    snapshot: "TEXT NOT NULL DEFAULT 'blank'",
    apps: "TEXT NOT NULL DEFAULT '[]'",
    pinned: 'INTEGER NOT NULL DEFAULT 0',
    updated_at: "TEXT NOT NULL DEFAULT ''",
    status: "TEXT NOT NULL DEFAULT 'idee'",
    due: "TEXT NOT NULL DEFAULT ''",
  }
  for (const [name, type] of Object.entries(added)) if (!columns.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${type}`)
}

/**
 * Opens (and creates or migrates) the store.
 * @param {string} filename SQLite path or `:memory:`.
 */
export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
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
    CREATE TABLE IF NOT EXISTS settings (namespace TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journal (day TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_data (
      project_id TEXT NOT NULL REFERENCES projects(id), app_id TEXT NOT NULL,
      data TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (project_id, app_id)
    );
  `)
  migrate(db)
  const row = id => db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  const summary = item => ({ ...item, apps: JSON.parse(item.apps), pinned: Boolean(item.pinned) })
  const conflict = () => new InputError('Die Idee wurde zwischenzeitlich geändert. Lade den aktuellen Stand.', 409)
  return {
    close: () => db.close(),
    /** @returns idea summaries, pinned first, then most recently changed. */
    projects: () => db.prepare(`
      SELECT id, title, notes, revision, snapshot, apps, pinned, updated_at, status, due,
        (SELECT count(*) FROM project_assets WHERE project_id = projects.id) AS asset_count
      FROM projects ORDER BY pinned DESC, updated_at DESC, title COLLATE NOCASE
    `).all().map(summary),
    project(id) {
      const item = row(id)
      if (!item) throw new InputError('Idee nicht gefunden.', 404)
      return { ...summary(item), scene: JSON.parse(item.scene) }
    },
    /**
     * @param {{ title: string, notes?: string, snapshot?: string, apps?: string[] }} body
     *   `snapshot` names the template the caller resolved `apps` from.
     */
    createProject(body) {
      const title = text(body.title, 160)
      if (!title) throw new InputError('Gib einen Titel ein.')
      const snapshot = body.snapshot ?? 'blank'
      if (typeof snapshot !== 'string' || !idPattern.test(snapshot)) throw new InputError('Ungültiger Snapshot.')
      const apps = appList(body.apps ?? [])
      const id = randomUUID()
      db.prepare('INSERT INTO projects (id, title, notes, snapshot, apps, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, title, text(body.notes, 24000), snapshot, JSON.stringify(apps), new Date().toISOString())
      return this.project(id)
    },
    /**
     * Changes title, notes, scene, apps, pinned, status (one of `statuses`) or due (`YYYY-MM-DD` or ''). `body.revision` must match the stored revision.
     * @throws {InputError} 409 when the revision is stale.
     */
    updateProject(id, body) {
      const current = this.project(id)
      if (body.revision !== current.revision) throw conflict()
      const title = 'title' in body ? text(body.title, 160) : current.title
      if (!title) throw new InputError('Gib einen Titel ein.')
      const notes = 'notes' in body ? text(body.notes, 24000) : current.notes
      const scene = 'scene' in body ? body.scene : current.scene
      if (!scene || !Array.isArray(scene.elements) || scene.elements.length > 5000 ||
        !scene.files || typeof scene.files !== 'object' || Array.isArray(scene.files)) throw new InputError('Ungültige Excalidraw-Szene.')
      const apps = 'apps' in body ? appList(body.apps) : current.apps
      if ('pinned' in body && typeof body.pinned !== 'boolean') throw new InputError('pinned muss true oder false sein.')
      const pinned = 'pinned' in body ? body.pinned : current.pinned
      const status = 'status' in body ? body.status : current.status
      if (!statuses.includes(status)) throw new InputError('Unbekannter Status.')
      const due = 'due' in body ? body.due : current.due
      if (due !== '' && !(typeof due === 'string' && dayPattern.test(due))) throw new InputError('Termin muss JJJJ-MM-TT oder leer sein.')
      const change = db.prepare(`
        UPDATE projects SET title = ?, notes = ?, scene = ?, apps = ?, pinned = ?, status = ?, due = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ?
      `).run(title, notes, JSON.stringify(scene), JSON.stringify(apps), pinned ? 1 : 0, status, due, new Date().toISOString(), id, current.revision)
      if (!change.changes) throw conflict()
      return this.project(id)
    },
    /** @returns {{ data: object, revision: number }} the app's data for one idea; `{}` at revision 0 when unset. */
    appData(projectId, appId) {
      this.project(projectId)
      if (!idPattern.test(appId)) throw new InputError('Ungültige App-ID.')
      const item = db.prepare('SELECT data, revision FROM app_data WHERE project_id = ? AND app_id = ?').get(projectId, appId)
      return item ? { data: JSON.parse(item.data), revision: item.revision } : { data: {}, revision: 0 }
    },
    /**
     * Replaces the app's data for one idea. `body.revision` must match `appData().revision`.
     * @param {{ revision: number, data: object }} body JSON object of at most 1 MB.
     */
    setAppData(projectId, appId, body) {
      const current = this.appData(projectId, appId)
      if (body.revision !== current.revision) throw conflict()
      if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new InputError('App-Daten müssen ein JSON-Objekt sein.')
      const data = JSON.stringify(body.data)
      if (data.length > maxAppData) throw new InputError('App-Daten sind größer als 1 MB.', 413)
      const change = current.revision === 0
        ? db.prepare('INSERT OR IGNORE INTO app_data VALUES (?, ?, ?, 1)').run(projectId, appId, data)
        : db.prepare('UPDATE app_data SET data = ?, revision = revision + 1 WHERE project_id = ? AND app_id = ? AND revision = ?')
          .run(data, projectId, appId, current.revision)
      if (!change.changes) throw conflict()
      return this.appData(projectId, appId)
    },
    /** @returns the plain (non-secret) settings object stored under `namespace`, `{}` when unset. */
    settings(namespace) {
      const item = db.prepare('SELECT data FROM settings WHERE namespace = ?').get(namespace)
      return item ? JSON.parse(item.data) : {}
    },
    setSettings(namespace, data) {
      db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT (namespace) DO UPDATE SET data = excluded.data').run(namespace, JSON.stringify(data))
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
    /** Saves a clip (web link or text note) or a generation (file or media link). */
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
      if (body.media) {
        mediaType = body.mediaType
        media = typeof body.media === 'string' ? Buffer.from(body.media, 'base64') : Buffer.alloc(0)
        if (!Object.hasOwn(formats, mediaType) || media.length > mediaLimit(mediaType) || !formats[mediaType](media)) {
          throw new InputError('Erlaubt sind PNG, JPEG, WebP und GIF bis 12 MB sowie MP4, WebM und GLB bis 80 MB.')
        }
      }
      if (library === 'clips' && !source && !description && !media) throw new InputError('Gib eine gültige URL, einen Notiztext oder eine Datei an.')
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
    /** @returns one asset without its media bytes. */
    asset(id) {
      const item = db.prepare('SELECT id, library, title, source, preview, description, created_at, media_type FROM assets WHERE id = ?').get(id)
      if (!item) throw new InputError('Asset nicht gefunden.', 404)
      return item
    },
    media(id) {
      return db.prepare('SELECT media_type, media FROM assets WHERE id = ? AND media IS NOT NULL').get(id)
    },
    /** Deletes an asset with its media and removes it from every idea. */
    deleteAsset(id) {
      this.asset(id)
      db.exec('BEGIN')
      try {
        db.prepare('DELETE FROM project_assets WHERE asset_id = ?').run(id)
        db.prepare('DELETE FROM assets WHERE id = ?').run(id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return { id }
    },
    /** @returns journal entries, newest day first. */
    journal: () => db.prepare('SELECT day, text, updated_at FROM journal ORDER BY day DESC LIMIT 400').all(),
    /** Replaces the entry of `day` (`YYYY-MM-DD`); an empty text deletes it. */
    setJournal(day, body) {
      if (!dayPattern.test(day)) throw new InputError('Ungültiger Tag.')
      const value = typeof body.text === 'string' ? body.text.slice(0, 24000) : ''
      if (!value.trim()) db.prepare('DELETE FROM journal WHERE day = ?').run(day)
      else db.prepare('INSERT INTO journal VALUES (?, ?, ?) ON CONFLICT (day) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at').run(day, value, new Date().toISOString())
      return { day, text: value.trim() ? value : '' }
    },
    /**
     * @returns the newest activity: ideas by last change, saved assets and journal entries,
     *   as `{ kind: 'idea'|'asset'|'journal', id, title, detail, at }`, newest first.
     */
    feed(limit = 80) {
      return db.prepare(`
        SELECT 'idea' AS kind, id, title, status AS detail, updated_at AS at FROM projects
        UNION ALL SELECT 'asset', id, title, library, created_at FROM assets
        UNION ALL SELECT 'journal', day, day, substr(text, 1, 280), updated_at FROM journal
        ORDER BY at DESC LIMIT ?
      `).all(limit)
    },
    assign(id, projectId) {
      this.project(projectId)
      if (!db.prepare('SELECT 1 FROM assets WHERE id = ?').get(id)) throw new InputError('Asset nicht gefunden.', 404)
      db.prepare('INSERT OR IGNORE INTO project_assets VALUES (?, ?)').run(projectId, id)
      return { id, projectId }
    },
    unassign(id, projectId) {
      this.project(projectId)
      db.prepare('DELETE FROM project_assets WHERE project_id = ? AND asset_id = ?').run(projectId, id)
      return { id, projectId }
    },
  }
}
