/**
 * In-process stand-in for the Harness context used by the hub tests: it records
 * `webServer` routes, `ctx.provide` services and `ctx.effect` disposers.
 */
import { Readable } from 'node:stream'

/** @returns {{ mount(plugin: object, config?: object): void, unmountAll(): void, request(method: string, path: string, body?: object, site?: string): Promise<{ status: number, result: any }>, json(method: string, path: string, body?: object, status?: number, site?: string): Promise<any>, routes: Map<string, object> }} */
export function createHarness() {
  const routes = new Map()
  const disposers = []
  const ctx = {
    webServer: { register(entry) { routes.set(entry.path, entry); return () => routes.delete(entry.path) } },
    effect(register) { disposers.push(register()) },
    provide(name, value) { ctx[name] = value; disposers.push(() => { delete ctx[name] }) },
    on() {},
    get(name) { return ctx[name] },
  }
  async function request(method, path, body, site = 'same-origin', headers = {}) {
    const route = [...routes.values()].filter(entry => path.startsWith(entry.path)).sort((a, b) => b.path.length - a.path.length)[0]
    if (!route) throw new Error('Keine Route für ' + path)
    const request = Readable.from(body ? [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))] : [])
    Object.assign(request, { method, url: path, headers: { 'content-type': 'application/json', 'sec-fetch-site': site, ...headers } })
    let status
    let result
    await route.handler(request, { setHeader() {}, writeHead(code) { status = code }, end(data) { result = data } })
    return { status, result }
  }
  return {
    routes,
    ctx,
    mount(plugin, config) {
      for (const service of plugin.inject ?? []) if (!(service in ctx)) throw new Error(`${plugin.name} braucht ${service}`)
      plugin.apply(ctx, config)
    },
    unmountAll() { while (disposers.length) disposers.pop()?.() },
    request,
    async json(method, path, body, status = 200, site, headers) {
      const response = await request(method, path, body, site, headers)
      if (response.status !== status) throw new Error(`${method} ${path}: ${response.status} ${response.result}`)
      return JSON.parse(response.result)
    },
  }
}
