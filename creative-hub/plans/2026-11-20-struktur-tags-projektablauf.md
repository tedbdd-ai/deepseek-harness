# Umsetzungsplan: Struktur für Atelier

Stand 20.11.2026. Auftraggeber ist der Besitzer des Hubs (Einzelperson, Mac, Deutsch). Dieser Plan ist für einen Umsetzungsagenten geschrieben, der im Repo `deepseek-harness/creative-hub` arbeitet. Er enthält das Konzept (Teil A), die Umsetzung in Phasen (Teil B) und die offenen Entscheidungen (Teil C).

## Stand der Umsetzung (20.11.2026)

Umgesetzt und geprüft (Tests grün, Browser-Check auf einer Kopie der echten Datenbank):

- **Phase 0:** Rückgängig statt stilles Lösen, Icons statt Zeichen, Tokens statt fester Farben und Maße, Skeleton und Leerzustand, eigener Fehlerhinweis für den Video-Status, Projekt-ID in der URL, toter Zweig in `apps/moodboard/block.js` entfernt.
- **Phase 1–3:** Datenmodell (`tag-vocabulary.mjs`, `tag-store.mjs`), Migration der alten Tags, Analyse für alle Bilder und Videos (`asset-analysis.mjs`, `clip-vision.swift` mit Farben, Feature-Print und Text), Läufe/Stapel (`run_id`, Altbestand per Heuristik), Suche mit FTS5 (`search.mjs`), ähnliche Bilder, Farbsuche.
- **Phase 4–5 (Teil):** Filterleiste, Tag-Editor mit Vorschlägen, Mehrfachauswahl mit Drei-Zustands-Tags, Tag-Verwaltung `#/tags`, Sortieren-Modus `#/sortieren`, Stapel, Favorit und Aussortiert, gespeicherte Suchen („Sammlungen“), KI-Verschlagwortung auf Klick (`ai-tags.mjs`), MCP-Tools `list_tags`, `tag_assets` und erweitertes `search_assets`.
- **Phase 6–7 (Teil):** Das Moodboard zeigt nur bewusst abgelegte Karten (Entfernen vom Board löst das Projekt nicht); Ablage durchsucht mit der neuen Suche; Storyboard-Einstellungen liegen in Filmreihenfolge im Raster mit Status; „Startbild im Foto Playground erzeugen“ öffnet den Playground mit Prompt, Referenzen und Projekt vorbefüllt.
- **Phase 8:** Plugin `apps/schnitt/` mit Zeitleiste (Bild, Musik und Ton), Teilen, Trimmen, Reihenfolge, Übernahme aus dem Storyboard und Export per ffmpeg in die Library.

Bewusst offen geblieben:

- **4.0 Mockups** für die Tag-Oberfläche: nicht erstellt, die Oberfläche wurde direkt nach A7 gebaut. ⌘K durchsucht weiterhin nur die Suchleiste, nicht Tags und Einstellungen.
- **Phase 5:** Die alten Spalten `assets.tags` und `tag_source` werden weiter mitgeschrieben (Leser nicht umgestellt). „Aussortierte endgültig löschen“ und die Einstellung für automatische KI-Tags fehlen.
- **Phase 6:** Board-Code liegt noch im Hub (`openProjectBoard`), keine `projectSection`-Unterpunkte in der Seitenleiste, keine Spalten, kein „Mit KI vorschlagen“, keine Auswahlleiste „Als Einstellung“.
- **Phase 7:** Kein Bogen nach Akten und keine Listenansicht, kein Ziehen zum Umsortieren (weiter „Früher/Später“), kein „Story aufteilen“, Dauerwerte nicht aus dem Modell-Schema, das Startbild wird nach dem Playground von Hand gewählt.
- **Phase 8:** Vorschau mit `<video>` statt Remotion, „Mit KI verlängern“ öffnet den Video Playground mit dem Clip, Lautstärke in der Vorschau höchstens 100 %.
- Entscheidungen aus Teil C sind unverändert offen (C2 bis C5); Commits wurden nicht angelegt.

## Ziel in einem Satz

Der Hub erzeugt inzwischen schneller Material, als man es wiederfindet. Ziel ist, dass jedes Bild und Video automatisch und nachvollziehbar verschlagwortet wird, dass Suche und Filter schnell zum richtigen Bild führen und dass aus Sammlung und Library über Moodboard, Storyboard und Schnitt ein Film entsteht.

## Vor dem Start lesen

1. Skill `atelier-plugin` (`.claude/skills/atelier-plugin/SKILL.md` im Repo-Root): Plugin-Seams, Regeln, Checkliste. Gilt für jede Phase.
2. `creative-hub/PRODUCT.md`, `creative-hub/DESIGN.md`, `creative-hub/README.md`.
3. Globale Design-Regeln in `~/.claude/CLAUDE.md`: 8-pt-Raster, Pflicht-Zustände (Laden als Skeleton, Leer mit Hauptaktion, Filter ohne Treffer, Fehler mit „Erneut versuchen“, Offline), Kontrast, Tap-Ziele, keine Emoji oder Unicode-Zeichen als Icons, ein Icon-Satz (Lucide-Stil, inline SVG).
4. Mockups zum Projekt-Ablauf: `creative-hub/mockups/film-flow/index.html` (drei Richtungen; Bilder liegen lokal in `img/`, nicht im Repo).

## Arbeitsregeln für den Agenten

- **Alles ist ein Plugin.** Der Hub (`web/app.js`, `host.mjs`, `index.html`) bekommt nur gemeinsame Bausteine. Tag-Logik, die alle Ansichten brauchen (Store, Suche, Filterleiste), ist ein gemeinsamer Baustein; Moodboard, Storyboard und Schnitt sind Plugins.
- **Bezahlte Aufrufe nur auf ausdrückliche Handlung.** Lokale Analyse (Apple Vision, Farben, Prompt-Text) läuft automatisch. KI-Verschlagwortung über einen Anbieter läuft nur nach Klick oder nach einer ausdrücklich eingeschalteten Einstellung, die Modell und Anbieter nennt.
- **Daten nie verlieren.** Schemaänderungen in `store.mjs` folgen dem vorhandenen Muster (Spalten und Tabellen prüfen, dann `ALTER`/`CREATE`), migrieren bestehende Daten in derselben Transaktion und lassen alte Spalten stehen, bis eine spätere Phase sie ausdrücklich entfernt.
- **Testen auf einer Kopie.** Nie gegen `~/.creativity-hub/hub.sqlite` testen. Kopie anlegen mit `sqlite3 ~/.creativity-hub/hub.sqlite ".backup '<scratch>/hub.sqlite'"`, Overlay wie in `start.command` erzeugen, bei `creativity-core` `config: { databasePath: '<scratch>/hub.sqlite' }` und bei `creativity-hub` `config: { launcherTokenPath: '<scratch>/token' }` setzen, mit eigenem `DSH_HOME` (dann sind keine API-Schlüssel da und nichts kostet Geld) auf Port 3090 starten.
- **Tests:** `cd creative-hub && node --test *.test.mjs` muss grün bleiben; jede Phase bringt eigene Tests mit `createHarness()` aus `test-harness.mjs`. Nach Änderungen an `apps/storyboard/editor.jsx` oder `web/board.jsx`: `npm run build`.
- **Nach jeder Phase** im Browser auf der Testinstanz prüfen (Screenshot), gegen `DESIGN.md` abgleichen, alle Zustände zeigen, dann erst die nächste Phase beginnen. Commit pro Phase, Branch `creativity-hub`.
- **Texte:** Deutsch, Du-Form, Knöpfe benennen die Handlung, keine Marketing-Wörter. Wenn der Skill `tone-of-voice` verfügbar ist, neue Texte damit prüfen.

---

# Teil A: Konzept

## A1. Ausgangslage (gemessen am 20.11.2026)

- Sammlung 132 Einträge, davon 120 mit Tags; Library 283 Bilder, **keines mit Tags**.
- Tags sind eine flache JSON-Liste in `assets.tags` mit `tag_source` (`''` = offen, `auto`, `manual`). Häufigkeit: Person 115, Outfit 76, Location 6, Innenraum 6, Architektur 3. Die automatischen Tags aus `clip-tags.mjs` sind zu grob, um damit zu suchen.
- `clip-tags.mjs` verschlagwortet nur `library = 'clips'`; Generierungen bleiben leer.
- Sobald ein Mensch einen Tag ändert, wird `tag_source` zu `manual` und automatische Tags kommen nie wieder. Es gibt keine Vorschläge, die man annehmen oder ablehnen kann.
- Suche (`store.assets`) lädt alle Zeilen und filtert per Teilstring im Speicher. Kein Ranking, keine Synonyme, keine Facetten, keine Zählung.
- Library filtert nach Modell (aus dem Beschreibungstext geparst), Projekt und „Fashion-Referenz“. Sammlung filtert nach einzelnen Tags über ein Auswahlfeld.
- Jeder Playground-Lauf erzeugt 1 bis 4 fast gleiche Bilder, die alle einzeln in der Library liegen. Das ist der Hauptgrund für das Gefühl von Unordnung.

## A2. Prinzipien

1. **Facetten statt einer langen Liste.** Jeder Tag gehört zu genau einer Gruppe (Facette). Das macht Filter übersichtlich und Vorschläge verständlich.
2. **Maschine schlägt vor, Mensch entscheidet.** Automatisch erkannte Tags sind Vorschläge mit Herkunft. Was der Mensch bestätigt oder ablehnt, überschreibt die Maschine dauerhaft, ohne die übrigen Vorschläge zu blockieren.
3. **Kostenlos zuerst.** Lokale Apple-Vision-Analyse, Farben, Bildähnlichkeit und vorhandene Texte (Prompt, Modell, Quelle) decken den Großteil ab. KI-Beschreibungen über einen Anbieter sind ein Zusatz auf Klick.
4. **Weniger sichtbar machen statt mehr taggen.** Stapel pro Lauf, Favorit und „Aussortiert“ reduzieren die Menge, die man überhaupt durchsuchen muss.
5. **Suchen wie sprechen.** Ein Suchfeld versteht freie Wörter, Synonyme und Facetten („latex neon außen“ findet Material Latex, Licht Neon, Ort Außen).

## A3. Facetten und Startvokabular

Die Facetten sind fest im Code definiert (Protokoll-Konstante), das Vokabular darin ist Daten und vom Nutzer erweiterbar. Startvokabular als Seed (Migration), deutsch, mit Synonymen (auch englisch, weil Vision-Labels und Prompts englisch sind):

| Facette (id) | Zweck | Startwerte (Synonyme in Klammern) |
| --- | --- | --- |
| `art` Art | was es technisch ist | Foto, Generiert, Video, Screenshot, Webseite, Notiz, Skizze |
| `motiv` Motiv | wer oder was zu sehen ist | Person (people, human), Porträt (portrait, headshot, selfie), Gruppe, Ganzkörper (full body), Detail, Objekt, Tier |
| `mode` Mode | Kleidung und Material | Outfit (clothing, fashion), Latex (rubber, Gummi), Leder (leather), Lack (pvc, vinyl), Maske (mask), Handschuhe (gloves), Stiefel (boots), Catsuit, Mantel (coat), Kleid (dress) |
| `ort` Ort | wo es spielt | Innen (interior, indoor), Außen (outdoor), Studio, Architektur (building, facade), Straße (street, alley), Natur (landscape, forest, beach), Klinik (clinic, hospital) |
| `licht` Licht und Stimmung | Look | Neon, Low-Key, High-Key, Tageslicht (daylight), Nacht (night), Gegenlicht (backlight), Analog/Korn (film grain, analog) |
| `kamera` Kamera | Einstellungsgröße und Perspektive | Totale (wide shot), Halbnah (medium shot), Nah (close-up), Detail (extreme close-up), POV, Vogelperspektive, Froschperspektive |
| `farbe` Farbe | dominante Farben | wird nicht getaggt, sondern berechnet (A4) |
| `quelle` Quelle | woher | Instagram, Pinterest, X, YouTube, Web, Playground, Styler, Video Playground, Upload (berechnet, nicht editierbar) |
| `modell` Modell | Generator | aus der Generierung (berechnet, nicht editierbar) |
| `frei` Freie Tags | alles andere | vom Nutzer, ohne Facette |

Projekte bleiben eine eigene Zuordnung (`project_assets`) und erscheinen in der Filterleiste als eigene Facette, sind aber keine Tags.

## A4. Woher Tags kommen

Jede Zuordnung Asset ↔ Tag hat eine **Herkunft** und einen **Zustand**:

- Herkunft: `vision` (lokal, Apple Vision), `text` (aus Titel, Beschreibung, Prompt), `meta` (Modell, Quelle, Lauf, Referenzen), `ki` (Anbieter, auf Klick), `nutzer`.
- Zustand: `vorschlag` (sichtbar als gestrichelter Chip, zählt in der Suche mit geringerem Gewicht), `bestätigt`, `abgelehnt` (unsichtbar, wird nie wieder vorgeschlagen).
- Herkunft `nutzer` und `meta` sind sofort `bestätigt`. Vorschläge ab einer Konfidenz-Schwelle pro Facette werden in der Suche wie bestätigte behandelt, aber in der Oberfläche als Vorschlag gezeigt.

Quellen im Einzelnen:

1. **Lokale Bildanalyse (kostenlos, automatisch, Mac).** `clip-vision.swift` erweitern: neben `VNClassifyImageRequest`, Gesichtern und Personen zusätzlich
   - `VNGenerateImageFeaturePrintRequest` → Merkmalsvektor für „Ähnliche Bilder“ und Dubletten,
   - dominante Farben (Thumbnail auf 64 px, k-means mit k = 5 in Swift, oder Histogramm in Lab) → bis zu 5 Farben mit Anteil,
   - `VNRecognizeTextRequest` nur für Screenshots (erkannter Text wird durchsuchbar).
   Die Vision-Labels werden über die Synonyme auf das Vokabular abgebildet (Erweiterung von `inferTags`), nicht direkt als Tag gespeichert. Läuft für **alle** Bilder, auch Generierungen, und für Videos über ein Standbild (ffmpeg ist vorhanden, siehe `media-edit.mjs`).
2. **Text (kostenlos).** Titel, Beschreibung und Prompt werden gegen das Vokabular samt Synonymen abgeglichen (Wortgrenzen wie `hasWord`). Generierungen haben meist englische Prompts mit genau den Wörtern, die gebraucht werden („latex“, „clinic“, „analog film grainy“).
3. **Metadaten (kostenlos, sicher).** `art`, `quelle`, `modell`, Lauf-Id, Vorlage, verwendete Referenzen. Eine Generierung **erbt bestätigte Tags ihrer Referenzbilder** als Vorschlag (die Referenz zeigt eine Person in Latex, also schlägt das Ergebnis Person und Latex vor).
4. **KI-Verschlagwortung (kostenpflichtig, nur auf Klick).** Für die Auswahl „Mit KI verschlagworten“: ein Anbieter mit Fähigkeit `chat` und Bildeingabe bekommt Bild plus Vokabular als JSON-Schema und liefert Tags pro Facette und eine Kurzbeschreibung. Ergebnis landet als Vorschlag mit Herkunft `ki`. Optional eine Einstellung „Neue Einträge automatisch mit KI verschlagworten“, standardmäßig aus, mit Anzeige von Anbieter und Modell. Kosten nur so, wie der Anbieter sie meldet.

## A5. Suche

- **Volltext mit SQLite FTS5** (in `node:sqlite` verfügbar, geprüft): eine Tabelle `asset_search` mit Titel, Beschreibung, Prompt, Tag-Namen samt Synonymen, erkanntem Text, Quelle. Tokenizer `unicode61 remove_diacritics 2`, Präfixsuche. Ranking mit `bm25`, bestätigte Tags höher gewichtet als Vorschläge.
- **Suchsprache ohne Syntax-Zwang.** Die Eingabe wird zerlegt: Wörter, die einem Tag oder Synonym entsprechen, werden zu Facettenfiltern und als Chips angezeigt („Latex · Mode“); der Rest bleibt Volltext. Optional für Fortgeschrittene: `-wort` schließt aus, `"…"` sucht genau.
- **Facettenfilter mit Zählung.** Die API liefert zu jeder Suche die Anzahl je Tag in jeder Facette, damit die Filterleiste nur sinnvolle Werte zeigt.
- **Ähnliche Bilder.** Im Detail „Ähnliche finden“: Abstand der Feature-Prints, die 50 nächsten. Gleiche Funktion markiert Dubletten.
- **Farbsuche.** Farbfelder in der Filterleiste; Treffer, wenn eine dominante Farbe nah genug liegt (Abstand in Lab).
- **Intelligente Sammlungen.** Eine Suche samt Filtern lässt sich speichern und erscheint in der Seitenleiste unter „Sammlungen“. Ein Moodboard kann eine intelligente Sammlung als Ablage nutzen.
- **⌘K** sucht über alles: Einträge, Projekte, Einstellungen, Tags, gespeicherte Suchen.

## A6. Menge reduzieren

- **Stapel.** Alle Ergebnisse eines Playground-Laufs bilden einen Stapel; die Library zeigt ein Titelbild mit Anzahl. Aufklappen zeigt alle; „Titelbild festlegen“ wählt das beste. Bestehende Generierungen werden über die Lauf-Daten in `playground:runs` gruppiert (dort stehen nur die letzten 40 Läufe), sonst über gleichen Prompt plus gleiches Modell innerhalb von 10 Minuten.
- **Bewertung.** Favorit (Stern) und „Aussortiert“. Aussortiertes ist standardmäßig ausgeblendet, nicht gelöscht; „Aussortierte zeigen“ als Filter, „Aussortierte endgültig löschen“ mit Bestätigung.
- **Sortieren-Modus.** Eine Ansicht, die neue oder ungeprüfte Einträge einzeln zeigt, mit Vorschlägen daneben, ganz per Tastatur: Enter bestätigt alle Vorschläge, Pfeiltasten wechseln, 1–9 ordnet einem Projekt zu, F Favorit, X Aussortiert, T öffnet die Tag-Eingabe. So wird aus 40 neuen Bildern in zwei Minuten eine geordnete Library.

## A7. Oberfläche (Linear-Stil, DESIGN.md-Tokens)

1. **Filterleiste** über Sammlung und Library (gemeinsamer Baustein): Suchfeld, dann je Facette ein `.pill` mit Popover (Mehrfachauswahl, Zählung, Suchfeld im Popover), Farbfelder, Projekt, „Ohne Tags“, „Offene Vorschläge“, Favoriten, Sortierung. Aktive Filter als entfernbare `.chip`s, „Alle Filter entfernen“. Filter stehen in der URL (`#/library?tag=mode:latex&licht=neon`), damit Zurück und Links funktionieren.
2. **Detail rechts (Inspector):** Tags gruppiert nach Facette. Bestätigte Tags als normale Chips, Vorschläge gestrichelt mit Häkchen (annehmen) und X (ablehnen), Herkunft im Tooltip („von Apple Vision, 78 %“). Eingabe mit Autovervollständigung über Vokabular und Synonyme; unbekanntes Wort fragt „Neuen Tag anlegen in …“ mit Facettenwahl. Darunter „Ähnliche finden“, Farben, Herkunft (Quelle, Modell, Lauf).
3. **Mehrfachauswahl:** Leiste unten mit den gemeinsamen Tags der Auswahl in drei Zuständen (alle, manche, keine); Klick setzt für alle, Alt-Klick entfernt. Dazu „Vorschläge übernehmen“, „Mit KI verschlagworten“ (kostenpflichtig markiert), Projekt, Favorit, Aussortieren.
4. **Tags verwalten** (eigene Seite unter Library oder in den Einstellungen): Tabelle je Facette mit Anzahl; umbenennen, zusammenführen, Synonyme pflegen, Facette wechseln, löschen (mit Bestätigung und Anzahl betroffener Einträge).
5. **Sortieren-Modus** als Vollansicht (siehe A6).

Für die Oberfläche vor der Umsetzung drei Varianten als Mockup bauen (Skill `app-mockup`, Desktop statt Phone) und den Nutzer wählen lassen. Das ist Phase 4.0.

## A8. Projekt-Ablauf (aus der UX-Prüfung und den Mockups)

Gewählte Richtung bis zur Gegenentscheidung: **Variante A „Projekt-Etappen“** aus `mockups/film-flow`, ergänzt um den Umschalter „Liste / Bogen“ aus Variante C für das Storyboard.

- Projekt in der Seitenleiste klappt seine Bereiche auf: Übersicht (bisherige Projektseite), Moodboard, Storyboard, Schnitt, mit Zählern.
- **Moodboard** ist eine freie Fläche nach Milanote: Bilder, Spalten, Notizen, Farbpaletten, Links. Es zeigt **nur, was bewusst abgelegt wurde**, nicht automatisch alle Projekt-Zuordnungen. Rechts eine Ablage „Sammlung“ mit der Filterleiste aus A7, Ziehen auf die Fläche legt ab und ordnet dem Projekt zu. „Mit KI vorschlagen“ (auf Klick) wählt aus Projektbeschreibung und Sammlung passende Bilder als Vorschlag.
- **Storyboard** als Bogen nach Akten (Karten mit Startbild, Status, nächster Aktion) oder als Shotlist. Jede Einstellung: Titel, Szenenprompt, Dauer, Startbild, Look-Referenzen aus dem Moodboard (`@`-Marken wie im Playground), Status. Aktionen: „Startbild aus Moodboard“, „Startbild im Foto Playground erzeugen“, „Video erzeugen“ (Video Playground). „Story aufteilen“ (auf Klick) macht aus dem Story-Text Einstellungen als Entwurf.
- **Schnitt**: Clip-Liste, Player, Zeitleiste mit Spuren Bild, Musik, Ton; Trimmen, Teilen am Abspielkopf, Reihenfolge, „Mit KI verlängern“ (vorhandene Verlängerung aus `apps/influencer-video/video-extension.mjs`), Audiospur hinzufügen, Lautstärke je Spur, Export per ffmpeg.

---

# Teil B: Umsetzung in Phasen

Reihenfolge so gewählt, dass jede Phase allein nutzbar ist. Phasen 1–5 (Tags, Suche, Ordnen) und 6–8 (Projekt-Ablauf) berühren verschiedene Dateien und können parallel laufen, sobald Phase 0 gelandet ist; Phase 6 nutzt die Filterleiste aus Phase 4, kann aber vorher mit der einfachen Suche starten.

## Phase 0: Brüche aus der UX-Prüfung beheben

Klein, sofort sichtbar, unabhängig vom Rest.

- `apps/storyboard/editor.jsx`:
  - „Aus Projekt lösen“ entfernt die Zuordnung sofort und bietet in einem Toast „Rückgängig“ an; „Karte entfernen“ ebenso. Beide Knöpfe als `.btn.danger`.
  - Schließen-Knopf „×“ durch Lucide-`x` als SVG in `.icon` ersetzen; Texte „+ Einstellung“ usw. bekommen ein Plus-Icon statt des Zeichens.
  - Feste Farben (`#719fd4`, `#d79978`, `#111`) durch CSS-Variablen ersetzen (Kanten über eine Klasse in `app.css` statt Inline-Style).
  - Fehler beim Status-Abruf der Videos zeigt einen eigenen Hinweis mit „Erneut prüfen“, nicht „Erneut speichern“.
  - Laden: Skeleton in Form der Fläche statt „Lädt Board …“. Leer: Grund plus Hauptaktion.
  - Ohne `?project=` die gewählte Projekt-Id per `history.replaceState` in die URL schreiben.
- `web/app.css` Abschnitt „Frei platzierbare Karten“: Abstände und Radien auf Tokens (`--s-*`, `--r-*`), keine 5/6/11/14/15 px; Punktraster leiser (`--c-hair`, Abstand 24).
- `apps/checklist`, `apps/light-plan`, `apps/patch-sheet` nutzen noch die alte Schnittstelle (`context.ui`, `idea`) und werden nirgends angezeigt; die Projektvorlagen in `snapshots.mjs` versprechen sie trotzdem. **Entscheidung C3** abwarten; bis dahin nichts löschen.
- `apps/moodboard/block.js`: toten Zweig (`if (!context.ui)` … alter Code) entfernen.
- Tests: bestehende grün; neuer Test für Rückgängig nicht nötig (reine Oberfläche), aber Browser-Check mit Screenshot.

## Phase 1: Datenmodell Tags

Dateien: `store.mjs`, `core.mjs` (falls neue Store-Methoden in der Seam-Doku stehen), `hub.test.mjs`, neues `tags.test.mjs`.

- Neue Tabellen:
  - `tags(id TEXT PRIMARY KEY, facet TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(facet, key))` — `key` = normalisierter Name wie `tagKey` heute.
  - `tag_aliases(tag_id TEXT NOT NULL REFERENCES tags(id), key TEXT NOT NULL, PRIMARY KEY(key, tag_id))` — Synonyme.
  - `asset_tags(asset_id TEXT NOT NULL REFERENCES assets(id), tag_id TEXT NOT NULL REFERENCES tags(id), origin TEXT NOT NULL CHECK (origin IN ('vision','text','meta','ki','nutzer')), state TEXT NOT NULL CHECK (state IN ('vorschlag','bestaetigt','abgelehnt')), confidence REAL, updated_at TEXT NOT NULL, PRIMARY KEY(asset_id, tag_id))`.
  - `asset_analysis(asset_id TEXT PRIMARY KEY REFERENCES assets(id), version INTEGER NOT NULL, colors TEXT NOT NULL DEFAULT '[]', featureprint BLOB, text TEXT NOT NULL DEFAULT '', labels TEXT NOT NULL DEFAULT '[]', analyzed_at TEXT NOT NULL)` — Rohdaten der lokalen Analyse; `version` erlaubt Neuberechnung nach Verbesserungen.
  - Neue Spalten an `assets`: `rating INTEGER NOT NULL DEFAULT 0` (0 neutral, 1 Favorit, -1 aussortiert), `run_id TEXT NOT NULL DEFAULT ''`, `reviewed_at TEXT NOT NULL DEFAULT ''`.
- Facetten als Konstante `FACETS` in einem neuen Modul `tag-vocabulary.mjs` (ids, deutsche Namen, Reihenfolge, ob editierbar) plus Startvokabular mit Synonymen aus A3. Seed beim Öffnen, idempotent.
- Migration der alten JSON-Tags: bekannte Namen (Person, Porträt, Outfit, Location→Ort, Architektur, Natur, Innenraum→Innen, Screenshot→Art) auf das Vokabular abbilden, unbekannte als `frei`. `tag_source = 'manual'` wird `nutzer/bestaetigt`, `auto` wird `vision/vorschlag`. Spalten `tags` und `tag_source` bleiben vorerst bestehen und werden weiter mitgeschrieben (abgeleitet), damit Sammlung, Suche und MCP (`mcp.mjs` nutzt `store.assets`) nicht brechen; erst Phase 5 stellt alle Leser um.
- Store-API (alle mit JSDoc):
  - `tagVocabulary()` → Facetten mit Tags, Synonymen, Anzahl.
  - `assetTags(ids)` → je Asset die Tags mit Herkunft, Zustand, Konfidenz (ohne `abgelehnt`).
  - `setTagState({ assetIds, tagIds, state })` → Nutzer bestätigt oder lehnt ab; setzt `origin = 'nutzer'` beim Hinzufügen.
  - `addSuggestions(assetId, [{ tagId, origin, confidence }])` → überschreibt nie `bestaetigt` oder `abgelehnt`.
  - `createTag`, `renameTag`, `mergeTags(sourceId, targetId)`, `setAliases`, `moveTag(facet)`, `deleteTag`.
  - `setRating(ids, rating)`.
- Tests: Migration einer Datenbank mit altem Format (JSON-Tags, `manual` und `auto`); Vorschlag überschreibt keine Nutzerentscheidung; Zusammenführen behält die stärkste Zuordnung; Löschen entfernt Zuordnungen.

## Phase 2: Automatische Quellen

Dateien: `clip-tags.mjs` (umbenennen in `asset-analysis.mjs`, Export-Namen anpassen und alle Importe in `host.mjs` mitziehen), `clip-vision.swift`, `host.mjs`, `playground/host.mjs` (Lauf-Id und Referenzen beim Speichern), `apps/influencer-video/host.mjs` (Lauf-Id), Tests.

- Analyse-Warteschlange für **alle** Assets mit Bild oder Video, deren `asset_analysis.version` fehlt oder veraltet ist. Videos: ein Standbild bei 1 s per ffmpeg (Muster aus `media-edit.mjs`), Fehler nur protokollieren.
- Swift-Worker liefert zusätzlich Feature-Print (als Float-Array, Base64), dominante Farben und, nur wenn ein Label „screenshot“ oder „document“ erkannt wird, erkannten Text. Ausgabeformat versionieren.
- Abbildung Labels und Text → Vokabular über Synonyme, Schwellen je Facette als validierte `Config`-Felder des Plugins (keine harten Konstanten), Ergebnis über `addSuggestions`.
- Metadaten beim Anlegen: `art`, `quelle` aus Domain oder Plugin, `modell` aus der Generierung, `run_id`; geerbte Vorschläge aus bestätigten Tags der Referenzbilder (`origin = 'meta'`, `state = 'vorschlag'`).
- Bestehende Generierungen: einmaliger Hintergrundlauf; `run_id` aus `playground:runs` zuordnen, sonst Heuristik (gleicher Prompt, gleiches Modell, ≤ 10 min).
- Lebenszyklus: wie heute `createClipTagger` mit Stop-Flag und `ctx.effect`-Disposer; nach Dispose nichts mehr schreiben.
- Tests mit gefälschtem Vision-Ergebnis (kein Swift im Test): Abbildung Labels→Tags, Schwellen, Erben von Referenzen, Videos überspringen ohne ffmpeg ohne Absturz, Dispose stoppt die Schreibvorgänge.

## Phase 3: Suche

Dateien: `store.mjs`, `host.mjs` (Route), neues `search.mjs` (Parser), `search.test.mjs`, `mcp.mjs` (Tool `search_assets` auf die neue Suche umstellen).

- FTS5-Tabelle `asset_search` (contentless oder mit `content=''` und eigener Pflege), Trigger oder explizite Aktualisierung bei Asset- und Tag-Änderungen. Initial befüllen in der Migration.
- Parser `parseQuery(text, vocabulary)` → `{ terms, include: [tagId], exclude: [tagId], phrases }`; Wörter, die einem Tag oder Synonym entsprechen, werden Filter.
- Route `GET /creativity-hub/api/search?q=&library=&project=&tags=&exclude=&colors=&rating=&untagged=&suggestions=&stack=&sort=&limit=&cursor=` → `{ items, facets: { [facet]: [{ tagId, name, count }] }, total, nextCursor }`. Seitenweise (100 pro Seite), damit Library mit tausenden Einträgen flüssig bleibt.
- Route `GET /api/assets/:id/similar?limit=50` über Feature-Print-Abstand (in JS, Vektoren im Speicher cachen pro Store-Instanz, nicht modulweit).
- Farbsuche: Abstand in Lab ≤ Schwelle (Config).
- Bestehende `GET /api/assets?q=` intern auf die neue Suche umleiten, Antwortformat beibehalten.
- Tests: Synonyme („rubber“ findet Latex), Ausschluss, Facettenzählung, Rangfolge (bestätigter Tag vor Vorschlag vor Volltext), Seitenweise, Ähnlichkeit mit festen Vektoren.

## Phase 4: Oberfläche Tags und Suche

- **4.0 Mockups:** drei Varianten für Filterleiste, Inspector-Tags, Mehrfachauswahl, Sortieren-Modus und Tag-Verwaltung nach Skill `app-mockup` (Desktop), Nutzer wählt. Erst danach bauen.
- Gemeinsamer Baustein `filterBar(options)` und `tagEditor(asset)` im Hub (`web/app.js` oder neues `web/tags.js`, vom Hub geladen) und über den Kontext an Plugins weitergegeben, damit Moodboard-Ablage und Storyboard-Auswahl ihn nutzen.
- Sammlung und Library auf `filterBar` umstellen; altes Tag-Auswahlfeld und Modell-/Typ-Auswahl entfallen (werden Facetten).
- Inspector: Tags nach Facette, Vorschläge annehmen/ablehnen, Autovervollständigung, „Ähnliche finden“, Farben, Herkunft.
- Mehrfachauswahl: Drei-Zustands-Tags, „Vorschläge übernehmen“, „Mit KI verschlagworten“ (kostenpflichtig markiert, deaktiviert ohne Anbieter mit Link „Textanbieter einrichten“).
- Tag-Verwaltung als Seite `#/tags`.
- ⌘K-Suche um Tags, gespeicherte Suchen und Einstellungen erweitern.
- Zustände: Skeleton beim Laden, Leer (Erstnutzung) und „Filter ergibt nichts“ getrennt, Fehler mit „Erneut versuchen“, Offline-Hinweis mit zuletzt geladenen Daten.
- Tastatur: `/` fokussiert Suche, `T` Tag-Eingabe im Detail, Esc schließt Popover und Detail, Fokusreihenfolge sinnvoll, alle Icon-Knöpfe mit `aria-label`.

## Phase 5: Ordnen und KI-Verschlagwortung

- Stapel in der Library (Titelbild, Anzahl, aufklappen, „Titelbild festlegen“), Favorit, Aussortiert, Filter dafür.
- Sortieren-Modus `#/sortieren` (Tastatur wie A6), setzt `reviewed_at`.
- Intelligente Sammlungen: gespeicherte Suchen im Settings-Namespace `hub:saved-searches`, in der Seitenleiste unter „Sammlungen“.
- KI-Verschlagwortung: Route `POST /api/assets/ai-tags { ids }` nutzt den ersten konfigurierten Anbieter mit `chat` und Bildeingabe (Muster: `apps/influencer-video/seedance-prompt-skill.mjs`), schickt Vokabular als JSON-Schema, validiert die Antwort, speichert Vorschläge mit `origin = 'ki'`; Fehler als verständlicher Satz. Nur auf Klick. Einstellung „Neue Einträge automatisch mit KI verschlagworten“ standardmäßig aus.
- Alle Leser der alten Spalten auf die neue API umstellen (heute: `web/app.js` über das Feld `tags` in `GET /api/assets`, `store.assets` in der Suche, die `mcp.mjs` mitbenutzt; vorher mit `grep -n "tags\|tag_source"` erneut prüfen); danach hören die Schreibvorgänge in `assets.tags` auf. Die Spalten bleiben in der Datenbank stehen.
- MCP-Tools `search_assets` und `assign_asset` bekommen Tag-Filter; neues Tool `tag_assets`.
- Tests: KI-Antwort mit unbekannten Tags wird verworfen bzw. als `frei` vorgeschlagen; Kostenpflicht nur bei Route-Aufruf; Stapelbildung.

## Phase 6: Projekt-Ablauf, Moodboard

Dateien: `apps/moodboard/`, `apps/storyboard/editor.jsx` (aufteilen), `vite.config.js`, `web/app.js` (nur: Projekt klappt Bereiche in der Seitenleiste auf, generisch über Apps mit neuer Eigenschaft `projectSection: true`), `README.md`.

- Board-Code aus dem Hub lösen: `openProjectBoard` aus `web/app.js` entfernen; jedes Board-Plugin lädt seinen Editor selbst. Der Vite-Build baut die Editoren pro Plugin nach `apps/<id>/dist/` und `defineApp` liefert sie aus (Muster für `.js`-Dateien erweitern um `dist/`), oder ein gemeinsames Board-Bundle wird als geteilter Baustein beschrieben und im Kontext angeboten. Entscheidung im PR begründen.
- Seitenleiste: Apps mit `projectSection: true` erscheinen unter dem geöffneten Projekt als Unterpunkte mit Zähler (Zähler liefert die App über eine optionale Route `GET /creativity-apps/<id>/count?project=`). Feste Knöpfe „Moodboard/Storyboard“ in `renderProject` entfallen.
- Moodboard-Daten von Projekt-Zuordnungen trennen: `app_data(moodboard).items = [{ id, kind: 'asset'|'note'|'color'|'link'|'column', assetId?, … }]` plus `positions`, `columns`. Migration: Assets mit gespeicherter Position werden `items`; übrige Projekt-Zuordnungen bleiben nur in der Projekt-Übersicht.
- Ablage rechts mit `filterBar` (oder bis Phase 4 der einfachen Suche), Ziehen legt ab und ordnet zu. Entfernen vom Board löst **nicht** die Projekt-Zuordnung.
- Spalten (Milanote): Karten lassen sich in eine Spalte ziehen; Spalte hat Titel und Reihenfolge.
- Auswahl-Leiste über einem Bild: „Als Einstellung“, „Im Foto Playground variieren“ (öffnet Playground mit dem Bild als Referenz, kein automatischer Lauf).
- „Mit KI vorschlagen“ (auf Klick, kostenpflichtig falls Anbieter): Vorschläge erscheinen als gestrichelte Karten, die man übernimmt oder verwirft.
- Tests: Migration der alten Moodboard-Daten, Entfernen vom Board lässt Zuordnung bestehen, Route für den Zähler.

## Phase 7: Projekt-Ablauf, Storyboard

- Bogen nach Akten (Standard) und Shotlist (Umschalter, Wahl im Settings-Namespace `storyboard:view` merken). Story-Text sichtbar oben.
- Einstellung: Titel, Szenenprompt, Dauer (Werte aus dem gewählten Videomodell-Schema statt 4–30 s fest), Startbild, Look-Referenzen als `@`-Marken (Auswahl aus Moodboard-Items), Akt, Status (abgeleitet: Startbild fehlt / da / Video wird erzeugt / fertig / fehlgeschlagen).
- Aktionen: „Startbild aus Moodboard“, „Startbild erzeugen“ (öffnet Foto Playground mit Prompt und Referenzen vorbefüllt und Ziel = Projekt und Einstellung; das Ergebnis wird beim Speichern als Startbild verknüpft), „Video erzeugen“ (öffnet Video Playground wie heute mit `shot`).
- Reihenfolge per Ziehen im Bogen und in der Liste (statt „Früher/Später“).
- „Story aufteilen“ (auf Klick, Textanbieter): Entwurf von Einstellungen, die einzeln übernommen werden.
- Das Status-Polling bleibt beim Video-Plugin; das Storyboard liest nur `storyboard-renders` und den Job-Status (keine `refresh`-Aufrufe aus dem Storyboard heraus, damit nur eine Stelle Anbieter abfragt).
- Tests: Status-Ableitung, Startbild-Verknüpfung aus dem Playground, Dauerwerte aus Schema.

## Phase 8: Schnitt

- Neues Plugin `apps/schnitt/` (Seite im Projekt, `projectSection: true`). Daten in `app_data(schnitt)`: Spuren `bild`, `musik`, `ton` mit Clips `{ assetId, in, out, start, volume }`.
- Start: Bildspur wird aus den fertigen Videos der Einstellungen in Storyboard-Reihenfolge vorbelegt; spätere Änderungen im Storyboard erscheinen als Hinweis „3 neue Clips aus dem Storyboard übernehmen“, nicht automatisch.
- Vorschau mit Remotion Player (schon als Abhängigkeit vorhanden) aus den Spuren.
- Werkzeuge: Auswählen, Teilen am Abspielkopf, Trimmen an den Rändern, Verschieben, Lautstärke je Clip und Spur, Audiodatei hinzufügen (Upload oder aus Sammlung), „Mit KI verlängern“ für den gewählten Clip (vorhandene Verlängerung, kostenpflichtig markiert, Ergebnis als neuer Clip direkt dahinter).
- Export: Server-Route rendert per ffmpeg (Concat mit Trims, Audio-Mix) in die Library als Video mit Projekt-Zuordnung; Fortschritt und Fehler als Satz.
- Tests: ffmpeg-Aufruf mit festen Eingaben (Argumentliste prüfen, echter ffmpeg-Lauf nur, wenn vorhanden), Datenmodell, Übernahme aus Storyboard.

---

# Teil C: Offene Entscheidungen (vor der jeweiligen Phase beim Nutzer klären)

1. **Richtung Projekt-Ablauf (vor Phase 6):** A „Projekt-Etappen“ mit Shotlist aus C ist gesetzt, solange der Nutzer nichts anderes sagt. B „Eine Leinwand“ wäre ein anderer Datenaufbau (ein gemeinsames Board) und muss vor Phase 6 entschieden sein.
2. **KI-Verschlagwortung automatisch (Phase 5):** bleibt standardmäßig aus. Soll sie für neue Einträge eingeschaltet werden, und mit welchem Anbieter?
3. **Alte Apps Checkliste, Lichtplan, Patch-Sheet (Phase 0):** auf die neue Schnittstelle bringen und als Projektbereiche anbieten, oder entfernen und die Projektvorlagen bereinigen?
4. **Vokabular (Phase 1):** Das Startvokabular in A3 ist ein Vorschlag aus den vorhandenen Bildern und Prompts. Nutzer kurz drüberschauen lassen, besonders die Facette Mode.
5. **Aussortiert endgültig löschen (Phase 5):** nur manuell, oder automatisch nach einer Frist?
6. **Playgrounds zusammenlegen:** nicht Teil dieses Plans. Foto und Video Playground bleiben getrennt; der Ablauf führt gezielt hinein.

## Nicht Teil dieses Plans

- Mehrere Nutzer, Freigaben, Sync zwischen Geräten.
- Ein eigenes KI-Modell lokal betreiben (Apple Vision reicht für die kostenlose Stufe).
- Umbau des Foto oder Video Playgrounds über die genannten Einstiege hinaus.
- NSFW-Instanz: läuft mit demselben Code und eigener Datenbank; die Migrationen müssen dort genauso laufen (beim Start beider Instanzen prüfen), sonst keine Sonderbehandlung.

## Fertig heißt

- Alle Phasen gelandet, `node --test *.test.mjs` grün, `npm run build` ohne Fehler.
- Auf der Testinstanz mit Kopie der echten Datenbank: Library-Bilder haben Vorschläge, „latex neon“ findet passende Bilder, Filter zeigen Zahlen, Stapel reduzieren die Library sichtbar, ein Projekt führt von Moodboard über Storyboard zu einem exportierten Video.
- `README.md` beschreibt neue Routen, Store-Methoden und Plugin-Eigenschaften (`projectSection`), `DESIGN.md` die neuen Muster (Filterleiste, Vorschlags-Chip, Stapel).
