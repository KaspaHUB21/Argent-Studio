# Gebündelte Argent-Toolchain

Die Quellbasis dieser Aktualisierung ist Argent [`b312deda6fe10f6493c8d49eb748e3f61860458a`](https://github.com/argent-lang/argent/tree/b312deda6fe10f6493c8d49eb748e3f61860458a). SilverScript bleibt auf `3ed973335b59269293564805cc2c58a14595ec03` (v1.0.0), rusty-kaspa auf `a41a333b08848f41bf737b72592e463a6011b8ac`. Das ist ein festgehaltener Versionsstand, keine automatische Nachführung auf den jeweils neuesten Branch.

`resources/toolchains/argent-provenance.json` hält die Quellrevision und lokalen Studio-Anpassungen fest. Die Kopie unter `resources/toolchains/argent-master` ist kein unverändertes Upstream-Checkout: Studio ergänzt insbesondere seinen JSON-Szenario-Adapter `examples/studio_test.rs`; generierte Upstream-Beispielartefakte werden nicht als aktuelle Buildnachweise übernommen. `Cargo.lock` bindet die aufgelösten Abhängigkeiten. Der aktive KI-Skill und die mitgelieferten Sprachreferenzen müssen zu dieser Quellbasis passen.

## Compiler und Runtime gemeinsam bauen

`node scripts/build-runtime.mjs` baut mit `--locked` aus derselben Quellkopie den Compiler `resources/bin/argentc` und den lokalen VM-Runner `resources/bin/ArgentTestRunner-v1` (unter Windows jeweils `.exe`). Der Runner verwendet `argent-runtime` aus derselben Workspace-Version. Die Studio-Anwendung wird anschließend mit diesen Helfern und den aktualisierten Referenzen neu gebaut. Ein Quellupdate allein aktualisiert weder eine ältere Studio-EXE noch eine installierte App.

Alte generierte `.sil`-Dateien und Artefakte sollten mit dem aktualisierten Compiler neu erzeugt werden. Ein Artefakt enthält Compilerentscheidungen und Runtime-Rezepte; eine erfolgreiche Konsistenzprüfung attestiert keine Compilerherkunft und kompiliert das Artefakt nicht erneut.

## Neue Gruppenregeln

Die verbindliche Erklärung steht in [`leader-delegate-input-groups.md`](../resources/toolchains/argent-master/docs/security-invariants/leader-delegate-input-groups.md), insbesondere Regeln 5 und 6. Koordinierte Leader autorisieren alle Fortsetzungsausgaben ihres Covenant; konsumierte Delegates autorisieren keine eigene Fortsetzung. Genesis-Ausgaben aus `spawns` gehören nicht zu dieser Fortsetzungsgruppe.

Ein gewöhnlicher Eintrag ohne `consumes` auf einem Delegate-fähigen Actor muss an erster Covenant-Eingabeposition stehen, wenn seine minimale Fortsetzungszahl null ist. Das umfasst `emits none`, Bereiche mit Minimum null und reine Spawn-Einträge. Die Regel verbietet nicht pauschal unabhängige Stapeltransaktionen. Actor-Authentifizierung identifiziert außerdem den Vertrag, nicht die ausgewählte Entry-Funktion; entry-spezifische Autorisierung benötigt zusätzliche Zustands-/Transaktionsregeln oder getrennte Actors.

Die Runtime kann Gruppenverletzungen früh melden; die generierten Scriptprüfungen setzen die Regeln durch. Frontend-Szenarien liefern weiterhin konkrete Ein-/Ausgaben und `authorizing_input`. Die Editoroberfläche ersetzt keine Gruppenvalidierung.

## Nachweise und Grenzen

Quellprovenienz, erfolgreicher Compilerbuild, ausgeführte Compiler-/Runtime-Tests und native Studio-Prüfung sind getrennte Nachweise. Aktuelle Testergebnisse gehören zum Prüfbericht des jeweiligen Builds. Diese Versionsbeschreibung behauptet keinen erfolgreichen Build auf einer anderen Plattform und keine Aktualisierung eines bereits installierten Programms.

Lokale Script-/VM-Prüfungen beweisen weder vollständige Konsensvalidierung noch Aktivierung oder Annahme in einem öffentlichen Netzwerk. Netzwerk, Transaktionsversion und konkrete Deployment-Bedingungen müssen gesondert geprüft werden. Compiler und KI-Skill begründen keine Produktionsfreigabe oder ein Sicherheitsaudit.

## Bestehende Projekte

Der aktuelle Compiler verwendet Modulimporte, zum Beispiel `import "./player.ag";` statt `import actor Player from "./player.ag";`. Das mitgelieferte Stones-Beispiel ist angepasst. Bereits angelegte Nutzerprojekte werden absichtlich nicht überschrieben; dort muss alte Importsyntax bei Bedarf umgestellt und anschließend neu gebaut werden. Der Editor kann alte Actorimporte weiterhin anzeigen.

Der lokale Buildbeleg `resources/bin/toolchain-build.json` verzeichnet Plattform, Architektur, Quell-/Lockfile-Provenienz und SHA256 der erzeugten Helfer. `scripts/build-desktop.mjs` kopiert die Ressourcen neben die erzeugte EXE und berücksichtigt `CARGO_TARGET_DIR`.
