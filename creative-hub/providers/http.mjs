/** Fetch helpers shared by provider plugins. Every failure becomes a readable `ProviderError`. */
import { createHash } from 'node:crypto'
import { ProviderError } from '../providers.mjs'
import { mediaTypeOf } from '../store.mjs'

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
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout), redirect: 'follow' })
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

/** Downloads an http(s) or data URL into `{ mediaType, data }` (at most 12 MB, hub media types only). */
export async function download(service, url) {
  let data
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    data = Buffer.from(url.slice(comma + 1), url.slice(0, comma).includes(';base64') ? 'base64' : 'utf8')
  } else {
    data = Buffer.from(await (await request(service, url, { timeout: 120000 })).arrayBuffer())
  }
  const mediaType = mediaTypeOf(data)
  if (!mediaType || data.length > 12 * 1024 * 1024) throw new ProviderError(`${service} hat keine nutzbare Bild- oder Videodatei geliefert.`)
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
