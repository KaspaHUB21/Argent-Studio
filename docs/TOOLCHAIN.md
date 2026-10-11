# Gebündelte Argent-Toolchain

Die Quellbasis dieser Aktualisierung ist Argent [`b312deda6fe10f6493c8d49eb748e3f61860458a`](https://github.com/argent-lang/argent/tree/b312deda6fe10f6493c8d49eb748e3f61860458a). Studio verwendet SilverScript `a0dd7448ccc7bad5b99140f2c8edbbd0b2a874f1` (Workspace-Version 1.0.1) und die Kaspa-Crates aus der Registry, exakt Version `2.1.0`. Die Argent-Quellbasis bleibt unverändert; Studio passt die lokale Integration an diese Dependencies an. Dies ist keine Behauptung, dass die unveränderte Argent-Upstream-Revision SilverScript 1.0.1 unterstützt. Das ist ein festgehaltener Versionsstand, keine automatische Nachführung auf den jeweils neuesten Branch.

`resources/toolchains/argent-provenance.json` hält die Quellrevision und lokalen Studio-Anpassungen fest. Die Kopie unter `resources/toolchains/argent-master` ist kein unverändertes Upstream-Checkout: Studio ergänzt insbesondere seinen JSON-Szenario-Adapter `examples/studio_test.rs`; generierte Upstream-Beispielartefakte werden nicht als aktuelle Buildnachweise übernommen. `Cargo.lock` bindet die aufgelösten Abhängigkeiten. Der aktive KI-Skill und die mitgelieferten Sprachreferenzen müssen zu dieser Quellbasis passen.

Die Registry-Veröffentlichung von `kaspa-hashes` 2.1.0 lässt die von `build.rs` benötigte MSVC-Assembly-Datei aus. Studio ergänzt diese Datei und die ISC-Lizenz aus dem offiziellen Kaspa-Release-Tag v2.1.0, Commit `01b532e8b553523216471682649693af92f0fd16`. Die in `.cargo_vcs_info.json` eingebettete Revision war öffentlich nicht auflösbar und ist daher nicht die Wiederherstellungsquelle. `build.rs` und die drei weiteren verwendeten plattformspezifischen Assembly-Dateien stimmen zwischen Registry-Paket und Release-Tag bytegenau überein. Die lokale Kopie `resources/toolchains/kaspa-hashes-2.1.0` wird über einen Workspace-Patch eingebunden; Version und Hashlogik bleiben unverändert. `vendor-provenance.json` dokumentiert die Registry-Herkunft sowie Quellen und Prüfsummen der ergänzten Dateien.

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
