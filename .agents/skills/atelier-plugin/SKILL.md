---
name: atelier-plugin
description: Use before adding or changing anything in creative-hub (the Atelier creativity hub): a new app or page, a media provider, a Playground feature or template, a store field, a hub route or the hub client. Keeps every capability a Cordis plugin on the hub's service seams, with reversible registrations, owned lifetimes and a plugin-owned browser module, and ends with a checklist and the tests to run.
---

# Atelier: everything is a plugin

The Atelier (`creative-hub/`) is a Cordis overlay for the Harness web profile. The hub is only a shell: sidebar, shared UI building blocks and the JSON API over the store. Every capability is a plugin that registers on a service seam and can be loaded, unloaded and replaced without editing the hub. Earlier single-purpose apps (Fit-Checker, Vercel Imager, the Styler repo) are folded in this way; build new ones the same way from the start.

Read first: [Cordis primer](../../../docs/cordis-primer.md) (five ideas, practical rules), `creative-hub/PRODUCT.md` (purpose, users, principles) and `creative-hub/DESIGN.md` (tokens, controls, patterns). For a lifecycle review afterwards use the `cordis-styling-nitpicking` skill.

## The seams

| Service | Owner | Use it to |
| --- | --- | --- |
| `creativeStore` | `core.mjs` | read and write ideas/projects, assets (`clips`, `generation`), project assignments and JSON settings by namespace (`store.settings(ns)`, `store.setSettings(ns, data)`) |
| `creativeApps` | `core.mjs` | register an app: `{ id, title, icon, module, description?, page?, view? }`; `page` adds it to the sidebar, `view` lets its module draw the whole view |
| `creativeProviders` | `core.mjs` + `providers.mjs` | register a media provider with settings, secrets (credential names) and actions `models`, `generate`, `removeBackground`, `search`, `resolveModels`, `runModel` |
| `webServer` | Harness | register a URL prefix with `auth: 'required'` for routes and browser modules |

A new capability picks the narrowest seam. Never import another plugin's module to reach its state; go through its service or its HTTP API.

## Which kind of plugin

- **Model or API vendor** → provider plugin `providers/<id>/host.mjs`. Declare `settings` and `secrets`; the registry stores settings in the hub and secrets in the Harness credential store. For the Playground implement `resolveModels(env, { url })` (read the vendor's published schema with `providers/schema.mjs`; never hand-code model fields) and `runModel(env, { variant, input, images })`. Throw `ProviderError` with a readable German message.
- **App with its own page** (Styler, future storyboard, lookbook …) → `apps/<id>/host.mjs` via `defineApp({ id, title, icon, page: true }, import.meta.url)` plus `apps/<id>/block.js` exporting `render(container, context)`. Further browser files beside it (`./prompts.mjs`) are served too; `host.mjs` never is. The context carries `el`, `api`, `media`, `withFullscreen`, `toast`, `refreshCounts`, `projects`, `params`.
- **Generation on top of the Playground** → do not build a second generator. Post a run to `/creativity-playground/api/runs` with `prompt` (using `@Bild1…` marks), `referenceIds`, `studio.roles`, `modelParams[modelId]`, a `title` for the results and a `template` id, then read `/runs` for the outcome. Model choice, parameters, history, errors and costs then work as in the Playground (see `apps/styler/block.js`).
- **A plugin with its own server logic and page** (like the Playground) → its own `host.mjs` that registers a `webServer` prefix for its API and its browser module, and a `creativeApps` entry with `page: true, view: true, module: '<prefix>/web.mjs'`. The hub hands `renderView(shared)` its building blocks and calls `leave()` on navigation.

## Rules

1. **Registrations are effects.** Every `register`, route, listener or timer goes through `ctx.effect(() => … return disposer)` or `ctx.on()`. Long-running work (provider jobs, polling) must stop writing once the plugin is disposed: keep a stopped flag or an `AbortController` and set it in an effect's disposer.
2. **No singletons.** State lives in the store (settings namespace named after the plugin, e.g. `playground:runs`) or in an object created inside `apply`. No module-level caches that outlive a plugin instance.
3. **Declare `inject`.** List every service the plugin needs; do not reach for `ctx.<service>` you did not inject.
4. **The hub stays generic.** Do not add app-specific code to `web/app.js`, `host.mjs` or `index.html`. If an app needs a shared building block, add it to the hub's shared context once and use it from the plugin. The sidebar lists plugin pages from `/api/apps`.
5. **Browser modules belong to their plugin** and are served by it (`defineApp` or the plugin's own prefix). They import only relative files of the same plugin.
6. **Writes are same-origin JSON.** Use `readBody` and `responder` from `http.mjs`; reject cross-site writes. Only the Clipper route `/creativity-launcher` takes a bearer token.
7. **Paid calls only on an explicit action** (Starten, Anprobieren). No retries, polling loops or background generation that spend credits on their own. Show costs only as the provider reports them.
8. **Honest UI.** German, Du-Form, controls name their action; no invented numbers; every view has loading, empty, "no results" and error states; provider errors become a sentence (see `explain()` in `playground/host.mjs`).
9. **Design system.** Use the tokens and classes from `DESIGN.md` (`.btn`, `.btn.primary` once per view, `.pill`, `.seg`, `.chip`, `.icon`; heights 44/36, radii 12/8). No new colours, emoji or Unicode glyph icons.
10. **Docs and tests move with the code.** Update the plugin's header comment, `README.md` when a seam or route changes, and add tests with `createHarness()` from `test-harness.mjs` (mount `core`, `host`, fakes for providers, then the plugin).

## Checklist before you finish

- [ ] The feature lives in its own plugin folder; the hub files changed only for a genuinely shared building block.
- [ ] Every registration and timer has a disposer; jobs stop writing after dispose.
- [ ] `inject` lists all services used; no module-level mutable state.
- [ ] Model inputs come from the provider's schema, parameters are stored per model and validated with `pickParams`.
- [ ] Paid calls happen only on an explicit user action.
- [ ] UI follows `DESIGN.md`; states and German copy are in place.
- [ ] `cd creative-hub && node --test hub.test.mjs apps.test.mjs providers.test.mjs playground.test.mjs` passes, and new behaviour has a test.
- [ ] `start.command` loads the plugin (providers, apps and the Playground are picked up from their folders).
- [ ] Checked in the browser on a test instance with a copy of the database (`databasePath` in the overlay), never against the live hub data for destructive steps.
