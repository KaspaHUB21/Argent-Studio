# KI-Assistent in Argent Studio

Der Assistent nutzt OpenAI Responses mit der Modellvorgabe `gpt-6.1-sol` und Denkaufwand `max`. Die Modell-ID ist anpassbar und gilt für das gesamte KI-Team. KI-Aufrufe benötigen einen API-Schlüssel; Projektzugriff braucht eine zusätzliche ausdrückliche Freigabe im Chat. Ohne diese Freigabe darf kein automatischer Projektkontext übertragen werden. Vom Nutzer selbst eingegebener Code ist Teil seiner Anfrage.

## Team und Kosten

Bei aktiviertem KI-Team bearbeiten drei Arbeitsagenten Entwurf, Umsetzung und Prüfung. Ein Supervisor führt ihre Ergebnisse zusammen; ein verpflichtender zweiter Durchlauf aller drei Arbeitsagenten bewertet den konkreten Vorschlag und die lokalen Prüfergebnisse. Danach muss der Hauptagent mit einer Begründung ausdrücklich freigeben oder ablehnen. Bei fehlender Prüfung, Hauptagentfehler oder ausgeschöpftem Prüfbudget bleibt die Übernahme gesperrt. Die Arbeitsagenten laufen parallel, und alle verwenden dieselbe Modell-ID. Das aktivierte Team bearbeitet auch allgemeine Fragen und Erklärungen. Zugriff auf Projektdateien erhalten die Agenten ausschließlich mit der Freigabe von Projektcode. Ohne diese Freigabe arbeiten sie mit der Nutzeranfrage und allgemeinen gebündelten Referenzen.

Die Einstellungen begrenzen Ausgabetokens pro API-Anfrage und Anfragen je Agent (Vorgabe: 32.768 Tokens, bis zu acht Anfragen). Die Anfragen der ersten und zweiten Arbeitsagentenrunde teilen sich je Rolle dieses Budget. Mindestens eine Anfrage wird für die zweite Runde reserviert. Ein Limit von nur einer Anfrage reicht deshalb für einen geprüften Teamvorschlag nicht aus. Der Hauptagent besitzt sein eigenes Anfragelimit. Teamarbeit erzeugt zusätzliche API-Aufrufe. Diese Grenzen sind keine harte Geldgrenze. Der Sitzungstokenzähler ist kein Guthaben; optional angezeigte Organisationskosten umfassen die gesamte Organisation und können verzögert sein.

## Aktiver Covenant-Skill

`frontend/covenant-skill.js` enthält den tatsächlich an die KI übermittelten Skilltext, identisch mit `resources/ai/covenants/SKILL.md`. Er gehört in die Instruktionen jedes Arbeitsagenten und des Supervisors. Der Skill vermittelt eine Arbeitsmethode und Quellenbindung, kein trainiertes Spezialmodell und keine Expertenzertifizierung.

Er fordert eine Prüfung von Akteuren, Zuständen, Übergängen, Autorisierung, Werten, Typgrenzen und ICC anhand der gebündelten Argent-Quellen. Die dokumentierten Dependency-Pins sind SilverScript `3ed973335b59269293564805cc2c58a14595ec03` und rusty-kaspa `a41a333b08848f41bf737b72592e463a6011b8ac`. Die Argent-Quellbasis ist `b312deda6fe10f6493c8d49eb748e3f61860458a`, mit Provenienz und lokalen Studio-Anpassungen in `resources/toolchains/argent-provenance.json` dokumentiert. Der Skill enthält zusätzlich die Regeln für Leader-/Delegate-Eingabegruppen, vollständige Autorisierung der Fortsetzungsausgaben und die Position gewöhnlicher Einträge mit null möglichen Fortsetzungen. Genesis-Ausgaben und unabhängige Stapeltransaktionen werden dabei getrennt berücksichtigt. Die Quellrevision allein bestätigt keinen erneuten Build eines bereits installierten Programms; siehe [Toolchain](TOOLCHAIN.md). `read_reference` liefert die vorhandenen gebündelten Dokumente; exakte Spracheigenschaften und APIs müssen daraus oder aus tatsächlich gelesenen Beispielen belegt werden.

## Vorschläge und Verifikation

Codeänderungen erscheinen als Vorher/Nachher-Vorschlag. Nur die ausdrückliche Übernahme durch den Nutzer verändert den Editor. Speichern bleibt ein eigener Schritt. Vorhandene Dateien müssen vor ihrer Änderung gelesen werden; veraltete Vorschläge dürfen aktuelle Änderungen nicht überschreiben.

Die KI kann einen Vorschlag in einem temporären Projekt mit dem gebündelten Compiler prüfen. Dieses Kompilieren speichert den Vorschlag nicht in den Nutzerdateien. Eine VM-Prüfung erfordert ein konkret über das Szenario-Werkzeug eingereichtes Szenario und ein passendes Artefakt. Ein erfolgreiches Kompilieren beweist keine VM-Ausführung; eine erfolgreiche lokale VM-Prüfung beweist weder vollständige Konsensvalidierung noch öffentliche Netzwerkannahme oder Produktionsreife. Fehlende Prüfschritte bleiben ausdrücklich unbestätigt.

Es gibt keinen Zugriff auf Wallets, Transfers, Deployment oder eine beliebige Shell. API-Schlüssel und optionale Adminschlüssel bleiben getrennt im Betriebssystem-Anmeldespeicher. `store:false` wird für Modellantworten gesetzt. Bereits an OpenAI übertragenen Inhalt kann ein späterer Freigabeentzug nicht zurückholen.

## Lokale VM-Szenarien

Das Werkzeug `verify_proposal` erwartet im Feld `scenarios` einen JSON-Array-Text. Ein direktes Szenario erwartet standardmäßig `passed`. Ein negativer Test nutzt eine explizite Erwartung:

```json
[{"scenario":{"version":1,"inputs":[],"outputs":[]},"expectedStatus":"failed"}]
```

Dieses Beispiel zeigt nur die Hülle; es ist kein vollständiger gültiger Vertragstest. `scenario` muss zum tatsächlich kompilierten Artefakt passen. Die Auswertung zeigt tatsächlichen Status, erwarteten Status und deren Übereinstimmung. Ein Laufzeitfehler gilt nicht als erwartete Regelablehnung. Int64-Zahlen bleiben verlustfrei erhalten. Bis zu acht Szenarien werden je Prüfung ausgeführt. Externe Artefaktpfade werden abgewiesen; eine Prüfung mehrerer separat gebauter Apps benötigt eine zusätzliche sichere Artefaktzuordnung und wird hier nicht behauptet.

Die Snapshot-Prüfung unterstützt bis zu 128 `.ag`-Dateien, maximal 160.000 Zeichen je Datei und insgesamt 2 MB UTF-8-Quelldaten. Änderungen am geöffneten Projekt, den Editorpuffern, dem Build-Einstieg oder der Codefreigabe machen einen alten Prüfstand ungültig.
## Vorschläge direkt im Editor

Für bestehende Dateien markiert Studio die geänderten Codezeilen. Mouseover oder die Stern-Schaltfläche links an der Zeile öffnen den konkreten Vorher/Nachher-Vergleich. Die Schaltfläche ist mit Tab und Enter bedienbar. Übernehmen ist erst nach lokaler Prüfung und, bei aktiviertem Agententeam, der Hauptagententscheidung verfügbar. Es wird immer der gesamte geprüfte Vorschlag gemeinsam übernommen; das Herauslösen einzelner Blöcke würde einen anderen, ungeprüften Programmstand erzeugen. Änderungen bleiben zunächst ungespeichert und sind per Strg+Z rückgängig zu machen. Eigene Änderungen entfernen veraltete Markierungen. Für neue Dateien bleibt die vollständige Vorschau im KI-Bereich erhalten.

## Lokale Code-History

Unter **Datei → Code-History** sind ältere Stände der aktiven Argent-Datei verfügbar. Studio erfasst den geöffneten Stand, zeitversetzt Entwürfe und Stände beim Speichern beziehungsweise vor und nach einer KI-Übernahme. Die History bleibt beim Neustart erhalten und ist je Projekt/Datei getrennt. Sie beginnt mit dieser Version; ältere, noch nie erfasste Stände lassen sich nicht rückwirkend rekonstruieren.

Die History zeigt Zeit, Anlass und zwei Codeansichten. **Im Editor wiederherstellen** sichert zuerst den aktuellen Entwurf und ersetzt dann den Editorinhalt. Die Projektdatei bleibt bis zum expliziten Speichern unverändert. Es werden höchstens 50 Stände beziehungsweise 4 MB je Datei gespeichert; ältere Stände entfallen bei Erreichen des Limits. Speicherort ist der lokale Anwendungsdatenordner unter `code-history`. Dafür werden keine KI-Anfragen gesendet.

## Prüfhinweise an Codezeilen

Auch eine reine Codeprüfung kann Fundstellen markieren, ohne einen vollständigen Änderungsvorschlag zu erzeugen. Der Hauptassistent verwendet dafür `mark_review` mit tatsächlich gelesener Datei und gültigen Zeilenbereichen. Blaue Zeilenmarkierungen und eine Raute links öffnen den Hinweis mit aktuellem Code, Erläuterung und optionalem ausdrücklich ungeprüftem Vorschlag. Die Markierungen bleiben bis zur Bearbeitung der Datei, zum Projektwechsel, neuen Chat oder Widerruf der Freigabe bestehen. `show_line` navigiert nur und erzeugt diese Markierungen nicht.

**Änderung ausarbeiten** beauftragt den Assistenten ausdrücklich, einen vollständigen Codevorschlag zu erstellen und zu prüfen. Die reine Markierung ändert keine Datei, führt keine Compiler-/VM-Prüfung aus und bietet deshalb keine direkte Übernahme an. Übernehmen bleibt dem überprüften Codevorschlag vorbehalten. Bei einer ausdrücklich angefragten Markierung wird eine reine Chatantwort höchstens einmal innerhalb des eingestellten Anfragebudgets zu einer Werkzeuganfrage korrigiert. Leere Befundlisten sind zulässig; dann wird kein Problem erfunden und die fehlenden Befunde werden ausdrücklich gemeldet.

## Rückfragen bei offenem Vorschlag

Ein offener oder abgelehnter Codevorschlag blockiert den Chat nicht. Rückfragen können Ablehnungsgründe klären, weitere Tests anfordern oder den Entwurf überarbeiten lassen. Bei aktiver Projektfreigabe erhält der Assistent den noch nicht übernommenen Entwurf zusammen mit seiner Entscheidung und den Prüfergebnissen als Kontext. Die eigentlichen Projektdateien bleiben unverändert.

Eine neue Version desselben Vorschlags ersetzt die alte Vorschau und benötigt neue lokale Prüfungen sowie bei aktiviertem Team drei neue Agentenberichte. Während der Bearbeitung und nach einem Abbruch oder Fehler bleibt Übernehmen gesperrt. Ein Vorschlag für eine andere Datei benötigt zunächst das Verwerfen oder Übernehmen des bereits offenen Vorschlags; allgemeine Rückfragen bleiben trotzdem möglich.
