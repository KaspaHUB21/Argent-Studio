# Release preparation 0.45.14

Prepared for the existing KaspaHUB21/Argent-Studio repository and update channel. Package, Cargo manifest/lock and Tauri configuration use 0.45.14. Existing updater public key, endpoint, application identity and previous releases are preserved.

## Change

Update SilverScript from 1.0.0 to workspace version 1.0.1 at immutable revision `a0dd7448ccc7bad5b99140f2c8edbbd0b2a874f1`; use Kaspa registry crates pinned to exact version `2.1.0`. Retain Argent source revision `b312deda6fe10f6493c8d49eb748e3f61860458a` with local Studio compatibility adaptations rather than claiming unchanged upstream support. The compiler sources, Cargo dependency lock and native build receipt must agree on the new pinned revision before release. Rebuild the compiler and transaction runner; changing source files alone does not update installed binaries.

The `kaspa-hashes` 2.1.0 registry package omits its required MSVC assembly file. A local workspace patch uses the same official package with that file and the ISC license restored from immutable official Kaspa v2.1.0 tag revision `01b532e8b553523216471682649693af92f0fd16`. The embedded VCS revision was not publicly resolvable and was not used for restoration. The build script and three other selected platform assembly files match the release tag byte for byte. Package version and hashing logic are unchanged; `vendor-provenance.json` records archive and file checksums.

## Local verification on 2026-10-11

Windows x64 compiler and VM helpers were rebuilt from the locked workspace. Results: 502 Argent workspace tests, 5 hash-crate known-answer tests exercising the restored MSVC assembly, 144 application tests, 28 language-service tests, 145 browser tests, and 29 native Studio tests passed. The fresh compiler/VM and binary receipt were independently verified; positive and negative ticket transitions executed in the real VM.

The packaged Windows smoke check passed, including Tickets, Spawns, Stones, ICC, backend, UI, AI proposal/history checks and private build-path scanning. Report: `test-output/ci-windows/75f5972790b1477fadbf1dd7b2a36b02/summary.json`. The production updater signature for the new installer was verified independently; altered artifact bytes, signatures and trusted comments were rejected. Local artifacts and checksums are in `release/ArgentStudio-0.45.14/`.

The installer was not installed on the maintainer device. Native macOS arm64/x64 builds, packaged checks and updater checks remain pending for this exact update. No complete `latest.json` is generated until both Mac asset sets are available. Windows Authenticode status is NotSigned.

## CI finding and correction

The first Windows CI run passed at commit `b05b564`. The Apple Silicon run exposed a project-load timing issue: the UI retained a previous build success during preflight saving and announced the new success before final log persistence completed. Project loading remained correctly locked while that work was active. Studio now shows the compiling status immediately and reports completion after finalization. The project regression explicitly delays both writes and verifies the busy/finished boundary in German and English, without extra timeouts or retries. Both platform workflows must be rerun for the final source revision before release; the failed first macOS run is not release evidence.

The next Apple Silicon run exposed an additional keyboard-focus issue in the structure view: a background refresh removed the focused SVG connection before Enter could pin its details. The view now restores focus by connection or block identity after redraw. A regression forces a refresh between focus and Enter and checks that keyboard interaction and pinned details survive. Failed intermediate workflows are not release evidence; rerun both platform workflows for the final correction.

## Required verification

Preparation does not establish that release checks have passed. Record results from this exact source revision before publishing:

- Run `node scripts/build-runtime.mjs` to rebuild native helpers and record provenance.
- Run `pnpm test`, `pnpm test:services`, the configured Playwright browser suite and native Rust tests.
- Run real compiler/VM regression checks and the packaged Windows smoke workflow.
- Run both native macOS CI jobs (Apple Silicon and Intel), including packaged application and updater checks.
- Verify helper hashes against the build receipt and scan native binaries for private source paths.

## Release assets

Collect assets from the same tested source revision:

- `Argent-Studio-0.45.14-windows-x64-setup.exe` and `.sig`.
- `Argent-Studio-0.45.14-macos-arm64-preview.zip` and `Argent-Studio-0.45.14-macos-x64-preview.zip`.
- `Argent-Studio-0.45.14-macos-arm64.app.tar.gz` and `Argent-Studio-0.45.14-macos-x64.app.tar.gz`, each with its production updater `.sig`.
- `latest.json` containing `windows-x86_64`, `darwin-aarch64` and `darwin-x86_64`, plus `SHA256SUMS.txt`.

Use the existing production updater key and verify signatures before creating the complete manifest with `scripts/update-manifest.mjs`. Never publish CI updater test packages using ephemeral keys or loopback feeds. macOS preview archives are not Apple-notarized; updater signatures do not replace Windows Authenticode.

Publication was authorized after local preparation. Commit, push and signed tag creation must preserve this version and source snapshot; publish only after Windows and both native macOS workflows pass and the complete signed asset inventory is verified. See [RELEASE.md](RELEASE.md) and [MACOS.md](MACOS.md).
