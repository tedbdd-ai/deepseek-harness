/** Fetch helpers shared by provider plugins. Every failure becomes a readable `ProviderError`. */
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { ProviderError } from '../providers.mjs'
import { mediaLimit, mediaTypeOf } from '../store.mjs'

/**
 * @param {string} service name used in error messages.
 * @param {string | URL} url
 * @param {RequestInit & { timeout?: number }} options
 * @returns {Promise<Response>} an OK response.
 */
/** Readable reason for a failed connection, from the undici/Node error code. */
function connectFailure(cause) {
  switch (cause?.code) {
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'Der Name lässt sich nicht auflösen.'
    case 'UND_ERR_CONNECT_TIMEOUT': case 'ETIMEDOUT': return 'Verbindungsaufbau läuft in eine Zeitüberschreitung. Ist der Rechner im selben Netz bzw. Tailnet?'
    case 'ECONNREFUSED': return 'Auf diesem Port lauscht nichts.'
    case 'ECONNRESET': case 'UND_ERR_SOCKET': return 'Die Verbindung wurde abgebrochen.'
    default: return cause?.code?.startsWith('ERR_TLS') || /certificate|SSL/i.test(cause?.message ?? '') ? 'TLS-Zertifikat wird nicht akzeptiert.' : (cause?.message ?? 'Unbekannter Netzwerkfehler.')
  }
}

export async function request(service, url, { timeout = 120000, ...options } = {}) {
  let response
  try {
    response = await fetch(url, { redirect: 'follow', ...options, signal: AbortSignal.timeout(timeout) })
  } catch (error) {
    throw new ProviderError(error.name === 'TimeoutError' ? `${service} hat nicht rechtzeitig geantwortet.` : `${service} ist nicht erreichbar (${new URL(url).host}): ${connectFailure(error.cause)}`)
  }
  if (response.status === 429) throw new ProviderError(`${service} meldet 429: Kontingent erschöpft. Kurz warten und erneut versuchen.`, 429)
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new ProviderError(`${service} antwortet mit HTTP ${response.status}. ${detail}`.trim())
  }
  return response
}

/** Downloads an http(s) or data URL into `{ mediaType, data }` (bounded by the hub media limits). */
export async function download(service, url, expectedType, { limit = mediaLimit(expectedType) } = {}) {
  let data
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    data = Buffer.from(url.slice(comma + 1), url.slice(0, comma).includes(';base64') ? 'base64' : 'utf8')
  } else {
    const response = await request(service, url, { timeout: 120000 })
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > limit) throw new ProviderError(`${service} hat eine zu große Datei geliefert.`)
      chunks.push(chunk)
    }
    data = Buffer.concat(chunks, size)
  }
  const mediaType = mediaTypeOf(data)
  if (!mediaType || data.length > limit || (expectedType ? mediaType !== expectedType : mediaType === 'model/gltf-binary')) throw new ProviderError(`${service} hat keine nutzbare Mediendatei geliefert.`)
  return { mediaType, data }
}

export const dataUrl = file => `data:${file.mediaType};base64,${file.data.toString('base64')}`

/**
 * Hash of an image's pixel data, ignoring metadata: PNG IHDR and IDAT chunks, JPEG from the first
 * start-of-scan marker, other formats in full. Copies that differ only in metadata (e.g. a C2PA
 * manifest per copy, as Gemini adds) get the same fingerprint.
 * @param {Buffer} data image bytes.
 * @returns {string} hex SHA-256.
 */
export function imageFingerprint(data) {
  const hash = createHash('sha256')
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    for (let offset = 8; offset + 12 <= data.length;) {
      const length = data.readUInt32BE(offset)
      const type = data.toString('ascii', offset + 4, offset + 8)
      if (type === 'IHDR' || type === 'IDAT') hash.update(data.subarray(offset + 8, offset + 8 + length))
      offset += 12 + length
    }
    return hash.digest('hex')
  }
  const scan = data[0] === 0xff && data[1] === 0xd8 ? data.indexOf(Buffer.from([0xff, 0xda])) : -1
  return hash.update(scan > 0 ? data.subarray(scan) : data).digest('hex')
}

/**
 * A 32×32 grayscale thumbnail of an 8-bit RGB/RGBA PNG, or `null` for other formats.
 * @param {Buffer} data image bytes.
 * @returns {{ width: number, height: number, cells: Float64Array } | null}
 */
function pngThumbnail(data) {
  if (!data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0
  const parts = []
  for (let offset = 8; offset + 12 <= data.length;) {
    const length = data.readUInt32BE(offset)
    const name = data.toString('ascii', offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12] }
    if (name === 'IDAT') parts.push(body)
    offset += 12 + length
  }
  const channels = type === 2 ? 3 : type === 6 ? 4 : 0
  if (depth !== 8 || !channels || interlace || !width || !height) return null
  let raw
  try { raw = inflateSync(Buffer.concat(parts)) } catch { return null /* Beschädigte Bilddaten: nur exakter Vergleich. */ }
  const stride = width * channels
  if (raw.length < (stride + 1) * height) return null
  const size = 32
  const cells = new Float64Array(size * size)
  const counts = new Uint32Array(size * size)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0
      const up = previous[i]
      const corner = i >= channels ? previous[i - channels] : 0
      let add = 0
      if (filter === 1) add = left
      else if (filter === 2) add = up
      else if (filter === 3) add = (left + up) >> 1
      else if (filter === 4) { const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner); add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner }
      line[i] = (line[i] + add) & 255
    }
    const row = Math.min(size - 1, Math.floor(y * size / height))
    for (let x = 0; x < width; x++) {
      const cell = row * size + Math.min(size - 1, Math.floor(x * size / width))
      const i = x * channels
      cells[cell] += (line[i] * 299 + line[i + 1] * 587 + line[i + 2] * 114) / 1000
      counts[cell]++
    }
    previous = line
  }
  for (let i = 0; i < cells.length; i++) cells[i] /= counts[i] || 1
  return { width, height, cells }
}

/**
 * Whether two image files show the same picture: identical pixels, or for PNGs a difference below
 * one brightness level on average at 32×32 (Gemini behind LiteLLM returns re-encoded copies whose
 * pixels differ slightly).
 * @param {Buffer} a image bytes.
 * @param {Buffer} b image bytes.
 * @returns {boolean}
 */
export function sameImage(a, b) {
  if (imageFingerprint(a) === imageFingerprint(b)) return true
  const x = pngThumbnail(a)
  const y = pngThumbnail(b)
  if (!x || !y || x.width !== y.width || x.height !== y.height) return false
  let total = 0
  for (let i = 0; i < x.cells.length; i++) total += Math.abs(x.cells[i] - y.cells[i])
  return total / x.cells.length < 1
}
