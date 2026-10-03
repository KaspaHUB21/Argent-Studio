# Release preparation 0.45.13

Prepared against the existing KaspaHUB21/Argent-Studio GitHub repository and published v0.45.12. Package, Cargo manifest/lock and Tauri version are 0.45.13. Existing updater identity/public key, update endpoint and previous releases remain unchanged.

Includes the current unreleased project-aware AI team, isolated verification, inline review/proposal previews, proposal follow-up chat, Code History, pinned compiler/runtime update and German/English translation fixes. Source names, source values and external diagnostics retain their original content.

## Local verification (Windows, 2026-10-03)

- 169 Node/language-service tests passed.
- 144 browser tests passed, including language switching, preserved transaction identifiers and pending proposal status.
- 29 native Rust tests passed, including real isolated compiler and passing/failing VM checks.
- Final Windows application smoke passed: test-output/ci-windows/7240f464b4dc4c9fbd554d7184e19f61. AI verification, proposal follow-up, review markers, inline previews and Code History all checked true.
- Installer and updater signature generated using the existing updater key. Authenticode status: NotSigned. The updater signature is separate from a trusted Windows publisher signature.
- Copied runtime compiler, test runner and Node hashes match the bundled build receipt.

Local files: release/ArgentStudio-0.45.13/Argent-Studio-0.45.13-windows-x64-setup.exe and matching .sig; portable argent-studio-tauri.exe plus resources; SHA256SUMS-WINDOWS.txt.

## macOS and GitHub completion

Existing macOS CI retains Apple Silicon and Intel jobs and now also runs on pull requests. New browser suites select WebKit on Mac. Native smoke requires AI verification, history, review/proposal and follow-up success plus native architecture and receipt/source/binary integrity. Signing records updated binary hashes without losing the pre-signing digests.

Native macOS builds and tests have not run on this Windows host. Run both existing Mac CI jobs against this prepared source before releasing. Collect both preview ZIPs, updater .app.tar.gz files and signatures, then generate the combined three-platform latest.json using scripts/update-manifest.mjs with the complete artifact map documented in docs/MACOS.md. CI updater test packages use ephemeral keys and loopback feeds and are not release downloads.

No latest.json was generated from the incomplete Windows-only asset set. No commit, push, tag or GitHub release was created. Keep v0.45.13 unpublished until both Mac results and all release assets are complete.
