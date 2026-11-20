/**
 * Search over assets: query parser, FTS5 index and similarity.
 *
 * The index table `asset_search` is a plain FTS5 table kept up to date by `indexAsset`;
 * tags are indexed with their synonyms so "rubber" finds Latex. Confirmed tags weigh more than suggestions.
 */
import { tagKey } from './tag-vocabulary.mjs'

/**
 * Splits a search text into free terms, quoted phrases, exclusions and tag filters.
 * Words that equal a tag name or synonym become filters (longest match of up to three words first).
 * @param {string} text
 * @param {{ id: string, key: string }[]} lookup Tag keys and synonym keys with their tag ids.
 * @returns {{ terms: string[], phrases: string[], exclude: string[], include: string[], chips: { tagId: string, text: string }[] }}
 */
export function parseQuery(text, lookup) {
  const byKey = new Map()
  for (const entry of lookup) byKey.set(entry.key, [...byKey.get(entry.key) ?? [], entry.id])
  const result = { terms: [], phrases: [], exclude: [], include: [], chips: [] }
  const phrases = []
  const rest = String(text ?? '').slice(0, 300).replace(/"([^"]+)"/g, (_, phrase) => { phrases.push(phrase.trim()); return ' ' })
  result.phrases = phrases.filter(Boolean)
  const words = rest.split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const negative = words[i].startsWith('-') && words[i].length > 1
    let matched = false
    for (const size of [3, 2, 1]) {
      const slice = words.slice(i, i + size)
      if (slice.length < size) continue
      const key = tagKey((negative ? [slice[0].slice(1), ...slice.slice(1)] : slice).join(' '))
      const ids = byKey.get(key)
      if (!ids) continue
      for (const id of ids.slice(0, 1)) {
        if (negative) result.exclude.push(id)
        else {
          result.include.push(id)
          result.chips.push({ tagId: id, text: slice.join(' ') })
        }
      }
      i += size - 1
      matched = true
      break
    }
    if (!matched && !negative) result.terms.push(words[i])
    else if (!matched && negative) result.exclude.push('text:' + words[i].slice(1))
  }
  return result
}

/** Escapes a word for an FTS5 prefix query. */
const ftsTerm = word => '"' + word.replace(/"/g, '""') + '"'

function hexToLab(hex) {
  const channel = value => { const v = value / 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92 }
  const [r, g, b] = [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16)))
  const xyz = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883]
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
  const [fx, fy, fz] = xyz.map(f)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE76 distance between two `#rrggbb` colours. */
export const colorDistance = (a, b) => {
  const [x, y] = [hexToLab(a), hexToLab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ unpack: (row: object) => object, assetFields: string, config: { colorDistance: number } }} deps
 */
export function createSearchMethods(db, { unpack, assetFields, config }) {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(
    asset_id UNINDEXED, title, description, tags_confirmed, tags_suggested, text, source,
    tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3')`)
  const vectors = new Map()

  function indexAsset(id) {
    db.prepare('DELETE FROM asset_search WHERE asset_id = ?').run(id)
    const row = db.prepare('SELECT title, description, source FROM assets WHERE id = ?').get(id)
    if (!row) return
    const names = state => db.prepare(`SELECT tags.name, (SELECT group_concat(key, ' ') FROM tag_aliases WHERE tag_id = tags.id) AS aliases
      FROM asset_tags JOIN tags ON tags.id = tag_id WHERE asset_id = ? AND state = ?`).all(id, state)
      .map(tag => tag.name + ' ' + (tag.aliases ?? '')).join(' ')
    const text = db.prepare('SELECT text FROM asset_analysis WHERE asset_id = ?').get(id)?.text ?? ''
    db.prepare('INSERT INTO asset_search VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, row.title, row.description, names('bestaetigt'), names('vorschlag'), text, row.source)
  }

  const methods = {
    indexAsset,
    /** Indexes every asset that is missing from the search table. */
    indexMissing() {
      const missing = db.prepare('SELECT id FROM assets WHERE id NOT IN (SELECT asset_id FROM asset_search)').all()
      db.exec('BEGIN IMMEDIATE')
      try { for (const { id } of missing) indexAsset(id); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    /** Stores the raw local analysis of an asset; `featureprint` is a Buffer of float32 values. */
    saveAnalysis(id, { version, colors = [], featureprint = null, text = '', labels = [] }) {
      db.prepare(`INSERT INTO asset_analysis VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (asset_id) DO UPDATE SET version = excluded.version, colors = excluded.colors, featureprint = excluded.featureprint,
          text = excluded.text, labels = excluded.labels, analyzed_at = excluded.analyzed_at`)
        .run(id, version, JSON.stringify(colors), featureprint, text, JSON.stringify(labels), new Date().toISOString())
      vectors.delete(id)
      indexAsset(id)
    },
    analysis(id) {
      const row = db.prepare('SELECT * FROM asset_analysis WHERE asset_id = ?').get(id)
      return row ? { ...row, colors: JSON.parse(row.colors), labels: JSON.parse(row.labels) } : null
    },
    /** @returns ids of assets without analysis of at least `version`, newest first. */
    unanalyzed(version, limit = 50) {
      return db.prepare(`SELECT id FROM assets WHERE id NOT IN (SELECT asset_id FROM asset_analysis WHERE version >= ?)
        ORDER BY created_at DESC LIMIT ?`).all(version, limit).map(row => row.id)
    },
    /**
     * @param {object} query `q`, `library`, `project`, `tags`, `exclude`, `colors` (hex), `rating` (`all`, `1`, `-1`),
     *   `untagged`, `suggestions`, `unreviewed`, `stack`, `run`, `sort` (`new`, `relevance`), `limit`, `offset`.
     * @returns {{ items: object[], facets: Record<string, {tagId: string, name: string, count: number}[]>, total: number, nextOffset: number|null, chips: object[] }}
     */
    search(query = {}) {
      const lookup = db.prepare(`SELECT id, key FROM tags UNION SELECT tag_id, key FROM tag_aliases`).all()
      const parsed = parseQuery(query.q ?? '', lookup)
      const include = [...new Set([...(query.tags ?? []), ...parsed.include])]
      const exclude = [...new Set([...(query.exclude ?? []), ...parsed.exclude.filter(id => !id.startsWith('text:'))])]
      const negativeText = parsed.exclude.filter(id => id.startsWith('text:')).map(id => id.slice(5))
      const facetOf = new Map(db.prepare('SELECT id, facet FROM tags').all().map(row => [row.id, row.facet]))
      const groups = new Map()
      for (const id of include) groups.set(facetOf.get(id), [...groups.get(facetOf.get(id)) ?? [], id])
      const where = ['1 = 1']
      const params = []
      if (query.library) { where.push('a.library = ?'); params.push(query.library) }
      if (query.project) { where.push('EXISTS (SELECT 1 FROM project_assets WHERE project_id = ? AND asset_id = a.id)'); params.push(query.project) }
      for (const ids of groups.values()) {
        where.push(`EXISTS (SELECT 1 FROM asset_tags WHERE asset_id = a.id AND state != 'abgelehnt' AND tag_id IN (${ids.map(() => '?').join(',')}))`)
        params.push(...ids)
      }
      for (const id of exclude) { where.push("NOT EXISTS (SELECT 1 FROM asset_tags WHERE asset_id = a.id AND state != 'abgelehnt' AND tag_id = ?)"); params.push(id) }
      if (query.rating === '1') where.push('a.rating = 1')
      else if (query.rating === '-1') where.push('a.rating = -1')
      else if (query.rating !== 'all') where.push('a.rating >= 0')
      if (query.untagged) where.push("NOT EXISTS (SELECT 1 FROM asset_tags WHERE asset_id = a.id AND state != 'abgelehnt')")
      if (query.suggestions) where.push("EXISTS (SELECT 1 FROM asset_tags WHERE asset_id = a.id AND state = 'vorschlag')")
      if (query.unreviewed) where.push("a.reviewed_at = ''")
      if (query.run) { where.push('a.run_id = ?'); params.push(query.run) }
      else if (query.stack) {
        where.push(`(a.run_id = '' OR a.id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY run_id ORDER BY rating DESC, created_at DESC) AS place
          FROM assets WHERE run_id != '' AND rating >= 0) WHERE place = 1))`)
      }
      const match = [...parsed.terms.map(word => ftsTerm(word) + '*'), ...parsed.phrases.map(ftsTerm)].join(' ')
      for (const word of negativeText) { where.push('NOT EXISTS (SELECT 1 FROM asset_search WHERE asset_id = a.id AND asset_search MATCH ?)'); params.push(ftsTerm(word)) }
      const ranked = Boolean(match)
      const tagOrder = include.length && query.sort !== 'new'
        ? `(SELECT count(*) FROM asset_tags WHERE asset_id = a.id AND state = 'bestaetigt' AND tag_id IN (${include.map(() => '?').join(',')})) DESC, `
        : ''
      const orderParams = tagOrder ? include : []
      const sql = ranked
        ? `SELECT ${assetFields.split(', ').map(field => field === 'length(media) AS size' ? 'length(a.media) AS size' : 'a.' + field).join(', ')},
             bm25(asset_search, 0, 4, 2, 8, 3, 1, 1) AS rank
           FROM asset_search JOIN assets a ON a.id = asset_search.asset_id
           WHERE asset_search MATCH ? AND ${where.join(' AND ')}
           ORDER BY ${tagOrder}${query.sort === 'new' ? 'a.created_at DESC' : 'rank, a.created_at DESC'}`
        : `SELECT ${assetFields.split(', ').map(field => field === 'length(media) AS size' ? 'length(a.media) AS size' : 'a.' + field).join(', ')}
           FROM assets a WHERE ${where.join(' AND ')} ORDER BY ${tagOrder}a.created_at DESC`
      let rows = db.prepare(sql).all(...(ranked ? [match, ...params, ...orderParams] : [...params, ...orderParams]))
      const colors = (query.colors ?? []).filter(hex => /^#[0-9a-f]{6}$/i.test(hex))
      if (colors.length) {
        const analysis = db.prepare('SELECT colors FROM asset_analysis WHERE asset_id = ?')
        rows = rows.filter(row => {
          const found = analysis.get(row.id)
          const list = found ? JSON.parse(found.colors) : []
          return colors.every(hex => list.some(color => colorDistance(hex, color.hex) <= config.colorDistance))
        })
      }
      const total = rows.length
      const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500)
      const offset = Math.max(Number(query.offset) || 0, 0)
      const page = rows.slice(offset, offset + limit)
      const tagMap = this.assetTags(page.length ? page.map(row => row.id) : ['-'])
      const stackCounts = new Map()
      if (query.stack && !query.run) {
        for (const row of db.prepare("SELECT run_id, count(*) AS n FROM assets WHERE run_id != '' GROUP BY run_id").all()) stackCounts.set(row.run_id, row.n)
      }
      const facets = {}
      const counts = db.prepare(`SELECT tag_id, tags.facet, tags.name, count(*) AS n FROM asset_tags JOIN tags ON tags.id = tag_id
        WHERE state != 'abgelehnt' AND asset_id IN (SELECT value FROM json_each(?)) GROUP BY tag_id ORDER BY n DESC, tags.name`).all(JSON.stringify(rows.map(row => row.id)))
      for (const row of counts) (facets[row.facet] ??= []).push({ tagId: row.tag_id, name: row.name, count: row.n })
      return {
        items: page.map(row => ({ ...unpack(row), tagList: tagMap[row.id] ?? [], stackCount: stackCounts.get(row.run_id) ?? 0 })),
        facets, total, nextOffset: offset + limit < total ? offset + limit : null, chips: parsed.chips,
      }
    },
    /** @returns the `limit` assets whose feature print is closest to the one of `id`, nearest first. */
    similar(id, limit = 50) {
      const load = assetId => {
        if (!vectors.has(assetId)) {
          const row = db.prepare('SELECT featureprint FROM asset_analysis WHERE asset_id = ? AND featureprint IS NOT NULL').get(assetId)
          vectors.set(assetId, row ? new Float32Array(Uint8Array.from(row.featureprint).buffer) : null)
        }
        return vectors.get(assetId)
      }
      const origin = load(id)
      if (!origin) return []
      const out = []
      for (const { asset_id } of db.prepare('SELECT asset_id FROM asset_analysis WHERE featureprint IS NOT NULL AND asset_id != ?').all(id)) {
        const other = load(asset_id)
        if (!other || other.length !== origin.length) continue
        let sum = 0
        for (let i = 0; i < origin.length; i++) sum += (origin[i] - other[i]) ** 2
        out.push({ id: asset_id, distance: Math.sqrt(sum) })
      }
      return out.sort((a, b) => a.distance - b.distance).slice(0, Math.min(Math.max(limit, 1), 200))
    },
  }
  return methods
}
