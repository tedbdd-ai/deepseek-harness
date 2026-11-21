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

### Phase 2: Pipeline (Studio-Modus)

- Umschalter Lab/Pipeline in der oberen Leiste, auf derselben Datenbasis.
- Pipeline zeigt die Szenen als horizontalen Filmstreifen: Nr., Dauer, `@Assets`, Startbild, Clip und Status (Entwurf → Keyframe ok → Video ok). Umsortieren per Ziehen ändert die Lesereihenfolge auf der Fläche.
- Mehrere Karten wählen und „Alle Keyframes rendern“ bzw. „Alle Videos rendern“, mit einer Kostenfrage vorab.
- Das Moodboard wird zur Style-Bible: In der Pipeline ist es schreibgeschützt.

### Phase 3: ComfyUI über Rancher und Rezepte

- Provider-Plugin `providers/comfyui`: Es nimmt einen exportierten API-Workflow (JSON) und macht die markierten Eingänge (`prompt`, `ref_image`, `seed`, `denoise`) zu Ports. Aufträge gehen an eine Queue vor dem Rancher-Cluster, und Fortschritt und Ergebnis kommen zurück in den Knoten. Adresse und Zugang sind Plugin-Einstellungen.
- „Als Rezept speichern“: Eine markierte Knotenkette wird mit Version (`Keyframe_Flux_v2`) gespeichert und erscheint in der Pipeline im Rezept-Menü jeder Karte.
- Vergleichsknoten: Er legt Ergebnisse paralleler Zweige nebeneinander und markiert den Gewinner.
