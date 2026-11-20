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

## Nicht verwenden
Verläufe, Glow, Glas, Karten in Karten, mehrere Hauptknöpfe in einer Ansicht, Emoji, erfundene Zahlen, Gelb/Grün als zusätzliche Akzente.
