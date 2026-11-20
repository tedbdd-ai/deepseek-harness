# Flows: Generierung als Knoten auf einer Fläche

Stand: 2026-11-20. Vorbild: ElevenLabs Flows (ElevenCreative, Alpha). Ziel: Foto Playground, Video Playground, Schnitt, Moodboard und Storyboard werden zu Knoten, die man mit Linien verbindet. Statt Eingaben vorab in starren Formularen zusammenzustellen, fließt das Ergebnis eines Knotens als Eingabe in den nächsten.

## Was ElevenLabs macht (Recherche)

Quellen: [Flows-Doku](https://elevenlabs.io/docs/eleven-creative/products/flows), [Launch-Blog](https://elevenlabs.io/blog/introducing-flows-in-elevencreative), [Flows Agent](https://elevenlabs.io/blog/introducing-flows-agent) und der Screenshot des Nutzers.

- **Knotenarten** nach Medium gruppiert: Bild (Generieren, Bearbeiten, Hochskalieren, Freistellen), Video (Generieren, Bearbeiten, Lip-Sync, Dubbing, Komposition), Audio (Sprache, Geräusche, Musik, Voice Changer), Text (Text, LLM) und Upload.
- **Verbinden**: Man zieht vom Ausgang eines Knotens auf einen Eingang. Die Eingänge haben je nach Typ (Text, Bild, Video, Audio) eigene Farben und Symbole und nehmen nur passende Ausgänge an. Zieht man ins Leere, schlägt Flows passende nächste Knoten vor.
- **Ausführen**: Jeder Knoten hat „Run“. Ändert man einen Knoten, läuft nur der Pfad dahinter neu, und unverbundene Zweige bleiben, wie sie sind. Ein fehlgeschlagener Knoten kostet nichts, und die Kosten stehen am Run-Knopf.
- **Anatomie** (Screenshot): Über der Karte stehen links Typ und Symbol, rechts das Modell. Die Karte selbst hat eine Vorschaufläche („Your generation will appear here“), ein Promptfeld und einen Run-Split-Button. Links sitzen die Eingänge (Text, Bild, Video, Audio) als runde, farbige Punkte, rechts der Ausgang. Unter der gewählten Karte erscheint eine Werkzeugleiste mit Modell, Format, Auflösung, Dauer, Ton, Download, Löschen und Mehr.
- **Fläche**: Unten gibt es eine Werkzeugleiste mit Auswahl, Hand, Kommentar und „+“. Daneben liegt eine Promptleiste für den Flows Agent, der Knoten selbst baut (Freigabe je Aktion oder unter einer Kostenschwelle). Rechtsklick öffnet das Knotenmenü.
- **Vorlagen**: Ein Flow mit benannten Ein- und Ausgängen wird veröffentlicht und lässt sich dann mit neuen Eingaben erneut ausführen. So entstehen Varianten in Serie.

## Übertragung auf das Atelier

### Alles bleibt ein Plugin

Neue Naht `creativeNodes` in `core.mjs` (wie `creativeApps`): Jedes Plugin, das etwas erzeugt, meldet seine Knotenart selbst an. Der Flow-Editor kennt keine Modelle.

| Knotenart | Meldet an | Eingänge | Ausgänge | kostet |
| --- | --- | --- | --- | --- |
| Text | Flows | – | Text | nein |
| Aus der Library | Flows | – | Bild, Video oder Audio | nein |
| Moodboard | Flows | – | Bilder des Projekt-Moodboards | nein |
| Einstellung | Flows | – | Szenenprompt (Text), Startbild (Bild) | nein |
| Bild | Foto Playground | Prompt (Text), Referenzen (Bild, mehrere) | Bild | ja |
| Video | Video Playground | Prompt, Startbild, Endbild, Referenzen Bild/Video/Audio | Video, Letztes Bild | ja |
| Komposition | Schnitt | Clips (Video, mehrere, von oben nach unten), Ton (Audio, mehrere) | Video | nein (FFmpeg lokal) |

Eine Knotenart beschreibt `{ type, title, group, icon, inputs, outputs, paid, prompt, fields(), resolve() | run() }`. Quellknoten haben `resolve` (sofort, aus Parametern und Projektdaten), Erzeugerknoten `run` (asynchron, schreibt Ergebnisse in die Library). Bild-, Video- und Schnittknoten rufen die Funktionen ihres eigenen Plugins auf. Es gibt keinen zweiten Generator: Läufe erscheinen weiter im Verlauf des Foto- bzw. Video-Playgrounds, und Ergebnisse landen in der Library und im Projekt.

### Ports und Typen

Es gibt vier Porttypen: Text, Bild, Video, Audio. Jeder Typ hat eine eigene Farbe und ein eigenes Symbol, weil Farbe nie das einzige Merkmal sein darf. Eine Verbindung ist nur zwischen gleichen Typen erlaubt. Ein Eingang ohne `multiple` nimmt eine Verbindung an, und eine neue ersetzt die alte. Mehrere Verbindungen an einem Eingang werden nach der Lage der Quellknoten von oben nach unten geordnet. So legt man im Kompositionsknoten die Clipreihenfolge fest, indem man die Knoten verschiebt.

### Ausführen, Kosten, Veralten

- Der **Ausführen**-Knopf startet nur diesen Knoten. Über das Menü daneben gibt es „Mit fehlenden Schritten davor“ und „Ab hier alles danach“.
- Kostenpflichtige Läufe starten nur auf Klick. Laufen dabei mehr als ein kostenpflichtiger Knoten, fragt ein Dialog erst nach und listet sie auf. Es gibt keinen Automatiklauf, auch nicht bei Änderungen.
- Jedes Ergebnis merkt sich einen Schlüssel aus Parametern, Prompt und Eingabewerten. Weicht der aktuelle Schlüssel ab, zeigt der Knoten „Veraltet“, behält aber sein Ergebnis. Nachfolger rechnen mit dem letzten Ergebnis weiter, bis man sie neu ausführt.
- Die Ausführung läuft auf dem Server. Schließt man den Tab, laufen die Aufträge weiter. Nach einem Neustart des Hubs werden laufende Knoten als „Unterbrochen“ markiert. Ein Videoauftrag bleibt dann im Video Playground sichtbar.
- Fehler stehen als Satz am Knoten, mit „Erneut ausführen“. Nachfolger eines fehlgeschlagenen Knotens starten nicht.

### Speichern

Ein Flow gehört zu einem Projekt, so wie Moodboard und Storyboard (`app_data(flow)`: `{ nodes, edges }` mit Revision). Der Laufzustand (Status, Ausgaben, Schlüssel, Kosten, letzte Ergebnisse) liegt getrennt im Hub-Setting `flows:state:<projekt>`. So kollidieren Editor-Speichern und Server-Ergebnisse nie. Ein Projekt hat eine große Fläche, und Bereiche entstehen durch Anordnen.

### Oberfläche

- **Kopfleiste**: Projektauswahl, Speicherstatus.
- **Fläche** (React Flow): Punktraster, Zoom, Minimap aus.
- **Untere Werkzeugleiste**: Auswählen, Verschieben (Hand), „Knoten hinzufügen“ (Menü nach Gruppen). Rechtsklick auf die Fläche öffnet dasselbe Menü an der Stelle. Zieht man einen Ausgang ins Leere, öffnet sich das Menü mit den passenden Knoten, und die Verbindung entsteht beim Einfügen.
- **Knoten**: Kopfzeile mit Symbol, Typ und Modell. Darunter Vorschau, bei mehreren Ergebnissen mit Blättern. Darunter Prompt und Ausführen-Split-Button. Die Ports haben Beschriftungen als Tooltip und für Screenreader.
- **Werkzeugleiste unter dem gewählten Knoten**: Modell und die Auswahlfelder des Modellschemas, Download, Duplizieren, Löschen.
- **Zustände**: Fläche lädt (Skeleton), leerer Flow (Erklärung, primär „Bild zu Video anlegen“ als Startvorlage, sekundär „Knoten hinzufügen“), Ladefehler mit „Erneut versuchen“. Knoten zeigen Wartet, Läuft (mit Sekunden), Fertig, Fehler, Veraltet und „Eingabe fehlt“.

## Phasen

1. **Jetzt (dieser Schritt)**: Naht `creativeNodes`, Flows-Plugin mit Speicher, Engine und Routen, Knoten Text/Library/Moodboard/Einstellung/Bild/Video/Komposition, Editor, Tests.
2. **Danach**: Audio-Knoten (Sprache, Musik über neue Anbieter), Hochskalieren/Freistellen (`removeBackground` gibt es schon), LLM-Knoten über den Chat-Anbieter, Ergebnis zurück ins Storyboard (Einstellung bekommt Clip), Kommentare.
3. **Später**: Vorlagen (benannte Ein- und Ausgänge, Variantenläufe), Flow-Agent über die Promptleiste mit Freigabe je kostenpflichtiger Aktion, Schnitt-Vorschau mit Remotion.

## Offene Entscheidungen

- F1: Ein Flow pro Projekt (jetzt) oder mehrere benannte Flows pro Projekt.
- F2: Sollen Foto- und Video-Playground langfristig als Einzelknoten-Ansicht des Flows aufgehen? Vorschlag: Sie bleiben vorerst bestehen, weil ihre Formulare mehr Optionen zeigen (Scrabble, Rollen, Verlängern).

## Stand der Umsetzung (2026-11-20)

Phase 1 ist gebaut: die Naht `creativeNodes` in `core.mjs`, `apps/flows/` (`host.mjs`, `lib/engine.mjs`, `editor.jsx`, `block.js`), der Knoten „Bild“ in `playground/host.mjs`, „Video“ in `apps/influencer-video/host.mjs` und „Komposition“ in `apps/schnitt/`. Tests stehen in `flows.test.mjs`. Im Browser wurde auf einer Kopie der Datenbank geprüft: Startvorlage, Knotenmenü (Rechtsklick und Linie ins Leere), Library-Auswahl, ein echter Kompositionslauf mit FFmpeg, Einstellungen, Bestätigungsdialog und Fehlerzustand. Bild- und Videoknoten wurden nicht gegen einen Anbieter ausgeführt, weil das Credits kostet. Ihre Logik ist mit Stubs getestet.

Offen aus Phase 1: Undo, Kommentare, eine Mini-Karte, Tastaturkürzel außer Löschen, Mehrfachauswahl-Aktionen und ein Hinweis, wenn derselbe Anbieterauftrag nach einem Hub-Neustart noch läuft.
