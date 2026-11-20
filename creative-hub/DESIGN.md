# Atelier: Designsystem

Quelle: Entwurf „Atelier Hub“ (claude.ai Design-Fläche, Ansicht 9 „Bedienelemente“). Umgesetzt als CSS-Variablen in `web/app.css`; Werte hier und dort gleich halten.

## Richtung
Dunkles Kreativ-Werkzeug im Stil einer Mac-App: fast schwarzer, neutraler Grund, auf dem Bilder leuchten. Die Oberfläche tritt zurück; Farbe kommt nur aus Inhalten und den Projektpunkten. Vorbilder: Fotos (Dark Mode), Final Cut Pro, fal Sandbox für den Playground.

## Farben (`:root` in app.css)
| Token | Wert | Rolle |
| --- | --- | --- |
| `--c-bg` | #111112 | Grund |
| `--c-side` | #161618 | Seitenleiste |
| `--c-panel` | #18181A | Details, Karten |
| `--c-fill` / `-2` / `-3` / `-4` | #1E1E20 / #2A2A2D / #343437 / #3C3C40 | Bedienelemente: normal, Hover, gedrückt oder gewählt |
| `--c-line` / `--c-hair` | weiß 12 % / 8 % | Ränder, Trennlinien |
| `--c-ink` / `-2` / `-3` | #F2F2F0 / #D2D2CE / #9C9C98 | Text, Fließtext, Nebentext (≥ 6:1) |
| `--c-primary` | #F2F2F0 | Hauptknopf (hell, dunkle Schrift), einer pro Ansicht |
| `--c-focus` | #0A84FF | Fokusring, einzige Akzentfarbe |
| `--c-danger` / `-fill` | #FF6961 / #3A1A19 | Löschen, getönt statt knallrot |

Projektfarben (Punkte): #FF6B57, #BF5AF2, #0A84FF, #30D158, #FF9F0A, #64D2FF, #FF375F.

Porttypen in Flows (`--c-port-*`): Text #D2D2CE, Bild #64D2FF, Video #BF5AF2, Ton #FF9F0A. Sie färben nur Ports und Linien, und jeder Port trägt zusätzlich das Symbol seines Typs.

## Typografie
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
- **Werkzeugleiste unter dem gewählten Knoten:** Modell, „Einstellungen“ (beschriftete Felder aus dem Modellschema), Laden, Duplizieren, Löschen. Popover öffnen sich nach oben.
- **Zustände am Knoten:** Wartet, Läuft (mit Sekunden), Fertig (mit Credits, wenn der Anbieter sie meldet), Fehler (Satz in Rot und „Erneut ausführen“), Veraltet (Orange, Ergebnis bleibt sichtbar).
- **Rahmen:** durchscheinende Fläche mit 2-px-Rand, Kopfzeile oben links, Griffe zum Größenziehen nur bei Auswahl. Nur Kopfzeile, Ports und Griffe nehmen Klicks an. Wer den Rahmen verschiebt, verschiebt seinen Inhalt mit.
- **Referenz-Chips:** 32 px hoch, Miniatur, Marke fett und Name. Ein Klick fügt `@Name` in den Prompt ein. Die `@`-Liste unter dem Prompt zeigt höchstens sechs Namen und lässt sich mit den Pfeiltasten und Enter bedienen.
- **Modellauswahl:** Knopf mit dem gewählten Modell, darüber ein Popover mit Suchfeld, Schnellfiltern als Chips (Anbieter, Bearbeiten, Text zu Bild) und der Liste mit Tags in Nebentext. Ohne Modelle steht dort, wo man eins einrichtet.
- **Warnungen am Knoten:** orange getönte Zeile über dem Ausführen-Knopf, ein Satz mit der Abhilfe.
- **Dock unten mittig:** Auswählen, Verschieben, „Knoten hinzufügen“. Das Knotenmenü öffnet sich auch per Rechtsklick und beim Loslassen einer Linie im Leeren, dann gefiltert auf passende Knoten.

## Nicht verwenden
Verläufe, Glow, Glas, Karten in Karten, mehrere Hauptknöpfe in einer Ansicht, Emoji, erfundene Zahlen, Gelb/Grün als zusätzliche Akzente.
