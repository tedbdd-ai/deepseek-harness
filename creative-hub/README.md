# Creativity Hub (Atelier)

Eine Creative-Notes-App als DeepSeek-Harness-Web-Overlay, aufgebaut wie Riley Browns „Native Note“:

- **Seitenleiste:** Home, Suche (⌘K), Neue Idee, Todo · **Ideen:** Alle Ideen, Kalender (nach Termin), Kanban (Status Idee → In Arbeit → Review → Fertig, Karten per Ziehen verschieben), Journal (ein Eintrag pro Tag), Feed (letzte Änderungen) · Angepinnt · **Apps:** Mymind (Links, Notizen, Uploads), Library (Bilder und Videos, mit Generieren-Leiste) und Excalidraw (alle Boards); mit ✓ blendest du Apps ein und aus.
- **Idee:** Titel, Tabs „Notiz“ (eingebettetes Excalidraw-Board und Text), je ein Tab pro App und „Details“ (Status, Termin, Format, Anpinnen). Welche Apps eine Idee mitbringt, legt ihr Format (Snapshot) fest, z. B. Musik-Session, Mode-Lookbook, Shoot oder VR-Konzept; „Einblenden“ fügt weitere hinzu.
- **Großansicht:** Klick auf ein Bild; dort „Freistellen“ und „Als Referenz“ für die Generieren-Leiste der Library.

Der Hub verwendet die Anmeldung des Harness-Webprofils und speichert alles in einer lokalen SQLite-Datei. Er ist für ein persönliches Harness-Profil mit einem Benutzer gedacht.

## Aufbau: Kern, Hub, Apps

| Plugin | Datei | Aufgabe |
| :--- | :--- | :--- |
| `creativity-core` | `core.mjs` | Öffnet die SQLite-Datei und stellt `creativeStore` (Ideen, App-Daten, Assets) und `creativeApps` (App-Registry und Snapshots) bereit. |
| `creativity-hub` | `host.mjs`, `web/` | Oberfläche und JSON-API unter `/creativity-hub`. |
| `creativity-app-<id>` | `apps/<id>/host.mjs` | Je eine App: `checklist`, `moodboard`, `light-plan`, `patch-sheet`. |

Snapshots stehen in `snapshots.mjs`. Am Eintrag `creativity-core` ersetzt `config.snapshots` die Standardliste. Ein Snapshot darf eine App nennen, die noch fehlt, z. B. `video-review` oder `vr-scene`. Die Idee zeigt dann einen Hinweis mit einem fertigen Auftrag für Claude oder Codex.

## Eine neue App bauen

1. Lege `apps/<id>/host.mjs` an: `export const { name, inject, apply } = defineApp({ id, title, icon, description }, import.meta.url)`. `icon` ist ein SVG-Pfad für ein 24×24-Strich-Icon.
2. Lege daneben `apps/<id>/block.js` an. Das ES-Modul exportiert `render(container, context)` und darf eine Aufräumfunktion zurückgeben.
3. `context` enthält `idea` (`id`, `title`), `data` (das gespeicherte JSON-Objekt dieser App für diese Idee, anfangs `{}`), `save(data)` (ersetzt die Daten, Revisionen verwaltet der Hub), `api(path, method, body)` für die Hub-API, `status(text)` und `ui` mit den Bausteinen `element`, `icon`, `iconButton`, `rowsEditor`, `assetMedia` und `assetTile` aus `web/ui.js`.
4. Starte den Hub neu. `start.command` bindet jeden Ordner unter `apps/` automatisch ein.

`apps/checklist` und `apps/patch-sheet` sind die kürzesten Vorlagen.

## Start auf dem Mac

Öffne `start.command` im Finder oder starte die Datei aus dem Terminal. Der Starter installiert beim ersten Mal die Abhängigkeiten, baut Excalidraw, startet das installierte Harness im Webmodus mit Kern, Hub und allen Apps und öffnet den Hub im Browser. Lass das Terminalfenster geöffnet, solange du den Hub nutzt.

## Manueller Start im Harness

1. Führe im Ordner `creative-hub` `npm install` und `npm run build` aus.
2. Kopiere `cordis.example.yml` als `cordis.local.yml` und setze die absoluten Pfade. Optional trägst du am Eintrag `creativity-core` unter `config.databasePath` einen eigenen Pfad ein. Standard ist `~/.creativity-hub/hub.sqlite`.
3. Starte `pnpm dsh web --patch ./creative-hub/cordis.local.yml` im gebauten Harness-Checkout oder übergib das Overlay der installierten dsh-CLI. Öffne `/creativity-hub`.

## MCP-Zugang für Claude Code und Codex

`mcp.mjs` ist ein MCP-Server über stdio. Er öffnet dieselbe SQLite-Datei wie `creativity-core` und funktioniert auch, wenn das Harness nicht läuft. Eine abweichende Datei setzt du mit `CREATIVITY_HUB_DB`. Für neue Ideen nutzt er die Standard-Snapshots aus `snapshots.mjs`.

```bash
claude mcp add --scope user creativity-hub -- node /Users/commander/SRC/deepseek-harness/creative-hub/mcp.mjs
```

Werkzeuge: `list_ideas`, `list_snapshots`, `get_idea` (mit den Daten aller Apps), `create_idea`, `update_idea` (Titel, Notizen, Board-Szene, Apps, Anpinnen, mit Revisionsprüfung), `set_app_data`, `search_assets`, `add_inspiration` und `assign_asset`.

## Anbieter (Bildmodelle, Freistellen, Bildsuche)

Jeder Anbieter ist ein Plugin unter `providers/<id>/host.mjs` und meldet sich bei `creativeProviders` (aus `core.mjs`, Beschreibung in `providers.mjs`) an. Ein Anbieter beschreibt seine Einstellungen (z. B. eine Adresse) und seine Schlüssel und bietet einige der Aktionen `models`, `generate`, `removeBackground` und `search` an. Der Hub speichert Einstellungen in der Datenbank und Schlüssel im Credential-Speicher des Harness (`ctx.credentials`) unter dem Namen, den das Plugin nennt. Ist kein Credential-Speicher geladen, liest er die gleichnamige Umgebungsvariable.

| Plugin | Kann | Schlüssel |
| :--- | :--- | :--- |
| `providers/litellm` | Modelle, Generieren über `/v1/chat/completions` mit Bild-Ausgabe | `LITELLM_API_KEY` |
| `providers/kie` | Generieren (Katalog in `providers/kie/models.mjs`: Nano Banana 2/2.1/Pro, GPT Image 2, Seedream 5.5, Flux 2 Pro, Grok Imagine 2), Freistellen (`recraft/remove-background`) | `KIE_API_KEY` |
| `providers/brave` | Bildsuche | `BRAVE_SEARCH_API_KEY` |

Eingerichtet wird alles im Hub unter **Anbieter**: Adresse eintragen, Schlüssel einfügen, speichern, „Modelle laden“. Der Hub legt Ergebnisse in der Library ab, mit Prompt, Modell, Anbieter und Referenzen in der Beschreibung. Ein neuer Anbieter ist ein neuer Ordner unter `providers/`; `start.command` bindet ihn automatisch ein, der Hub zeigt ihn ohne Änderung an.

Die API dazu: `GET /api/providers`, `PUT /api/providers/<id>` mit `{ settings, secrets }`, `GET /api/providers/<id>/models` sowie `POST /api/images/search`, `/api/images/generate` und `/api/images/remove-background`.


## Atelier Clipper (Safari, auch Chrome)

Die Erweiterung in `clipper/` sichert mit einem Klick direkt in Mymind, wahlweise zusätzlich in eine Ziel-Idee:

- Rechtsklick: **Bild ins Atelier** (die Bilddatei wird kopiert; AVIF/SVG werden zu PNG), **Seite ins Atelier** (Screenshot des sichtbaren Bereichs mit Titel, URL, Beschreibung bzw. Auswahl), **Auswahl ins Atelier**, **Link ins Atelier**.
- Symbol in der Leiste: Ziel-Idee wählen, **Seite sichern** und alle Bilder der Seite als Raster, ein Klick sichert ein Bild.
- Ein ✓ oder ! am Symbol meldet das Ergebnis; den letzten Fehler zeigt das Fenster des Symbols.

Sie schreibt über `/creativity-launcher/api/` mit dem Schlüssel aus `~/.creativity-hub/launcher-token`.

**Safari:** `safari/build.sh --install` baut die kleine Hüllen-App `Atelier Clipper` aus `clipper/` und installiert sie in `~/Applications`. In Safari: Einstellungen › Erweitert › „Funktionen für Webentwickler anzeigen“, dann Einstellungen › Entwickler › „Nicht signierte Erweiterungen erlauben“ (gilt bis Safari beendet wird), dann Einstellungen › Erweiterungen › Atelier Clipper einschalten und Zugriff auf alle Websites erlauben. Den Schlüssel liest die Hüllen-App selbst; ihre Sandbox erlaubt genau diese eine Datei. Nach Änderungen in `clipper/` erneut `safari/build.sh --install`.

**Chrome/Edge:** `clipper` als entpackte Erweiterung laden und in den Einstellungen der Erweiterung den Schlüssel eintragen (`pbcopy < ~/.creativity-hub/launcher-token`).

## Tests

```bash
node --test hub.test.mjs apps.test.mjs providers.test.mjs
```

Die macOS- und iOS-App für die Notizen selbst sind noch nicht implementiert.
