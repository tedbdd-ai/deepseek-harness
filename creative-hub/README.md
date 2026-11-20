# Creativity Hub (Atelier)

Dein persönlicher Kreativ-Hub als DeepSeek-Harness-Web-Overlay, dunkel und im Aufbau einer Mac-App (Entwurf „Atelier Hub“):

- **Seitenleiste:** Suche (⌘K), Sammlung, Foto Playground, Video Playground, deine Projekte und unten Anbieter.
- **Sammlung:** alles, was du mit dem Clipper oder per Link sicherst, gefiltert nach Bildern, Videos, Webseiten und Notizen. Bilder und Videos lassen sich hineinziehen. Ein Bild aus der Zwischenablage speicherst du in der Sammlung mit ⌘V (Mac) oder Strg+V. Vorhandene und neue Einträge bekommen automatisch Tag-Vorschläge. Die Analyse läuft lokal und kostenlos (Apple Vision auf dem Mac, Prompt-Text, Quelle, Modell). Du übernimmst oder lehnst Vorschläge ab, filterst über die Filterleiste nach Gruppen (Art, Motiv, Mode, Ort, Licht und Stimmung, Kamera, Farbe, Quelle, Modell) und setzt Tags in den Details oder in der Mehrfachauswahl für viele Einträge zugleich. „Mit KI verschlagworten“ ist kostenpflichtig und läuft nur auf Klick. In den Details stehen Dateigröße und bei Bildern und Videos die Auflösung. „Verkleinern“ ersetzt die Datei durch eine kleinere Version, „Zuschneiden“ speichert den gewählten Bildausschnitt. Zum Komprimieren von Videos braucht Atelier FFmpeg. Rechts stehen Quelle, Projekte (zum An- und Abwählen), „Original öffnen“, Herunterladen und Löschen.
- **Library:** alle generierten Bilder. Die Ergebnisse eines Laufs liegen als Stapel zusammen; Favorit und Aussortiert blenden Ausschuss aus. Filterbar wie die Sammlung, mit Prompt, Modell, Referenzen, Freistellen und Herunterladen. „Ähnliche finden“ nutzt den Feature-Print der Bildanalyse.
- **Suche, Tags, Sortieren:** Die Suche versteht Tag-Wörter und Synonyme („latex neon außen“ wird zu Filtern), gespeicherte Suchen stehen unter „Sammlungen“. Unter „Tags“ pflegst du Gruppen, Namen und Synonyme, unter „Sortieren“ gehst du neue Einträge per Tastatur durch (Enter übernimmt, F Favorit, X aussortiert, T Tag, 1–9 Projekt).
- **Projekt:** alles, was einem Projekt zugeordnet ist.
- **Foto Playground** (Plugin `playground/host.mjs`): links Eingabe und Referenzen, rechts Vorschau und Bildverlauf. Modelle per Adresse ihrer Seite bei kie.ai oder fal.ai hinzufügen; der Anbieter liest die veröffentlichte Eingabebeschreibung, der Playground baut daraus Einstellungen und wählt mit Referenzbild die Bearbeiten-Variante. Das Prompt-Feld lässt sich in der Höhe aufziehen. Ein Prompt geht an mehrere Modelle (1×, 2× oder 4× je Modell); jedes Ergebnis landet in der Library, auf Wunsch im Ziel-Projekt. Ergebnisse lassen sich ins Projekt legen, als Referenz nutzen, variieren und herunterladen. Ein Lauf kann direkt mit Referenzbildern und leerem Textfeld starten. Scrabble verbindet auf Klick Stichworte zu einem kurzen Bildprompt. Im NSFW-Playground kannst du Referenzen als Person, Kleidung, Pose oder Umgebung zuweisen und das Aussehen fest vorgeben. Scrabble formuliert aus den Stichworten den Szenenentwurf. Über 10 MB große Bildreferenzen werden für den HotAPI-Upload verkleinert. Bei 2× und 4× wird derselbe Prompt je Modell mehrfach gesendet. Unter **Anbieter → LiteLLM** kannst du dafür ein Textmodell mit Bildeingabe hinterlegen.
- **Video Playground** ist das Videostudio für Seedance 2.5 Flash und Kling 2.6 über Kie.ai. Text, Keyframes, multimodale Referenzen und Audio haben eigene Eingaben. Fertige Clips stehen in der Vorschau, im Render-Verlauf und in der Library und lassen sich einem Projekt zuordnen. Die Timeline zeigt mit FFmpeg und FFprobe echte Einzelbilder und die gemischte Tonspur. **Verlängern** verwendet den gewählten Render als Ausgangsclip und fügt die Fortsetzung lokal an. Jeder Klick auf **Kostenpflichtig starten** reicht einen Auftrag bei Kie.ai ein.

Der Hub verwendet die Anmeldung des Harness-Webprofils und speichert alles in einer lokalen SQLite-Datei. Er ist für ein persönliches Harness-Profil mit einem Benutzer gedacht.

## Aufbau: Kern, Hub, Apps

| Plugin | Datei | Aufgabe |
| :--- | :--- | :--- |
| `creativity-core` | `core.mjs` | Öffnet die SQLite-Datei und stellt `creativeStore` (Ideen, App-Daten, Assets) `creativeApps` (App-Registry und Snapshots), `creativeProviders` (Anbieter) und `creativeNodes` (Knotenarten für Flows) bereit. |
| `creativity-hub` | `host.mjs`, `web/` | Oberfläche und JSON-API unter `/creativity-hub`. |
| `creativity-app-<id>` | `apps/<id>/host.mjs` | Je eine App: `flows` (Canvas für Moodboard, Storyboard und KI-Knoten), `schnitt` (Zeitleiste und Export per ffmpeg), `styler`, `influencer-video`. `checklist`, `light-plan` und `patch-sheet` nutzen noch die alte Schnittstelle und werden nicht angezeigt. |

Snapshots stehen in `snapshots.mjs`. Am Eintrag `creativity-core` ersetzt `config.snapshots` die Standardliste. Ein Snapshot darf eine App nennen, die noch fehlt, z. B. `video-review` oder `vr-scene`. Die Idee zeigt dann einen Hinweis mit einem fertigen Auftrag für Claude oder Codex.

## Eine neue App bauen

Vor jeder neuen Funktion gilt der Skill `atelier-plugin` (`.agents/skills/atelier-plugin/SKILL.md`): welche Schnittstelle, welche Art Plugin, die Regeln für Effekte, Lebensdauer, Browser-Module, bezahlte Aufrufe und Design, dazu die Prüfliste.

1. Lege `apps/<id>/host.mjs` an: `export const { name, inject, apply } = defineApp({ id, title, icon, description }, import.meta.url)`. `icon` ist ein SVG-Pfad für ein 24×24-Strich-Icon.
2. Lege daneben `apps/<id>/block.js` an. Das ES-Modul exportiert `render(container, context)` und darf eine Aufräumfunktion zurückgeben.
3. `context` enthält `idea` (`id`, `title`), `data` (das gespeicherte JSON-Objekt dieser App für diese Idee, anfangs `{}`), `save(data)` (ersetzt die Daten, Revisionen verwaltet der Hub), `api(path, method, body)` für die Hub-API, `status(text)` und `ui` mit den Bausteinen `element`, `icon`, `iconButton`, `rowsEditor`, `assetMedia` und `assetTile` aus `web/ui.js`.
4. Starte den Hub neu. `start.command` bindet jeden Ordner unter `apps/` automatisch ein.

`apps/checklist` und `apps/patch-sheet` sind die kürzesten Vorlagen.

## Start auf dem Mac

Öffne `start.command` im Finder oder starte die Datei aus dem Terminal. Der Starter installiert beim ersten Mal die Abhängigkeiten, baut Excalidraw, startet das installierte Harness im Webmodus mit Kern, Hub und allen Apps und öffnet den Hub im Browser. Lass das Terminalfenster geöffnet, solange du den Hub nutzt.

### Getrenntes NSFW-Atelier

Starte das Standard-Atelier mit `./start.command` und das NSFW-Atelier in einem zweiten Terminal mit `./start.command nsfw`. Beide Prozesse können parallel laufen. Über den Instanzwechsel unten in der Seitenleiste öffnest du die Sammlung des anderen Ateliers. Standard verwendet Port 3080, NSFW Port 3081.

Das NSFW-Atelier legt Sammlung, Library, Projekte, Modellkonfigurationen und Aufträge in `~/.creativity-hub-nsfw/hub.sqlite` ab. Der Harness hat ein eigenes Home unter `~/.creativity-hub-nsfw/harness`. Anbieter-Schlüssel werden dort unter Namen mit dem Präfix `NSFW_` eingerichtet. Für einen getrennten MCP-Prozess setze `ATELIER_INSTANCE=nsfw` und lass `CREATIVITY_HUB_DB` ungesetzt.

## Manueller Start im Harness

1. Führe im Ordner `creative-hub` `npm install` und `npm run build` aus.
2. Kopiere `cordis.example.yml` als `cordis.local.yml` und setze die absoluten Pfade. Optional trägst du am Eintrag `creativity-core` unter `config.databasePath` einen eigenen Pfad ein. Standard ist `~/.creativity-hub/hub.sqlite`.
3. Starte `pnpm dsh web --patch ./creative-hub/cordis.local.yml` im gebauten Harness-Checkout oder übergib das Overlay der installierten dsh-CLI. Öffne `/creativity-hub`.

## MCP-Zugang für Claude Code und Codex

`mcp.mjs` ist ein MCP-Server über stdio. Er öffnet dieselbe SQLite-Datei wie `creativity-core` und funktioniert auch, wenn das Harness nicht läuft. Eine abweichende Datei setzt du mit `CREATIVITY_HUB_DB`. Für neue Ideen nutzt er die Standard-Snapshots aus `snapshots.mjs`.

```bash
claude mcp add --scope user creativity-hub -- node /Users/commander/SRC/deepseek-harness/creative-hub/mcp.mjs
```

Werkzeuge: `list_ideas`, `list_snapshots`, `get_idea` (mit den Daten aller Apps), `create_idea`, `update_idea` (Titel, Notizen, Board-Szene, Apps, Anpinnen, mit Revisionsprüfung), `set_app_data`, `search_assets` (versteht Tag-Wörter, Filter `tags`, `rating`), `list_tags`, `tag_assets`, `add_inspiration` und `assign_asset`.

## Tags und Suche (API)

Tabellen: `tags` (Gruppe, Name), `tag_aliases` (Synonyme), `asset_tags` (Herkunft `vision`/`text`/`meta`/`ki`/`nutzer`, Zustand `vorschlag`/`bestaetigt`/`abgelehnt`), `asset_analysis` (Farben, Feature-Print, erkannter Text, Labels) und der FTS5-Index `asset_search`. Maschinen überschreiben nie eine Entscheidung des Nutzers. Die alten Spalten `assets.tags` und `tag_source` werden mitgeschrieben.

Routen unter `/creativity-hub/api`: `GET /search?q&library&project&tags&exclude&colors&rating&untagged&suggestions&unreviewed&stack&run&sort&limit&cursor` (liefert `items`, `facets` mit Zahlen, `total`, `chips`), `GET /tags`, `POST /tags`, `PUT|DELETE /tags/:id`, `POST /tags/:id/merge`, `GET /assets/tags?ids`, `POST /assets/tag-state|accept-suggestions|rating|reviewed|ai-tags`, `GET /assets/:id/similar|analysis`, `GET|PUT /saved-searches`. `POST /assets/ai-tags` ist die einzige kostenpflichtige Tag-Quelle; sie braucht einen Anbieter mit `chatImages: true`.

Die Analyse (`asset-analysis.mjs`, `clip-vision.swift`) läuft für alle Bilder und Videos im Hintergrund; `analysis.labelThreshold` in der Plugin-Konfiguration von `creativity-hub` setzt die Mindestsicherheit für Vision-Labels (0.05–0.95).

## Flows (Knoten-Canvas)

Unter „Flows“ hat jedes Projekt eine Fläche, auf der Board-Elemente (wie bei Milanote und Miro) und KI-Schritte als Knoten liegen und mit Linien verbunden werden, ähnlich wie bei ElevenLabs Flows. Sie ersetzt die früheren Apps Moodboard und Storyboard; ein leerer Flow bietet an, deren gespeicherte Inhalte als Rahmen zu übernehmen. Konzept und Phasen: `plans/2026-11-20-flows-canvas.md`.

- **Knotenarten sind Plugins.** Ein Plugin meldet seine Knotenart bei `creativeNodes` an (Beschreibung in `core.mjs`). Flows liefert die Board-Knoten Notiz, Datei, Szene, Farbe, Link und Rahmen (gibt alles darin weiter). Der Foto Playground liefert „Bild“, „Charakterblatt“ (Referenzblatt in vier Feldern auf Studiograu) und „Set“ (Ort ohne Figuren), der Video Playground „Video“ (Seedance, Kling, mit Warnungen zu Startbild und Tonlänge), Schnitt „Komposition“ und „Ton als Video“ (beide FFmpeg, kostenlos). Reine Knoten-Plugins liegen unter `nodes/<id>/host.mjs` (`start.command` lädt sie wie Apps), etwa `nodes/llm`: „LLM“ schreibt Text mit einem Chat-Anbieter und liest dabei Bilder, Videos und Ton, z. B. für ein Transkript mit Zeitstempeln.
- **Ports** haben die Typen Text, Bild, Video und Ton, und verbunden werden nur gleiche Typen. Mehrere Linien an einem Eingang zählen in Leserichtung.
- **Referenzen:** Jeder Knoten hat einen Namen. Im Prompt nennt `@Name` einen verbundenen Knoten; beim Ausführen wird daraus die Marke des Modells (`@Bild1` im Foto Playground, `@Image1`, `@Video1`, `@Audio1` bei Seedance). Die Marken stehen als Chips am Knoten. Notizen dürfen `@Name` enthalten, aufgelöst wird beim Empfänger.
- **Technik:** Die Fläche ist [React Flow](https://reactflow.dev) mit Sub-Flows für Rahmen, `NodeToolbar`, `NodeResizer`, `Panel`, `MiniMap` und animierten Linien. Die Knotenteile kommen von [React Flow UI](https://reactflow.dev/ui) (BaseNode, BaseHandle, NodeStatusIndicator), Menüs und Dialoge von shadcn (cmdk Command, Radix Popover und Dialog), die Icons von Lucide. Die Bausteine liegen nach shadcn-Art in `apps/flows/ui/components` (`components.json`, neue mit `npx shadcn@latest add …`). Tailwind gilt nur im Flows-Bundle, ohne Preflight, und ist in `apps/flows/ui/flows.css` auf die Hub-Tokens gemappt. Die Grundregeln für Elemente in `web/app.css` liegen in `@layer base`, damit Klassen sie überstimmen. Ein Test verhindert Klassennamen, die der Hub selbst definiert (etwa `.grid`; im Editor heißt es `[display:grid]`).
- **Vorlagen** (`apps/flows/engine/templates.mjs`): „Kurzfilm mit sprechender Figur“ legt sechs Rahmen von links nach rechts an (Moodboard, Storyboard, Figur und Set, Stimme, Videos, Schnitt), dazu gibt es Teilvorlagen. Datei-Knoten füllen sich beim Einfügen mit passenden Bildern aus der Sammlung, zuerst aus dem Projekt. Oben springt man per Chip zu jedem Rahmen. Beim Einfügen läuft nichts.
- **Ports anklicken:** Ein Klick auf einen Ein- oder Ausgang zeigt die passenden Knoten; an Bild-, Video- und Toneingängen auch „Hochladen“ und „Aus Sammlung und Library“. Der neue Knoten liegt daneben und ist schon verbunden.
- **Einfügen und Hineinziehen:** Bilder, Videos und Ton (MP3, WAV) landen in der Sammlung und als Datei-Knoten, eingefügter Text als Notiz, eine Adresse als Link.
- **Ausführen** startet einen Knoten nur auf Klick. „Mit fehlenden Schritten davor“ und „Ab hier alles danach“ fragen nach, sobald mehr als ein kostenpflichtiger Knoten läuft. Ändern sich die Eingaben, zeigt ein Ergebnis „Veraltet“. Die Ergebnisse landen in der Library und im Projekt, und die Läufe stehen weiter im Verlauf der Playgrounds.
- **Speicher:** Der Flow liegt in `app_data(flow)`, der Laufzustand im Setting `flows:state:<projekt>`. Die Routen stehen im Kopf von `apps/flows/host.mjs`.

## Anbieter (Bildmodelle, Freistellen, Bildsuche)

Jeder Anbieter ist ein Plugin unter `providers/<id>/host.mjs` und meldet sich bei `creativeProviders` (aus `core.mjs`, Beschreibung in `providers.mjs`) an. Ein Anbieter beschreibt seine Einstellungen (z. B. eine Adresse) und seine Schlüssel und bietet einige der Aktionen `models`, `generate`, `removeBackground` und `search` an. Der Hub speichert Einstellungen in der Datenbank und Schlüssel im Credential-Speicher des Harness (`ctx.credentials`) unter dem Namen, den das Plugin nennt. Ist kein Credential-Speicher geladen, liest er die gleichnamige Umgebungsvariable.

| Plugin | Kann | Schlüssel |
| :--- | :--- | :--- |
| `providers/litellm` | Modelle, Bildgenerierung und Scrabble-Szenen über `/v1/chat/completions` | `LITELLM_API_KEY` |
| `providers/kie` | Generieren (Katalog in `providers/kie/models.mjs`: Nano Banana 2/2.1/Pro, GPT Image 2, GPT Image 2.5 Sunburst/Flare, Seedream 5.5, Flux 2 Pro, Grok Imagine 2), Freistellen (`recraft/remove-background`) | `KIE_API_KEY` |
| `providers/brave` | Bildsuche | `BRAVE_SEARCH_API_KEY` |
| `providers/fal` | Playground-Modelle von fal.ai (Queue-API) | `FAL_KEY` |
| `providers/hotapi` | NSFW-Instanz: Z-Image Spicy, Qwen Image Edit Spicy und Seedance 2.5 Spicy | `NSFW_HOTAPI_KEY` |
| `providers/abliteration` | NSFW-Instanz: Textmodell für Scrabble und Video-Prompt-Verbesserung | `NSFW_ABLIT_KEY` |

Eingerichtet wird alles im Hub unter **Anbieter**: Adresse eintragen, Schlüssel einfügen, speichern, „Modelle laden“. Der Hub legt Ergebnisse in der Library ab, mit Prompt, Modell, Anbieter und Referenzen in der Beschreibung. Ein neuer Anbieter ist ein neuer Ordner unter `providers/`; `start.command` bindet ihn automatisch ein, der Hub zeigt ihn ohne Änderung an.

Die API dazu: `GET /api/providers`, `PUT /api/providers/<id>` mit `{ settings, secrets }`, `GET /api/providers/<id>/models` sowie `POST /api/images/search`, `/api/images/generate` und `/api/images/remove-background`.


## Atelier Clipper (Safari, auch Chrome)

Die Erweiterung in `clipper/` sichert mit einem Klick direkt in Mymind, wahlweise zusätzlich in eine Ziel-Idee:

- Rechtsklick: **Bild ins Atelier** (die Bilddatei wird kopiert; AVIF/SVG werden zu PNG), **Seite ins Atelier** (Screenshot des sichtbaren Bereichs mit Titel, URL, Beschreibung bzw. Auswahl), **Auswahl ins Atelier**, **Link ins Atelier**.
- Symbol in der Leiste: Ziel-Idee wählen, **Seite sichern** und alle Bilder der Seite als Raster, ein Klick sichert ein Bild.
- Ein ✓ oder ! am Symbol meldet das Ergebnis; den letzten Fehler zeigt das Fenster des Symbols.

Sie schreibt über `/creativity-launcher/api/` mit dem Schlüssel aus `~/.creativity-hub/launcher-token`.

**Safari:** `safari/build.sh --install` baut die kleine Hüllen-App `Atelier Clipper` aus `clipper/` und installiert sie in `~/Applications`. In Safari: Einstellungen › Erweitert › „Funktionen für Webentwickler anzeigen“, dann Einstellungen › Entwickler › „Nicht signierte Erweiterungen erlauben“ (gilt bis Safari beendet wird), dann Einstellungen › Erweiterungen › Atelier Clipper einschalten und Zugriff auf alle Websites erlauben. Den Schlüssel liest die Hüllen-App selbst; ihre Sandbox erlaubt genau diese eine Datei. Nach Änderungen in `clipper/` erneut `safari/build.sh --install`.

Bei einem HTML-Videoplayer bietet der Clipper im Popup und im Kontextmenü „Frame sichern“ und „Ganzes Video sichern“ an. Frames landen mit Zeitangabe als JPEG in der Sammlung. Vollständige MP4-, MOV- und WebM-Dateien können bis 80 MiB übernommen werden. Bei segmentierten Streams ist der Frame-Grab verfügbar, sofern der Player die Aufnahme erlaubt.

**Chrome/Edge:** `clipper` als entpackte Erweiterung laden und in den Einstellungen der Erweiterung den Schlüssel eintragen (`pbcopy < ~/.creativity-hub/launcher-token`).

## Tests

```bash
node --test *.test.mjs
```

Die macOS- und iOS-App für die Notizen selbst sind noch nicht implementiert.
