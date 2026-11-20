import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const workerScript = fileURLToPath(new URL('./clip-vision.swift', import.meta.url))
const hasWord = (source, pattern) => new RegExp('(?:^|[^\\p{L}\\d])(?:' + pattern + ')(?=$|[^\\p{L}\\d])', 'iu').test(source)

export function inferTags(asset, vision) {
  const words = [asset.title, asset.description].join(' ')
  const labels = vision?.labels ?? []
  const signal = (pattern, threshold) => labels.some(({name, confidence}) => confidence >= threshold && hasWord(name.replaceAll('_', ' '), pattern))
  const tags = []
  const face = (vision?.face ?? 0) >= 0.45
  const person = face || (vision?.person ?? 0) >= 0.45 ||
    signal('people|person|human|portrait|selfie', 0.24) ||
    hasWord(words, 'person(?:en)?|personenreferenz|model(?:l)?referenz|portrait|porträt|headshot|gesicht|selfie')
  if (person) tags.push('Person')
  if (signal('portrait|selfie', 0.28) || hasWord(words, 'porträt|portrait|headshot|selfie')) tags.push('Porträt')
  if (signal('clothing|garment|apparel|fashion|dress|jacket|coat|shirt|skirt|uniform|outfit|footwear|shoes|suit|trousers', 0.16) ||
    hasWord(words, 'outfits?|kleidung|garderobe|bekleidung|fashion|wardrobe|jacke|mantel|kleid|schuhe|anzug|kostüm')) tags.push('Outfit')
  const sceneCutoff = person ? 0.27 : 0.16
  const architecture = signal('architecture|building|facade|cityscape|bridge|street|alley', sceneCutoff)
  const nature = signal('landscape|forest|woodland|mountain|beach|coast|outdoors|park|natural landscape|desert|waterfall', sceneCutoff)
  const interior = signal('interior|room|living room|kitchen|bedroom|bathroom|corridor|hallway', sceneCutoff)
  if (architecture || nature || interior || hasWord(words, 'location|kulisse|drehort|landschaft|architektur|innenraum|interior|fassade')) tags.push('Location')
  if (architecture) tags.push('Architektur')
  if (nature) tags.push('Natur')
  if (interior) tags.push('Innenraum')
  if (signal('screenshot', 0.25) || hasWord(words, 'screenshot|bildschirmfoto|screen shot')) tags.push('Screenshot')
  return tags
}

/** A single Swift process handles a batch so macOS loads the Vision models once. */
async function visionWorker() {
  if (process.platform !== 'darwin') return null
  const dir = await mkdtemp(join(tmpdir(), 'atelier-vision-'))
  const child = spawn('/usr/bin/swift', ['-module-cache-path', join(dir, 'cache'), workerScript], { stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout })
  const replies = lines[Symbol.asyncIterator]()
  let dead = false
  child.on('error', () => { dead = true; lines.close() })
  child.stdin.on('error', () => { dead = true; lines.close() })
  child.once('close', () => { dead = true; lines.close() })
  return {
    async classify(bytes) {
      if (dead) return null
      let timer
      try {
        const result = await Promise.race([
          replies.next(),
          new Promise(resolve => {
            timer = setTimeout(() => { dead = true; child.kill(); resolve({ done: true }) }, 60_000)
          }),
          new Promise(resolve => child.stdin.write(Buffer.from(bytes).toString('base64') + '\n', error => {
            if (error) resolve({ done: true })
          })),
        ])
        return result.done ? null : JSON.parse(result.value)
      } finally { clearTimeout(timer) }
    },
    async close() {
      child.stdin.end()
      if (!dead) child.kill()
      lines.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Version of the stored analysis; raising it re-analyses every asset once. */
export const ANALYSIS_VERSION = 1

/**
 * @param {{ labelThreshold?: number }} config
 * @returns the validated analysis settings.
 */
export function resolveAnalysisConfig(config = {}) {
  const labelThreshold = config.labelThreshold ?? 0.25
  if (typeof labelThreshold !== 'number' || labelThreshold < 0.05 || labelThreshold > 0.95) {
    throw new Error('analysis.labelThreshold muss zwischen 0.05 und 0.95 liegen.')
  }
  return { labelThreshold }
}

const sourceHosts = [[/(^|\.)instagram\.com$/, 'Instagram'], [/(^|\.)pinterest\./, 'Pinterest'], [/(^|\.)(x|twitter)\.com$/, 'X'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube']]

/** Tags from the data the hub already has: type, source, model (confirmed, origin `meta`). */
export function metaTags(asset, store) {
  const found = []
  const add = (facet, name) => found.push({ tagId: store.ensureTag(facet, name), origin: 'meta', state: 'bestaetigt', confidence: 1 })
  if (asset.library === 'generation') add('art', asset.media_type?.startsWith('video/') ? 'Video' : 'Generiert')
  else if (asset.media_type?.startsWith('video/')) add('art', 'Video')
  else if (asset.media_type?.startsWith('image/')) add('art', 'Foto')
  else if (!asset.media_type && asset.source) add('art', 'Webseite')
  else if (!asset.media_type) add('art', 'Notiz')
  if (asset.library === 'generation') add('quelle', asset.title.startsWith('Video') || /^(Verlängertes Video|Fortsetzung) /.test(asset.title) ? 'Video Playground' : 'Playground')
  else if (asset.source) {
    let host = ''
    try { host = new URL(asset.source).hostname } catch { /* a stored source that is no URL has no host */ }
    add('quelle', sourceHosts.find(([pattern]) => pattern.test(host))?.[1] ?? 'Web')
  } else add('quelle', 'Upload')
  const model = /^Modell: (.+?)(?: über .*)?$/m.exec(asset.description ?? '')?.[1]
  if (model) add('modell', model.trim())
  return found
}

/** Tags from title and prompt text matched against tag names and synonyms (whole words). */
export function textTags(asset, lookup) {
  const prompt = /^Prompt: (.*)$/m.exec(asset.description ?? '')?.[1]
  const source = [asset.title, prompt ?? (asset.library === 'clips' ? asset.description : '')].join(' ')
  const found = new Map()
  for (const entry of lookup) {
    if (['farbe', 'quelle', 'modell'].includes(entry.facet) || entry.key.length < 3 || found.has(entry.id)) continue
    if (hasWord(source, entry.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))) found.set(entry.id, 0.7)
  }
  return [...found].map(([tagId, confidence]) => ({ tagId, origin: 'text', confidence }))
}

/** Vision labels matched against synonyms of vocabulary tags. */
export function labelTags(vision, lookup, threshold) {
  const found = new Map()
  for (const { name, confidence } of vision?.labels ?? []) {
    if (confidence < threshold) continue
    const label = name.replaceAll('_', ' ').toLocaleLowerCase()
    for (const entry of lookup) {
      if (['farbe', 'quelle', 'modell', 'frei'].includes(entry.facet) || entry.key.length < 4) continue
      if (label === entry.key) found.set(entry.id, Math.max(found.get(entry.id) ?? 0, confidence))
    }
  }
  return [...found].map(([tagId, confidence]) => ({ tagId, origin: 'vision', confidence }))
}

/** Extracts a still image (1 s into the video) with ffmpeg; `null` when ffmpeg or the file fails. */
export async function videoStill(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'atelier-still-'))
  try {
    const input = join(dir, 'video')
    await writeFile(input, bytes)
    await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-ss', '1', '-i', input,
      '-frames:v', '1', '-vf', "scale='min(iw,1024)':-2", '-y', join(dir, 'still.jpg')], { timeout: 30_000 })
    return await readFile(join(dir, 'still.jpg'))
  } catch (error) {
    console.warn('Atelier: Standbild aus dem Video nicht möglich.', error.message)
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Background analysis of every asset: local Vision output, colours, feature print, tag suggestions.
 * Writes only while not stopped; one pass runs at a time.
 * @param {object} store creativeStore.
 * @param {{ labelThreshold: number, vision?: () => Promise<{classify(bytes: Buffer): Promise<object|null>, close(): Promise<void>}|null>, frame?: (bytes: Buffer) => Promise<Buffer|null> }} options
 *   `vision` and `frame` can be replaced (tests); both default to the Swift worker and ffmpeg.
 */
export function createAssetAnalyzer(store, { labelThreshold, vision: openVision = visionWorker, frame = videoStill }) {
  let stopped = false, running = false, timer, worker
  async function analyze(id) {
    const asset = store.asset(id)
    const file = asset.media_type && (asset.media_type.startsWith('image/') || asset.media_type.startsWith('video/')) ? store.media(id) : null
    let still = null
    if (file) still = file.media_type.startsWith('video/') ? await frame(Buffer.from(file.media)) : file.media
    let result = null
    if (still) {
      try {
        if (worker === undefined) worker = await openVision()
        if (stopped) return
        result = await worker?.classify(still) ?? null
      } catch (error) {
        console.warn('Atelier: lokale Bildanalyse nicht verfügbar.', error.message)
      }
    }
    if (stopped) return
    const lookup = store.tagLookup()
    const named = inferTags(asset, result).map(name => ({ tagId: store.resolveTag(name, { create: true }), origin: 'vision', confidence: 0.6 }))
    const labelled = labelTags(result, lookup, labelThreshold)
    const suggestions = new Map()
    for (const item of [...textTags(asset, lookup), ...labelled, ...named, ...metaTags(asset, store)]) {
      const current = suggestions.get(item.tagId)
      if (!current || (item.state === 'bestaetigt') || (current.state !== 'bestaetigt' && (item.confidence ?? 0) > (current.confidence ?? 0))) suggestions.set(item.tagId, item)
    }
    store.saveAnalysis(id, {
      version: ANALYSIS_VERSION, colors: result?.colors ?? [], text: result?.text ?? '', labels: result?.labels?.slice(0, 40) ?? [],
      featureprint: result?.featureprint ? Buffer.from(result.featureprint, 'base64') : null,
    })
    store.addSuggestions(id, [...suggestions.values()])
  }
  async function drain() {
    running = true
    try {
      store.groupLegacyRuns()
      let batch
      while (!stopped && (batch = store.unanalyzed(ANALYSIS_VERSION)).length) {
        for (const id of batch) {
          if (stopped) return
          try { await analyze(id) } catch (error) {
            if (stopped) return
            console.warn('Atelier: Analyse von', id, 'fehlgeschlagen.', error.message)
            store.saveAnalysis(id, { version: ANALYSIS_VERSION })
          }
        }
      }
    } catch (error) {
      if (!stopped) console.warn('Atelier: automatische Tags konnten nicht gespeichert werden.', error.message)
    } finally {
      running = false
      if (worker) { const closing = worker; worker = undefined; void closing.close().catch(error => console.warn('Atelier: temporäre Vision-Daten konnten nicht entfernt werden.', error.message)) }
    }
  }
  return {
    schedule() {
      if (stopped || running || timer) return
      timer = setTimeout(() => { timer = undefined; void drain() }, 600)
      timer.unref()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      if (worker) void worker.close().catch(error => console.warn('Atelier: temporäre Vision-Daten konnten nicht entfernt werden.', error.message))
    },
    /** Runs one pass now (tests, explicit re-analysis). */
    drain,
  }
}
