# Flows: Film-Workflow von Freestyle zu Fließband

Stand: 2026-11-21. Grundlage ist das Konzept „AI-Film-Workflow im React-Flowboard“ vom selben Tag. Die Fläche selbst (Knoten, Ports, Rahmen, Vorlagen) steht schon, siehe `2026-11-20-flows-canvas.md`. Hier geht es um den Ablauf: Wie man vom losen Moodboard über die Shotliste zu fertigen Clips kommt, ohne Kabelsalat und ohne Abtippen.

## Probleme der ersten Vorlage

- Das Moodboard bestand aus Mikro-Knoten (Look, Akzent, Grundton, Figuren). Einige waren gar nicht verkabelt, weil niemand für jede Farbe ein Kabel zieht.
- Globale Konstanten (Outfits, Figur, Set) liefen als lange Kabel quer über alle Phasen.
- Die Szenenliste des LLM war Fließtext. Die Szene-Knoten daneben hatten keine Verbindung dazu und mussten von Hand befüllt werden.
- Die Reihenfolge „Storyboard vor Figur und Set“ beißt sich: Startbilder brauchen die fertige Figur und das fertige Set.

## Drei Muster

1. **Moodboard als Container.** Der Rahmen sammelt alles ein, was in ihm liegt, und gibt es über seine Ausgänge weiter. Innen gibt es keine Kabel. Der Knoten **Style-DNA** (Sprachmodell mit Bildern) verdichtet den Rahmeninhalt zu einem Look-Text (Licht, Kamera und Korn, Palette, Materialien) und wählt zwei bis drei Leitbilder.
2. **Regie mit strukturierter Antwort.** Der Knoten **Regie** liest Story, Look und Moodboard-Bilder und antwortet als JSON: Einstellungen mit Titel, Dauer, Bildausschnitt, Bildprompt und Bewegung sowie die nötigen Figuren und Orte. „Szenen anlegen“ erzeugt daraus Szene-Knoten auf der Fläche. Ein zweiter Klick ersetzt sie nach Rückfrage.
3. **Projekt-Assets statt Kabel.** Jeder Knoten mit Bild-, Video- oder Textergebnis lässt sich als Projekt-Asset festlegen. Danach reicht `@Name` in jedem Prompt: Die Engine hängt die Dateien als Referenz an (`@Bild1` …) beziehungsweise setzt bei Text den Text selbst ein. Auf der Fläche erscheint dafür eine gestrichelte Linie, die man nicht löschen muss. Kabel bleiben für den echten Datenfluss (Startbild → Video → Schnitt).

## Ablauf

1. **Moodboard und Story** (frei): Bilder, Farben, Notizen und die Story-Idee in den Rahmen werfen.
2. **Style-DNA**: Ein Klick verdichtet den Rahmen zu `@Look`.
3. **Regie**: Liefert Shotliste und Asset-Liste. Die Szenen entstehen per Knopf.
4. **Figur und Set**: Charakterblatt und Set rendern und als `@Figur` und `@Set` festlegen.
5. **Keyframes und Videos**: Jede Szene gibt ihren Text an ihr Video. Figur, Set und Look kommen über `@`.
6. **Stimme und Schnitt** wie bisher.

## Phasen

### Phase 1: Lab (jetzt)

- Projekt-Assets: Festlegen und Lösen im ⋯-Menü, ein Abzeichen am Knoten, `@Name` in jedem Prompt, gestrichelte implizite Linien. Implizite Verbindungen zählen beim Planen („mit fehlenden Schritten davor“) und für „veraltet“.
- Knoten Style-DNA und Regie im LLM-Plugin (`nodes/llm`), beide kostenpflichtig und nur auf Klick.
- „Szenen anlegen“ am Regie-Knoten, angelegte Szenen tragen `params.from`.
- Die Vorlage „Kurzfilm“ folgt dem neuen Ablauf, und das Moodboard ist ohne Kabel.

### Phase 2: Pipeline und Einzelschritte (umgesetzt)

- **Einzelschritte als Menüpunkte:** Moodboard, Storyboard und Figur und Set stehen wieder in der Sidebar. Jede Seite zeigt nur ihren Phasenrahmen desselben Flows (Rahmen tragen `params.phase`), dazu freie Knoten und das, was der Rahmen direkt speist. Fehlt die Phase, legt ein Knopf sie aus der passenden Teilvorlage an. „Ganzer Flow“ führt zur Fläche, wo die Schritte verbunden sind.
- **Filmstreifen** (auf der Storyboard-Seite offen, in Flows über die obere Leiste): Er zeigt die Szenen in Shot-Reihenfolge mit Nr., Dauer, `@Assets`, Bild (Clip vor Keyframe vor Startbild) und Status (Entwurf → Keyframe ok → Video ok, außerdem Läuft, Fehler, Veraltet).
- „Schritte anlegen“ baut pro Szene einen Keyframe-Bildknoten und einen Video-Knoten in den Rahmen „Videos“, verbunden mit Szene und Schnitt. Hat eine Szene ein eigenes Startbild, entfällt der Keyframe.
- Karten lassen sich wählen. „Keyframes rendern“ und „Videos rendern“ starten einen gemeinsamen Lauf (Route `run` mit mehreren `nodeId`), ab zwei kostenpflichtigen Schritten mit Rückfrage. „Film schneiden“ rendert fehlende Clips vorher, ebenfalls nach Rückfrage.
- Umsortieren per Ziehen tauscht die Plätze von Szenen, Keyframes und Videos, so dass Lesereihenfolge und Schnitt dem Streifen folgen.
- Wachsende Rahmen schieben die Rahmen rechts von ihnen mit.
- Offen: das Moodboard als schreibgeschützte Style-Bible und ein eigener Pipeline-Schalter. Mit den Schritt-Seiten ist er bisher nicht nötig.

### Nachtrag: Moodboard als Pinnwand (umgesetzt)

- Das Moodboard ist jetzt ein einziger Knoten „Moodboard“ (`nodes/llm`) statt Rahmen mit Datei-, Notiz- und Farbknoten. Die Elemente (`params.items`: Datei, Notiz, Stichwort, Farbe) liegen frei.
- „Look erzeugen“ ersetzt die getrennte Style-DNA in den Vorlagen: Das Ergebnis ist strukturiert (`data`: Look, Licht, Kamera, Palette, Material) und hat Leitbilder. Seine Bilder, Clips und Notizen gibt der Knoten ohne Lauf weiter (`passthrough`). Bei `@Look` gehen nur Look und Leitbilder mit (`mention: false` an den übrigen Ports).
- Die Regie trägt die Story als Feld, der eigene Story-Knoten entfällt. Outfits und Orte liegen in „Figur und Set“ neben Charakterblatt und Set.

### Phase 3: ComfyUI über Rancher und Rezepte

- Provider-Plugin `providers/comfyui`: Es nimmt einen exportierten API-Workflow (JSON) und macht die markierten Eingänge (`prompt`, `ref_image`, `seed`, `denoise`) zu Ports. Aufträge gehen an eine Queue vor dem Rancher-Cluster, und Fortschritt und Ergebnis kommen zurück in den Knoten. Adresse und Zugang sind Plugin-Einstellungen.
- „Als Rezept speichern“: Eine markierte Knotenkette wird mit Version (`Keyframe_Flux_v2`) gespeichert und erscheint in der Pipeline im Rezept-Menü jeder Karte.
- Vergleichsknoten: Er legt Ergebnisse paralleler Zweige nebeneinander und markiert den Gewinner.
