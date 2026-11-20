# Atelier: Designsystem

Quelle: Entwurf „Atelier Hub“ (claude.ai Design-Fläche, Ansicht 9 „Bedienelemente“). Umgesetzt als CSS-Variablen in `web/app.css`; Werte hier und dort gleich halten.

## Richtung
Dunkles Kreativ-Werkzeug im Stil einer Mac-App: fast schwarzer, neutraler Grund, auf dem Bilder leuchten. Die Oberfläche tritt zurück; Farbe kommt nur aus Inhalten und den Projektpunkten. Vorbilder: Fotos (Dark Mode), Final Cut Pro, fal Sandbox für den Playground.

## Farben (`:root` in app.css)

Standard ist warmes Papier (hell). Ein weiches Anthrazit gibt es als Dunkelmodus über den Schalter unten in der Seitenleiste (`data-theme="dark"`, gespeichert im Browser). Die Formensprache folgt Linear (`design/linear.md`), die Farben nicht: fast reines Schwarz mit hellem Punktraster war auf der großen Fläche zu anstrengend.

| Token | Hell | Dunkel | Rolle |
| --- | --- | --- | --- |
| `--c-bg` | #F5F3EE | #1C1C1E | Grund und Canvas |
| `--c-side` / `--c-panel` | #EFECE5 / #FBFAF7 | #202022 / #232325 | Seitenleiste, Karten, Knoten |
| `--c-fill` … `-4` | #FFFFFF … #D6D0C4 | #2A2A2D … #48484C | Bedienelemente: normal, Hover, gedrückt, gewählt |
| `--c-line` | #E2DED4 | #38383B | Haarlinien statt Schatten |
| `--c-tint` … `--c-edge-strong` | Braun 5–32 % | Weiß 5–28 % | Hover-Flächen und kräftigere Ränder, statt fest eingebauter Weißtöne |
| `--c-ink` / `-2` / `-3` | #1F1E1C / #45413A / #6B655B | #EDEBE6 / #C8C5BE / #9A968E | Text (alle ≥ 4,5:1) |
| `--c-primary` | #B4532F | #E08A66 | Terrakotta, die eine Hauptaktion pro Ansicht; Schrift `--c-on-primary` |
| `--c-neutral` | #2B2A27 | #EDEBE6 | neutrale Knöpfe wie „Ausführen“; Schrift `--c-on-neutral` |
| `--c-scrim` | dunkel 72 % | dunkel 78 % | Flächen über Bildern; Schrift immer `--c-on-scrim` (weiß) |
| `--c-dot` | #DCD7CC | #2E2E31 | Punktraster der Fläche, bewusst leise (1,3:1) |
| `--c-danger` | #B3261E | #F2857A | Löschen |

Projektfarben (Punkte): #FF6B57, #BF5AF2, #0A84FF, #30D158, #FF9F0A, #64D2FF, #FF375F.

Porttypen in Flows (`--c-port-*`, hell/dunkel): Text #6B655B/#A8A49C, Bild #2E7D9A/#7CC4DA, Video #7E4BB5/#B48AE0, Ton #B06A0B/#E0A458. Sie färben nur Ports und Linien, und jeder Port trägt zusätzlich das Symbol seines Typs.

## Typografie
Inter Variable (`web/fonts`, OFL) mit `cv01`, `ss03`, `zero`; Gewichte 400, 510, 590, nie fett.
Systemschrift (SF Pro). Titel 28/34 halbfett, Abschnitt 17–20 halbfett, Fließtext 15, Nebentext 12–13. Monospace nur für technische Kennungen hinter „Technische Details“.

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
- **Werkzeugleiste unter jedem Knoten, immer offen** (wie ElevenLabs Flows): Modell-Picker, die wichtigsten Einstellungen als Werte (Format, Auflösung, Dauer, Anzahl, Ton), „Weitere Einstellungen“ hinter dem Regler-Symbol, Download, Löschen und ⋯. Im ⋯-Menü stehen nur seltene Aktionen mit Kürzeln: Ausführen ⌘↩, Download ⌘⇧D, frühere Ergebnisse, Umbenennen, Kopieren ⌘C, Einfügen ⌘V, Duplizieren ⌘D, Knoten fokussieren ⌘., Löschen ⌫.
- **Kopfzeile über der Karte:** Typ-Symbol und Name links, Modell oder Zeichenzahl rechts. Doppelklick benennt um; Erwähnungen (`@Name`) ziehen mit.
- **Zustände am Knoten:** Wartet, Läuft (mit Sekunden), Fertig (mit Credits, wenn der Anbieter sie meldet), Fehler (Satz in Rot und „Erneut ausführen“), Veraltet (Orange, Ergebnis bleibt sichtbar).
- **Rahmen:** durchscheinende Fläche mit 2-px-Rand, Kopfzeile oben links, Griffe zum Größenziehen nur bei Auswahl. Nur Kopfzeile, Ports und Griffe nehmen Klicks an. Wer den Rahmen verschiebt, verschiebt seinen Inhalt mit.
- **Referenz-Chips:** 32 px hoch, Miniatur, Marke fett und Name. Ein Klick fügt `@Name` in den Prompt ein. Die `@`-Liste unter dem Prompt zeigt höchstens sechs Namen und lässt sich mit den Pfeiltasten und Enter bedienen.
- **Modellauswahl:** Knopf mit dem gewählten Modell, darüber ein Popover mit Suchfeld, Schnellfiltern als Chips (Anbieter, Bearbeiten, Text zu Bild) und der Liste mit Tags in Nebentext. Ohne Modelle steht dort, wo man eins einrichtet.
- **Warnungen am Knoten:** orange getönte Zeile über dem Ausführen-Knopf, ein Satz mit der Abhilfe.
- **Dock unten mittig:** Auswählen, Verschieben, „Knoten hinzufügen“. Das Knotenmenü öffnet sich auch per Rechtsklick und beim Loslassen einer Linie im Leeren, dann gefiltert auf passende Knoten.

## Nicht verwenden
Verläufe, Glow, Glas, Karten in Karten, mehrere Hauptknöpfe in einer Ansicht, Emoji, erfundene Zahlen, Gelb/Grün als zusätzliche Akzente.
