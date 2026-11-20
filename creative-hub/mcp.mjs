#!/usr/bin/env node
/**
 * Stdio MCP server over the Creativity Hub SQLite store, for Claude Code, Codex
 * and other MCP clients. It opens the same database file as the `creativity-core`
 * plugin (WAL mode), so it works whether or not the Harness is running.
 *
 * Database path: `CREATIVITY_HUB_DB`, default `~/.creativity-hub/hub.sqlite`.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { defaultSnapshots } from './snapshots.mjs'
import { InputError, openStore } from './store.mjs'

const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })

/**
 * Wraps a store call so `InputError` becomes a tool error the model can read.
 * @param {(args: any) => unknown} run
 */
const tool = run => async args => {
  try {
    return reply(await run(args))
  } catch (error) {
    if (error instanceof InputError) return { isError: true, content: [{ type: 'text', text: error.message }] }
    throw error
  }
}

/**
 * Registers the hub tools on an MCP server.
 * @param {McpServer} server
 * @param {ReturnType<typeof openStore>} store
 */
export function registerTools(server, store) {
  const snapshotIds = defaultSnapshots.map(snapshot => snapshot.id)
  server.registerTool('list_ideas', {
    description: 'Lists all Creativity Hub ideas with id, title, notes, snapshot, enabled app ids, pinned flag and asset count.',
  }, tool(() => store.projects()))
  server.registerTool('list_snapshots', {
    description: 'Lists the snapshots (idea templates) and the app ids each one enables.',
  }, tool(() => defaultSnapshots))
  server.registerTool('get_idea', {
    description: 'Returns one idea including notes, revision, enabled apps, its Excalidraw board scene and the data of every enabled app.',
    inputSchema: { id: z.string() },
  }, tool(({ id }) => {
    const idea = store.project(id)
    return { ...idea, appData: Object.fromEntries(idea.apps.map(app => [app, store.appData(id, app)])) }
  }))
  server.registerTool('create_idea', {
    description: 'Creates an idea from a snapshot; the snapshot decides the initially enabled apps.',
    inputSchema: { title: z.string(), snapshot: z.enum(snapshotIds).default('blank'), notes: z.string().optional() },
  }, tool(({ title, snapshot, notes }) => {
    const template = defaultSnapshots.find(item => item.id === snapshot)
    return store.createProject({ title, notes, snapshot, apps: template.apps })
  }))
  server.registerTool('update_idea', {
    description: 'Changes title, notes, Excalidraw scene, enabled app ids, pinned flag, Kanban status or due date of an idea. Pass the revision from get_idea; a stale revision fails with a conflict.',
    inputSchema: {
      id: z.string(), revision: z.number().int(), title: z.string().optional(), notes: z.string().optional(),
      apps: z.array(z.string()).optional(), pinned: z.boolean().optional(),
      status: z.enum(['idee', 'arbeit', 'review', 'fertig']).optional().describe('Kanban column: idee, arbeit (in progress), review, fertig (done).'),
      due: z.string().optional().describe('Due date YYYY-MM-DD, or empty to clear; shown in the calendar.'),
      scene: z.object({ elements: z.array(z.any()), files: z.record(z.string(), z.any()) }).optional(),
    },
  }, tool(({ id, ...body }) => store.updateProject(id, body)))
  server.registerTool('read_journal', {
    description: 'Lists journal entries (day YYYY-MM-DD, text), newest first.',
    inputSchema: {},
  }, tool(() => store.journal()))
  server.registerTool('write_journal', {
    description: 'Replaces the journal entry of one day (YYYY-MM-DD). Read it first and append to keep existing text; an empty text deletes the entry.',
    inputSchema: { day: z.string(), text: z.string() },
  }, tool(({ day, text }) => store.setJournal(day, { text })))
  server.registerTool('recent_activity', {
    description: 'The hub feed: newest idea changes, saved assets and journal entries.',
    inputSchema: {},
  }, tool(() => store.feed()))
  server.registerTool('set_app_data', {
    description: 'Replaces the data one app stores for an idea (for example checklist {items:[{text,done}]}, patch-sheet {rows:[{device,patch,notes}]}, light-plan {rows:[{light,position,setting}],camera}). Pass the revision from get_idea appData; 0 when the app has no data yet.',
    inputSchema: { id: z.string(), app: z.string(), revision: z.number().int(), data: z.record(z.string(), z.any()) },
  }, tool(({ id, app, revision, data }) => store.setAppData(id, app, { revision, data })))
  server.registerTool('search_assets', {
    description: 'Searches Inspiration (library "clips") and Library (library "generation"). The query understands tag words and synonyms ("latex neon outdoor" becomes the tags Latex, Neon, Outdoor plus free text); tags are tag ids from list_tags, e.g. "mode:latex". Empty filters match everything; ideaId limits to assets of one idea. Discarded assets are hidden unless rating is "all" or "-1".',
    inputSchema: {
      query: z.string().optional(), library: z.enum(['clips', 'generation']).optional(), ideaId: z.string().optional(),
      tags: z.array(z.string()).optional(), rating: z.enum(['all', '1', '-1']).optional(), limit: z.number().int().min(1).max(200).optional(),
    },
  }, tool(({ query = '', library = '', ideaId = '', tags = [], rating = '', limit = 50 }) => {
    const { items } = store.search({ q: query, library, project: ideaId, tags, rating, limit })
    return items.map(({ id, library, title, source, description, tagList }) => ({ id, library, title, source, description: description.slice(0, 300), tags: tagList.map(tag => `${tag.facet}:${tag.name}${tag.state === 'vorschlag' ? '?' : ''}`) }))
  }))
  server.registerTool('list_tags', {
    description: 'Lists the tag vocabulary by facet (art, motiv, mode, ort, licht, kamera, farbe, quelle, modell, frei) with tag ids, synonyms and usage counts.',
    inputSchema: {},
  }, tool(() => store.tagVocabulary().map(facet => ({ facet: facet.id, name: facet.name, tags: facet.tags.map(({ id, name, aliases, count }) => ({ id, name, aliases, count })) }))))
  server.registerTool('tag_assets', {
    description: 'Confirms (state "bestaetigt"), rejects ("abgelehnt") or removes ("entfernt") tags on assets. Use tag ids from list_tags; unknown names can be created in facet "frei" with the name argument.',
    inputSchema: { ids: z.array(z.string()).min(1).max(200), tags: z.array(z.string()).optional(), newTags: z.array(z.string()).optional(), state: z.enum(['bestaetigt', 'abgelehnt', 'entfernt']).optional() },
  }, tool(({ ids, tags = [], newTags = [], state = 'bestaetigt' }) => {
    const tagIds = [...tags, ...newTags.map(name => store.resolveTag(name, { create: true }))]
    if (!tagIds.length) throw new Error('Gib tags oder newTags an.')
    return store.setTagState({ assetIds: ids, tagIds, state })
  }))
  server.registerTool('add_inspiration', {
    description: 'Saves an inspiration: a web link (source) and/or a text note (description), optionally into an idea.',
    inputSchema: {
      title: z.string(), source: z.string().url().optional(), preview: z.string().url().optional(),
      description: z.string().optional(), ideaId: z.string().optional(),
    },
  }, tool(({ ideaId, ...args }) => store.createAsset({ ...args, library: 'clips', projectId: ideaId })))
  server.registerTool('assign_asset', {
    description: 'Adds an existing inspiration or library asset to an idea (it then shows in the idea and can be placed on its Flows canvas).',
    inputSchema: { id: z.string(), ideaId: z.string() },
  }, tool(({ id, ideaId }) => store.assign(id, ideaId)))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = openStore(process.env.CREATIVITY_HUB_DB || join(homedir(), process.env.ATELIER_INSTANCE === 'nsfw' ? '.creativity-hub-nsfw' : '.creativity-hub', 'hub.sqlite'))
  const server = new McpServer({ name: 'creativity-hub', version: '0.1.0' })
  registerTools(server, store)
  await server.connect(new StdioServerTransport())
}
