/**
 * Faceted tags of assets: tables, seed, legacy migration and the store methods built on them.
 *
 * Every asset–tag pair has an `origin` (who found it) and a `state`. Machine output is a
 * `vorschlag`; a human decision (`bestaetigt` or `abgelehnt`) is never overwritten by a machine.
 * The legacy columns `assets.tags` / `assets.tag_source` are kept in step so older readers work.
 */
import { FACETS, LEGACY_TAGS, STARTER_VOCABULARY, VOCABULARY_VERSION, tagKey } from './tag-vocabulary.mjs'

const origins = ['vision', 'text', 'meta', 'ki', 'nutzer']
const rank = { bestaetigt: 3, vorschlag: 2, abgelehnt: 1 }
const facetIds = new Set(FACETS.map(facet => facet.id))
const slug = key => key.replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '') || 'tag'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY, facet TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (facet, key)
  );
  CREATE TABLE IF NOT EXISTS tag_aliases (
    tag_id TEXT NOT NULL REFERENCES tags(id), key TEXT NOT NULL, PRIMARY KEY (key, tag_id)
  );
  CREATE TABLE IF NOT EXISTS asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(id), tag_id TEXT NOT NULL REFERENCES tags(id),
    origin TEXT NOT NULL CHECK (origin IN ('vision','text','meta','ki','nutzer')),
    state TEXT NOT NULL CHECK (state IN ('vorschlag','bestaetigt','abgelehnt')),
    confidence REAL, updated_at TEXT NOT NULL, PRIMARY KEY (asset_id, tag_id)
  );
  CREATE INDEX IF NOT EXISTS asset_tags_by_tag ON asset_tags (tag_id, state);
  CREATE TABLE IF NOT EXISTS asset_analysis (
    asset_id TEXT PRIMARY KEY REFERENCES assets(id), version INTEGER NOT NULL,
    colors TEXT NOT NULL DEFAULT '[]', featureprint BLOB, text TEXT NOT NULL DEFAULT '',
    labels TEXT NOT NULL DEFAULT '[]', analyzed_at TEXT NOT NULL
  );
`

/**
 * Creates tag tables, seeds the vocabulary and migrates legacy tags (each once).
 * @param {import('node:sqlite').DatabaseSync} db Open database whose `assets` table exists with the new columns.
 * @param {{ settings: (ns: string) => object, setSettings: (ns: string, data: object) => void }} config
 */
export function migrateTags(db, config) {
  db.exec(SCHEMA)
  const state = config.settings('hub:tags')
  db.exec('BEGIN IMMEDIATE')
  try {
    if ((state.vocabulary ?? 0) < VOCABULARY_VERSION) seedVocabulary(db)
    if (!state.legacyMigrated) migrateLegacy(db)
    // Everything saved before the sort mode counts as looked at; only new items queue up there.
    if (!state.reviewedBackfill) db.prepare("UPDATE assets SET reviewed_at = created_at WHERE reviewed_at = ''").run()
    config.setSettings('hub:tags', { ...state, vocabulary: VOCABULARY_VERSION, legacyMigrated: true, reviewedBackfill: true })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function insertTag(db, facet, name, aliases = []) {
  const key = tagKey(name)
  const existing = db.prepare('SELECT id FROM tags WHERE facet = ? AND key = ?').get(facet, key)
  if (existing) return existing.id
  let id = `${facet}:${slug(key)}`
  for (let n = 2; db.prepare('SELECT 1 FROM tags WHERE id = ?').get(id); n++) id = `${facet}:${slug(key)}-${n}`
  db.prepare('INSERT INTO tags VALUES (?, ?, ?, ?, ?)').run(id, facet, name, key, new Date().toISOString())
  for (const alias of aliases) {
    if (tagKey(alias) !== key) db.prepare('INSERT OR IGNORE INTO tag_aliases VALUES (?, ?)').run(id, tagKey(alias))
  }
  return id
}

function seedVocabulary(db) {
  for (const [facet, entries] of Object.entries(STARTER_VOCABULARY)) {
    for (const [name, ...aliases] of entries) insertTag(db, facet, name, aliases)
  }
}

/** @returns the tag id for a name or synonym; non-`frei` facets win. */
function resolveName(db, name) {
  const key = tagKey(name)
  const rows = db.prepare(`
    SELECT id, facet FROM tags WHERE key = ?
    UNION SELECT tags.id, tags.facet FROM tag_aliases JOIN tags ON tags.id = tag_aliases.tag_id WHERE tag_aliases.key = ?
  `).all(key, key)
  rows.sort((a, b) => (a.facet === 'frei') - (b.facet === 'frei'))
  return rows[0]?.id
}

function migrateLegacy(db) {
  const put = db.prepare(`INSERT INTO asset_tags VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (asset_id, tag_id) DO NOTHING`)
  const now = new Date().toISOString()
  for (const asset of db.prepare("SELECT id, tags, tag_source FROM assets WHERE tags != '[]'").all()) {
    const manual = asset.tag_source === 'manual'
    for (const name of JSON.parse(asset.tags)) {
      const mapped = LEGACY_TAGS[tagKey(name)]
      const id = mapped ? insertTag(db, mapped[0], mapped[1]) : resolveName(db, name) ?? insertTag(db, 'frei', name)
      put.run(asset.id, id, manual ? 'nutzer' : 'vision', manual ? 'bestaetigt' : 'vorschlag', manual ? null : 0.5, now)
    }
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ asset: (id: string) => object, InputError: typeof Error, indexAsset: (id: string) => void }} deps
 * @returns tag methods to merge into the store object
 */
export function createTagMethods(db, { asset, InputError, indexAsset }) {
  const fail = (message, status = 400) => new InputError(message, status)
  const now = () => new Date().toISOString()
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  const idList = (ids, label) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string')) {
      throw fail(`Wähle bis zu 1000 ${label}.`)
    }
    return [...new Set(ids)]
  }
  const tagRow = id => {
    const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id)
    if (!row) throw fail('Tag nicht gefunden.', 404)
    return row
  }

  /** Keeps the legacy `tags` column equal to the visible tags (confirmed and suggested). */
  function refreshLegacy(assetId, { human = false } = {}) {
    const names = db.prepare(`SELECT tags.name FROM asset_tags JOIN tags ON tags.id = tag_id
      WHERE asset_id = ? AND state != 'abgelehnt' AND tags.facet NOT IN ('quelle','modell','farbe')
      ORDER BY (state = 'bestaetigt') DESC, tags.name`).all(assetId).map(row => row.name)
    db.prepare(`UPDATE assets SET tags = ?, tag_source = CASE WHEN ? OR tag_source = 'manual' THEN 'manual' WHEN tag_source = '' THEN 'auto' ELSE tag_source END
      WHERE id = ?`).run(JSON.stringify(names.slice(0, 30)), human ? 1 : 0, assetId)
    indexAsset(assetId)
  }

  const methods = {
    /** @returns facets with their tags, synonyms and usage counts (confirmed or suggested). */
    tagVocabulary() {
      const counts = new Map(db.prepare(`SELECT tag_id, count(*) AS n FROM asset_tags WHERE state != 'abgelehnt' GROUP BY tag_id`)
        .all().map(row => [row.tag_id, row.n]))
      const aliases = new Map()
      for (const row of db.prepare('SELECT tag_id, key FROM tag_aliases ORDER BY key').all()) {
        aliases.set(row.tag_id, [...aliases.get(row.tag_id) ?? [], row.key])
      }
      const tags = db.prepare('SELECT id, facet, name FROM tags ORDER BY name COLLATE NOCASE').all()
      return FACETS.map(facet => ({
        ...facet,
        tags: tags.filter(tag => tag.facet === facet.id).map(tag => ({ ...tag, aliases: aliases.get(tag.id) ?? [], count: counts.get(tag.id) ?? 0 })),
      }))
    },
    /** @returns `{ [assetId]: [{ tagId, facet, name, origin, state, confidence }] }` without rejected tags. */
    assetTags(ids) {
      const result = {}
      const select = db.prepare(`SELECT tag_id AS tagId, tags.facet, tags.name, origin, state, confidence
        FROM asset_tags JOIN tags ON tags.id = tag_id WHERE asset_id = ? AND state != 'abgelehnt'
        ORDER BY (state = 'bestaetigt') DESC, tags.facet, tags.name`)
      for (const id of idList(ids, 'Einträge')) result[id] = select.all(id)
      return result
    },
    /**
     * Human decision for a selection. `bestaetigt` adds or confirms, `abgelehnt` hides the tag for good,
     * `entfernt` withdraws a tag (own tags disappear, machine tags are rejected so they do not return).
     */
    setTagState({ assetIds, tagIds, state }) {
      if (!['bestaetigt', 'abgelehnt', 'entfernt'].includes(state)) throw fail('Unbekannter Zustand.')
      const assets = idList(assetIds, 'Einträge')
      const tags = idList(tagIds, 'Tags')
      return transaction(() => {
        for (const id of assets) asset(id)
        for (const tagId of tags) tagRow(tagId)
        for (const id of assets) {
          for (const tagId of tags) {
            const current = db.prepare('SELECT origin FROM asset_tags WHERE asset_id = ? AND tag_id = ?').get(id, tagId)
            if (state === 'entfernt' && current?.origin === 'nutzer') {
              db.prepare('DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?').run(id, tagId)
            } else if (state === 'entfernt' && !current) {
              continue
            } else {
              db.prepare(`INSERT INTO asset_tags VALUES (?, ?, 'nutzer', ?, NULL, ?)
                ON CONFLICT (asset_id, tag_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`)
                .run(id, tagId, state === 'bestaetigt' ? 'bestaetigt' : 'abgelehnt', now())
            }
          }
          refreshLegacy(id, { human: true })
        }
        return { assetIds: assets, tagIds: tags, state }
      })
    },
    /**
     * Machine suggestions for one asset. Never overwrites `bestaetigt` or `abgelehnt`.
     * @param {{ tagId: string, origin: string, confidence?: number, state?: 'vorschlag'|'bestaetigt' }[]} list
     *   `state: 'bestaetigt'` is only accepted for origin `meta`.
     */
    addSuggestions(assetId, list) {
      transaction(() => {
        for (const item of list) {
          if (!origins.includes(item.origin) || item.origin === 'nutzer') throw fail('Unbekannte Herkunft.')
          tagRow(item.tagId)
          const state = item.state === 'bestaetigt' && item.origin === 'meta' ? 'bestaetigt' : 'vorschlag'
          db.prepare(`INSERT INTO asset_tags VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (asset_id, tag_id) DO UPDATE SET origin = excluded.origin, confidence = excluded.confidence, updated_at = excluded.updated_at
            WHERE asset_tags.state = 'vorschlag'`).run(assetId, item.tagId, item.origin, state, item.confidence ?? null, now())
        }
        refreshLegacy(assetId)
      })
    },
    /** Resolves a tag name or synonym to its id, creating it in `frei` when `create` is set. */
    resolveTag(name, { create = false } = {}) {
      const id = resolveName(db, name)
      if (id || !create) return id
      return insertTag(db, 'frei', String(name).trim().replace(/\s+/g, ' ').slice(0, 48))
    },
    /** Creates (or finds) a tag in any facet, also computed ones; for machine use only. */
    ensureTag(facet, name) {
      if (!facetIds.has(facet)) throw fail('Unbekannte Gruppe.')
      return insertTag(db, facet, String(name).trim().replace(/\s+/g, ' ').slice(0, 48))
    },
    /** @returns every tag name and synonym as `{ id, facet, key }` for text matching. */
    tagLookup() {
      return db.prepare(`SELECT id, facet, key FROM tags UNION ALL
        SELECT tags.id, tags.facet, tag_aliases.key FROM tag_aliases JOIN tags ON tags.id = tag_aliases.tag_id`).all()
    },
    /** Suggests the confirmed tags of reference images for a new asset (origin `meta`). */
    inheritTags(assetId, referenceIds) {
      const inherited = new Map()
      for (const id of referenceIds) {
        for (const tag of db.prepare(`SELECT tag_id, asset_tags.state FROM asset_tags JOIN tags ON tags.id = tag_id
          WHERE asset_id = ? AND state = 'bestaetigt' AND tags.facet IN ('motiv','mode','ort','licht','kamera','frei')`).all(id)) inherited.set(tag.tag_id, 0.6)
      }
      if (inherited.size) methods.addSuggestions(assetId, [...inherited].map(([tagId, confidence]) => ({ tagId, origin: 'meta', confidence })))
    },
    /** Gives generations without a run the same `run_id` when prompt and model match and they were created within 10 minutes of each other. */
    groupLegacyRuns() {
      const key = row => {
        const line = name => row.description.split('\n').find(entry => entry.startsWith(name + ': ')) ?? ''
        return line('Prompt') + '|' + line('Modell')
      }
      let previous = null, group = [], grouped = 0
      const flush = () => {
        if (group.length > 1) {
          for (const row of group) db.prepare('UPDATE assets SET run_id = ? WHERE id = ?').run('alt-' + group[0].id.slice(0, 8), row.id)
          grouped += group.length
        }
        group = []
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const row of db.prepare("SELECT id, description, created_at FROM assets WHERE library = 'generation' AND run_id = '' ORDER BY created_at").all()) {
          if (previous && key(row) === key(previous) && key(row) !== '|' && Date.parse(row.created_at) - Date.parse(previous.created_at) <= 600_000) group.push(row)
          else { flush(); group = [row] }
          previous = row
        }
        flush()
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return grouped
    },
    /** Mirrors a legacy name list (editTags / saveAutomaticTags) into the tag tables. */
    mirrorLegacyTags(assetId, names, origin) {
      transaction(() => {
        const wanted = new Set(names.map(name => methods.resolveTag(name, { create: true })))
        for (const row of db.prepare(`SELECT tag_id, origin, state FROM asset_tags WHERE asset_id = ? AND state != 'abgelehnt'`).all(assetId)) {
          if (wanted.has(row.tag_id) || (origin === 'vision' && row.origin !== 'vision')) continue
          if (origin === 'nutzer') {
            if (row.origin === 'nutzer') db.prepare('DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?').run(assetId, row.tag_id)
            else db.prepare("UPDATE asset_tags SET state = 'abgelehnt', updated_at = ? WHERE asset_id = ? AND tag_id = ?").run(now(), assetId, row.tag_id)
          }
        }
        for (const tagId of wanted) {
          if (origin === 'nutzer') {
            db.prepare(`INSERT INTO asset_tags VALUES (?, ?, 'nutzer', 'bestaetigt', NULL, ?)
              ON CONFLICT (asset_id, tag_id) DO UPDATE SET state = 'bestaetigt', updated_at = excluded.updated_at`).run(assetId, tagId, now())
          } else {
            db.prepare(`INSERT INTO asset_tags VALUES (?, ?, ?, 'vorschlag', 0.5, ?) ON CONFLICT (asset_id, tag_id) DO NOTHING`)
              .run(assetId, tagId, origin, now())
          }
        }
        refreshLegacy(assetId, { human: origin === 'nutzer' })
        if (origin === 'nutzer') db.prepare('UPDATE assets SET tags = ? WHERE id = ?').run(JSON.stringify(names), assetId)
      })
    },
    /** @returns the new tag; `facet` must be a known facet and its name unique inside it. */
    createTag({ facet, name, aliases = [] }) {
      if (!facetIds.has(facet)) throw fail('Unbekannte Gruppe.')
      if (!FACETS.find(item => item.id === facet).editable) throw fail('In dieser Gruppe entstehen Tags automatisch.')
      const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
      if (!clean || clean.length > 48 || /[\r\n,]/.test(clean)) throw fail('Gib einen Namen bis 48 Zeichen ein.')
      if (db.prepare('SELECT 1 FROM tags WHERE facet = ? AND key = ?').get(facet, tagKey(clean))) throw fail('Diesen Tag gibt es in der Gruppe schon.', 409)
      return transaction(() => {
        const id = insertTag(db, facet, clean, aliases)
        return tagRow(id)
      })
    },
    renameTag(id, name) {
      const row = tagRow(id)
      const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
      if (!clean || clean.length > 48 || /[\r\n,]/.test(clean)) throw fail('Gib einen Namen bis 48 Zeichen ein.')
      const clash = db.prepare('SELECT id FROM tags WHERE facet = ? AND key = ? AND id != ?').get(row.facet, tagKey(clean), id)
      if (clash) throw fail('Diesen Tag gibt es in der Gruppe schon. Führe die beiden zusammen.', 409)
      transaction(() => {
        db.prepare('UPDATE tags SET name = ?, key = ? WHERE id = ?').run(clean, tagKey(clean), id)
        db.prepare('DELETE FROM tag_aliases WHERE tag_id = ? AND key = ?').run(id, tagKey(clean))
        db.prepare('INSERT OR IGNORE INTO tag_aliases VALUES (?, ?)').run(id, row.key)
        for (const { asset_id } of db.prepare('SELECT asset_id FROM asset_tags WHERE tag_id = ?').all(id)) refreshLegacy(asset_id)
      })
      return tagRow(id)
    },
    /** Moves every assignment of `sourceId` to `targetId`, keeping the stronger state, and keeps the old name as a synonym. */
    mergeTags(sourceId, targetId) {
      if (sourceId === targetId) throw fail('Wähle zwei verschiedene Tags.')
      const source = tagRow(sourceId)
      tagRow(targetId)
      return transaction(() => {
        const touched = []
        for (const row of db.prepare('SELECT * FROM asset_tags WHERE tag_id = ?').all(sourceId)) {
          const other = db.prepare('SELECT * FROM asset_tags WHERE asset_id = ? AND tag_id = ?').get(row.asset_id, targetId)
          if (!other || rank[row.state] > rank[other.state] || (rank[row.state] === rank[other.state] && (row.confidence ?? 1) > (other.confidence ?? 1))) {
            db.prepare(`INSERT INTO asset_tags VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (asset_id, tag_id) DO UPDATE SET origin = excluded.origin, state = excluded.state, confidence = excluded.confidence, updated_at = excluded.updated_at`)
              .run(row.asset_id, targetId, row.origin, row.state, row.confidence, now())
          }
          touched.push(row.asset_id)
        }
        db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').run(sourceId)
        db.prepare('INSERT OR IGNORE INTO tag_aliases SELECT ?, key FROM tag_aliases WHERE tag_id = ?').run(targetId, sourceId)
        db.prepare('INSERT OR IGNORE INTO tag_aliases VALUES (?, ?)').run(targetId, source.key)
        db.prepare('DELETE FROM tag_aliases WHERE tag_id = ?').run(sourceId)
        db.prepare('DELETE FROM tags WHERE id = ?').run(sourceId)
        for (const id of touched) refreshLegacy(id)
        return tagRow(targetId)
      })
    },
    /** Replaces the synonyms of a tag. */
    setAliases(id, aliases) {
      const row = tagRow(id)
      if (!Array.isArray(aliases) || aliases.length > 40 || aliases.some(alias => typeof alias !== 'string' || alias.length > 48)) throw fail('Bis zu 40 Synonyme mit je höchstens 48 Zeichen.')
      transaction(() => {
        db.prepare('DELETE FROM tag_aliases WHERE tag_id = ?').run(id)
        for (const alias of aliases) {
          const key = tagKey(alias)
          if (key && key !== row.key) db.prepare('INSERT OR IGNORE INTO tag_aliases VALUES (?, ?)').run(id, key)
        }
      })
      return tagRow(id)
    },
    moveTag(id, facet) {
      const row = tagRow(id)
      if (!facetIds.has(facet)) throw fail('Unbekannte Gruppe.')
      if (db.prepare('SELECT 1 FROM tags WHERE facet = ? AND key = ?').get(facet, row.key)) throw fail('Die Zielgruppe hat diesen Tag schon. Führe die beiden zusammen.', 409)
      db.prepare('UPDATE tags SET facet = ? WHERE id = ?').run(facet, id)
      return tagRow(id)
    },
    /** @returns `{ id, removed }` with the number of assignments that were removed. */
    deleteTag(id) {
      tagRow(id)
      return transaction(() => {
        const assets = db.prepare('SELECT asset_id FROM asset_tags WHERE tag_id = ?').all(id)
        db.prepare('DELETE FROM asset_tags WHERE tag_id = ?').run(id)
        db.prepare('DELETE FROM tag_aliases WHERE tag_id = ?').run(id)
        db.prepare('DELETE FROM tags WHERE id = ?').run(id)
        for (const { asset_id } of assets) refreshLegacy(asset_id)
        return { id, removed: assets.length }
      })
    },
    /** Confirms every open suggestion of the selected assets. */
    acceptSuggestions(ids) {
      const assets = idList(ids, 'Einträge')
      return transaction(() => {
        for (const id of assets) {
          asset(id)
          db.prepare("UPDATE asset_tags SET state = 'bestaetigt', updated_at = ? WHERE asset_id = ? AND state = 'vorschlag'").run(now(), id)
          refreshLegacy(id, { human: true })
        }
        return { ids: assets }
      })
    },
    /** Marks assets as looked at in the sort mode. */
    markReviewed(ids) {
      const assets = idList(ids, 'Einträge')
      return transaction(() => {
        for (const id of assets) { asset(id); db.prepare('UPDATE assets SET reviewed_at = ? WHERE id = ?').run(now(), id) }
        return { ids: assets }
      })
    },
    /** Groups assets of one playground run into a stack. */
    setRun(ids, runId) {
      const assets = idList(ids, 'Einträge')
      if (typeof runId !== 'string' || runId.length > 80) throw fail('Ungültige Lauf-ID.')
      return transaction(() => {
        for (const id of assets) db.prepare('UPDATE assets SET run_id = ? WHERE id = ?').run(runId, id)
        return { ids: assets, runId }
      })
    },
    /** @param {number} rating `1` favourite, `0` neutral, `-1` discarded. */
    setRating(ids, rating) {
      if (![-1, 0, 1].includes(rating)) throw fail('Bewertung muss -1, 0 oder 1 sein.')
      const assets = idList(ids, 'Einträge')
      return transaction(() => {
        for (const id of assets) asset(id)
        for (const id of assets) db.prepare('UPDATE assets SET rating = ? WHERE id = ?').run(rating, id)
        return { ids: assets, rating }
      })
    },
  }
  return methods
}
