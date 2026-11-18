/**
 * HTTP helpers shared by the hub and board plugins. Routes using them are
 * registered with `auth: 'required'` on the Harness web server.
 */
import { InputError } from './store.mjs'

/**
 * Reads a same-origin JSON object body of at most 18 MB.
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 * @throws {InputError} 403 for cross-site writes, 415 without JSON, 413 when too large, 400 for invalid JSON.
 */
export async function readBody(request) {
  if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') {
    throw new InputError('Schreibzugriff aus dieser Quelle ist gesperrt.', 403)
  }
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new InputError('JSON erwartet.', 415)
  }
  let size = 0
  const chunks = []
  for await (const part of request.iterator({ destroyOnReturn: false })) {
    size += part.length
    if (size > 18 * 1024 * 1024) throw new InputError('Anfrage zu groß.', 413)
    chunks.push(part)
  }
  let data
  try { data = JSON.parse(Buffer.concat(chunks)) } catch { throw new InputError('Ungültiges JSON.') }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new InputError('JSON-Objekt erwartet.')
  return data
}

/**
 * Sets no-store and no-sniff headers and returns response writers.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {{ send(status: number, contentType: string, body?: string | Buffer): void, json(body: unknown, status?: number): void }}
 */
export function responder(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  const send = (status, contentType, body) => {
    res.writeHead(status, { 'Content-Type': contentType })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
  return { send, json: (body, status = 200) => send(status, 'application/json; charset=utf-8', JSON.stringify(body)) }
}
