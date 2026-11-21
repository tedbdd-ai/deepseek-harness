# Atelier: Designsystem

Quelle: Entwurf „Atelier Hub“ (claude.ai Design-Fläche, Ansicht 9 „Bedienelemente“). Umgesetzt als CSS-Variablen in `web/app.css`; Werte hier und dort gleich halten.

## Richtung
Dunkles Kreativ-Werkzeug im Stil einer Mac-App: fast schwarzer, neutraler Grund, auf dem Bilder leuchten. Die Oberfläche tritt zurück; Farbe kommt nur aus Inhalten und den Projektpunkten. Vorbilder: Fotos (Dark Mode), Final Cut Pro, fal Sandbox für den Playground.

## Farben (`:root` in app.css)

Standard ist der ElevenLabs-Stil (hell, `design/elevenlabs.md`): Eggshell-Papier, Taupe-Flächen, Stone-Haarlinien, schwarze Schrift und schwarze Pillen-Buttons. Den Dunkelmodus gibt es über den Schalter unten in der Seitenleiste (`data-theme="dark"`, gespeichert im Browser).

| Token | Hell | Dunkel | Rolle |
| --- | --- | --- | --- |
| `--c-bg` / `--c-panel` | #FDFCFC | #111111 / #181818 | Grund, Karten, Knoten |
| `--c-side` | #F5F3F1 | #161616 | Seitenleiste |
| `--c-fill` … `-4` | #F5F3F1 … #D3CEC7 | #1E1E1E … #3D3D3D | Bedienelemente: normal, Hover, gedrückt, gewählt |
| `--c-line` | #EBE8E4 | #2A2A2A | Haarlinien statt Schatten |
| `--c-ink` / `-2` / `-3` | #000000 / #44403B / #6E6861 | #F5F3F1 / #CBC6C0 / #9A948C | Text (alle ≥ 4,5:1) |
| `--c-primary` = `--c-neutral` | #000000 | #FDFCFC | Pillen-Buttons; Schrift `--c-on-primary` |
| `--c-scrim` | Schwarz 66 % | Schwarz 72 % | Flächen über Bildern; Schrift immer `--c-on-scrim` (weiß) |
| `--c-dot` | #ECE9E5 | #1D1D1D | Punktraster, knapp über dem Grund; unter 40 % Zoom ausgeblendet |
| `--c-danger` | #C2321F | #F28B7D | Löschen |
| Radien | Buttons 9999 px, Felder 10 px, Karten 20 px | | |

Projektfarben (Punkte): #FF6B57, #BF5AF2, #0A84FF, #30D158, #FF9F0A, #64D2FF, #FF375F.

Porttypen in Flows (`--c-port-*`, hell/dunkel): Text #6B655B/#A8A49C, Bild #2E7D9A/#7CC4DA, Video #7E4BB5/#B48AE0, Ton #B06A0B/#E0A458. Sie färben nur Ports und Linien, und jeder Port trägt zusätzlich das Symbol seines Typs.

## Typografie
Eine Schrift: Inter Variable (`web/fonts`, OFL). Gewichte 300 (nur Seitentitel), 400 (Text), 500 (Bedienelemente, Hervorhebung), nie fetter. Sieben Rollen als Tokens in `web/app.css`; im Flows-Canvas sind Tailwinds `text-xs` … `text-xl` in px auf dieselben Rollen gemappt (`apps/flows/ui/flows.css`). Freie Größen wie `font-size: 17px` oder `text-[13px]` gibt es nicht.

| Rolle | Token | Größe / Zeile | Gewicht, Laufweite | Tailwind | Einsatz |
| --- | --- | --- | --- | --- | --- |
| Display | `--fs-display` | 32 / 36 | 300, −0,02em | – | Seitentitel |
| Titel | `--fs-title` | 20 / 26 | 500 | `text-xl` | Kartentitel, große Zahlen |
| Überschrift | `--fs-heading` | 16 / 22 | 500 | `text-lg` | Abschnitte, Dialoge, Vorlagen |
| Text | `--fs-body` | 15 / 22 | 400, +0,01em | – | Fließtext, Eingabefelder |
| UI | `--fs-ui` | 14 / 20 | 400 oder 500 | `text-base` | Buttons, Listen, Menüs |
| Meta | `--fs-meta` | 13 / 18 | 400 | `text-sm` | Nebentext, Knotenköpfe, Status |
| Mikro | `--fs-micro` | 12 / 16 | 400 oder 500 | `text-xs` | Zähler, Badges, Tastenkürzel |

Monospace nur für technische Kennungen hinter „Technische Details“.

## Maße
- Raster 8 pt (4 als Halbschritt): `--s-1` … `--s-6` = 4, 8, 12, 16, 24, 32.
- **Zwei Höhen:** `--h-lg` 44 für Aktionen (Knöpfe), `--h-md` 36 für Einstellungen (Auswahl, Segmente, Chips, Symbolknöpfe). 36er bekommen per `::after` eine Klickfläche von 44.
- **Radien:** `--r-btn` 12 (Knöpfe), `--r-ctl` 8 (Einstellungen), `--r-tile` 12 (Bilder, Karten); Chips und Symbolknöpfe rund.

## Bedienelemente
- `.btn` Nebenknopf, `.btn.primary` Hauptknopf, `.btn.ghost` ohne Rahmen, `.btn.danger` Löschen, `.btn.sm` 36er Werkzeugknopf.
- `.icon` runder Symbolknopf, `.pill` Auswahlknopf mit SVG-Pfeil (`.chev`), `.seg` Segmente mit `aria-pressed`, `.chip` Projekt-Chip mit Häkchen bei `aria-pressed="true"`.
- Zustände: Hover heller, Gedrückt `--c-fill-3` und `scale(.98)`, Fokus `0 0 0 2px bg, 0 0 0 4px focus`. Bei `prefers-reduced-motion` keine Übergänge.
- Icons: ein Strich-Icon-Satz (Lucide-Stil, 2 px, rund), inline SVG. Keine Unicode-Zeichen als Icons.

## Muster
- **Seitenleiste** gleich auf jeder Ansicht: Suche ⌘K, Sammlung, Library, Plugin-Seiten (Playground, Styler …), Projekte mit „+“, unten Anbieter.
- **Details rechts** (340 px) für das gewählte Element; Esc schließt.
- **Playground:** Verlauf aus Läufen (Karte links, Ergebnisse rechts), schwebende Eingabe unten; Bildmarken wie `@Bild1` werden in den Prompt eingefügt. Scrabble schreibt aus Stichworten und Anhängen bearbeitbare Szenen.
- **Pflicht-Zustände** jeder Ansicht: Laden (Skeleton in Form des Inhalts), Leer (Grund und nächste Aktion), Filter ohne Treffer, Fehler mit Klartext und „Erneut versuchen“ bzw. „Prompt bearbeiten“.

### Tags, Filter und Stapel

- **Filterleiste:** je Gruppe ein `.pill` mit Popover (Mehrfachauswahl, Zahl je Tag, Suchfeld); aktive Filter als `.chip` mit Schließen-Icon; „Alle Filter entfernen“ als `.btn.ghost`. Filter stehen in der URL.
- **Tag-Chip:** bestätigt = ausgefüllter Chip mit Entfernen-Icon; Vorschlag = gestrichelter Rand, daneben Häkchen (übernehmen) und Schließen (ablehnen). Herkunft im Tooltip.
- **Drei-Zustands-Tag** in der Mehrfachauswahl: aus, teilweise (Strich und Zahl), an.
- **Stapel:** Titelbild mit Badge (Layers-Icon und Anzahl) unten rechts; Favorit trägt einen Stern unten links.
- **Tastaturhinweise** als `kbd` in Tokenhöhe 24 px.

### Flows-Canvas

Der Canvas nutzt Standardbausteine statt eigener: React Flow, React Flow UI und shadcn mit Tailwind. Ihre Tokens (`--background`, `--card`, `--primary` …) sind in `apps/flows/ui/flows.css` auf die Tokens oben gemappt. Neue Bedienelemente im Canvas kommen aus diesem Baukasten, Icons aus Lucide.


- **Knoten:** Kopfzeile außerhalb der Karte (Symbol, Typ, rechts das Modell). Die Karte enthält Vorschau oder Leerzustand, Prompt und den Ausführen-Split-Button. Erzeugerknoten sind 320 px breit, Quellknoten 256 px.
- **Ports:** 24 px Punkt mit Typsymbol, Trefferfläche 44 px, Eingänge links, Ausgänge rechts.
- **Werkzeugleiste unter jedem Knoten** (wie ElevenLabs Flows), als Pille im Knoten selbst, damit sie mitzoomt. Ab 60 % Zoom offen, darunter ausgeblendet; unter 35 % zeigt der Knoten nur noch Kopfzeile und Bilder. Inhalt: Modell-Picker, die wichtigsten Einstellungen als Werte (Format, Auflösung, Dauer, Anzahl, Ton), „Weitere Einstellungen“ hinter dem Regler-Symbol, Download, Löschen und ⋯. Im ⋯-Menü stehen nur seltene Aktionen mit Kürzeln: Ausführen ⌘↩, Download ⌘⇧D, frühere Ergebnisse, Umbenennen, Kopieren ⌘C, Einfügen ⌘V, Duplizieren ⌘D, Knoten fokussieren ⌘., Löschen ⌫.
- **Kopfzeile über der Karte:** Typ-Symbol und Name links, Modell oder Zeichenzahl rechts. Doppelklick benennt um; Erwähnungen (`@Name`) ziehen mit.
- **Zustände am Knoten:** Wartet, Läuft (mit Sekunden), Fertig (mit Credits, wenn der Anbieter sie meldet), Fehler (Satz in Rot und „Erneut ausführen“), Veraltet (Orange, Ergebnis bleibt sichtbar).
- **Übersicht als Drehbrett** (unter 35 % Zoom, also auch „Alles“): jeder Rahmen wird zum Plakat mit Phasentitel (Flüstergewicht), Anzahl Knoten und Ergebnisse und bis zu vier Bildern, generierte Ergebnisse vor Referenzen. Knoten im Rahmen und ihre Linien treten zurück. Die Schrift wächst gegenläufig zum Zoom, begrenzt durch die Rahmenbreite. Ein Klick aufs Plakat öffnet die Phase.
- **Dateien auf der Fläche:** Dateien vom Mac, die auf die Fläche gezogen oder eingefügt werden, landen zusammen in einem Datei-Knoten, auf einen vorhandenen Datei-Knoten gezogen kommen sie dazu. Bilder auf der Fläche sind nicht ziehbar; Ziehen innerhalb der Seite verschiebt nur und kopiert nie.
- **Datei-Knoten:** jede Datei zeigt beim Überfahren „Aus dem Knoten entfernen“ (die Datei bleibt in der Library). Doppelklick, „Ansehen“ oder das Vollbild-Symbol auf Ergebnissen öffnet die Vollbildansicht mit Blättern (← →), Download und Entfernen.
- **Referenzen:** Chips und die @-Liste nennen jede verbundene Datei mit ihrer Marke (`@Bild1`, `@Image2`) und ihrem Titel; ein Klick setzt die Marke in den Prompt. `@Knotenname` steht weiter für alle Dateien eines Knotens.
- **Rahmen:** durchscheinende Fläche mit 2-px-Rand, Kopfzeile oben links, Griffe zum Größenziehen nur bei Auswahl. Nur Kopfzeile, Ports und Griffe nehmen Klicks an. Wer den Rahmen verschiebt, verschiebt seinen Inhalt mit.
- **Referenz-Chips:** 32 px hoch, Miniatur, Marke fett und Name. Ein Klick fügt `@Name` in den Prompt ein. Die `@`-Liste unter dem Prompt zeigt höchstens sechs Namen und lässt sich mit den Pfeiltasten und Enter bedienen.
- **Modellauswahl:** Knopf mit dem gewählten Modell, darüber ein Popover mit Suchfeld, Schnellfiltern als Chips (Anbieter, Bearbeiten, Text zu Bild) und der Liste mit Tags in Nebentext. Ohne Modelle steht dort, wo man eins einrichtet.
- **Warnungen am Knoten:** orange getönte Zeile über dem Ausführen-Knopf, ein Satz mit der Abhilfe.
- **Dock unten mittig:** Auswählen, Verschieben, „Knoten hinzufügen“. Das Knotenmenü öffnet sich auch per Rechtsklick und beim Loslassen einer Linie im Leeren, dann gefiltert auf passende Knoten.

## Nicht verwenden
Verläufe, Glow, Glas, Karten in Karten, mehrere Hauptknöpfe in einer Ansicht, Emoji, erfundene Zahlen, Gelb/Grün als zusätzliche Akzente.
