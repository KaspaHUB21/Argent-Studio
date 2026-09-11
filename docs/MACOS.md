# macOS builds and release prerequisites

The test workflows build separate native applications for Apple Silicon and Intel on macOS 15. The application declares macOS 13.5 as its minimum because the bundled Node 24 runtime requires it. macOS 13.5 and 14 have not been validated by these workflows.

## Local development and testing

Install Node 24, pnpm 11, Rust 1.94 and Xcode command-line tools. Run `pnpm install --frozen-lockfile`, `node scripts/build-runtime.mjs`, `pnpm test`, `pnpm run test:services`, and `ARGENT_BROWSER=webkit pnpm exec playwright test` after installing Playwright WebKit. Build a test application with `pnpm tauri build --bundles app --config .github/tauri.ci.json`, then run `node scripts/ci-macos-smoke.mjs`.

The focused diagnostics additionally exercise real APFS cross-volume moves, destination collisions, concurrent saves, failed-copy recovery, macOS system aliases, symlink rejection, and native Keychain storage. The full workflow runs a separate update-only build using a temporary key and loopback feed. That build must never be published. It verifies the native updater IPC, signed downloads, signature rejection, replacement of an isolated application copy, launch after replacement, and preservation of edited user projects. Native quit tests exercise cancellation and saving before exit. The application smoke tests also check the default Documents project directory. Production builds keep the existing updater public key and HTTPS endpoint.

## Signing prerequisites

Public Mac distribution requires an Apple Developer Program membership, a Developer ID Application identity (certificate and private key) installed in the Mac Keychain, and notarization access. This is separate from Windows Authenticode and from Tauri's updater signature.

- Enrollment: https://developer.apple.com/programs/enroll/
- Developer ID certificates: https://developer.apple.com/account/resources/certificates/list
- Tauri signing instructions: https://v2.tauri.app/distribute/sign/macos/
- Repository secrets, if CI signing is configured later: https://github.com/KaspaHUB21/Argent-Studio/settings/secrets/actions

After installing the identity, supply `APPLE_SIGNING_IDENTITY` and the existing `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` through secure environment variables. For notarization provide either `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`, or `APPLE_ID`, an app-specific `APPLE_PASSWORD`, and `APPLE_TEAM_ID`. Never commit these credentials. Run `node scripts/build-macos-release.mjs` after building the runtime. This signs the bundled compiler and VM, grants JIT permission only to Node, builds and notarizes the app, and verifies the result. Credential-free CI does not validate Apple notarization.

## Publishing updates

Keep the Windows installer and both Mac update archives together in the same release. Mac archive names are `Argent-Studio-VERSION-macos-arm64.app.tar.gz` and `Argent-Studio-VERSION-macos-x64.app.tar.gz`, with their `.sig` files. The DMG is for first-time installation; the app archive is for in-app updates.

`node scripts/update-manifest.mjs release-input.json` accepts an `artifacts` object mapping `windows-x86_64`, `darwin-aarch64`, and `darwin-x86_64` to local signed files, plus an optional `output` path. This mode rejects missing platforms. Upload only after tests and signature verification pass. Do not replace the live feed with a partial Mac-only manifest. Without an input file, the existing Windows-only release process remains available.

Native file-picker interaction, Gatekeeper behavior on a clean user Mac, Apple notarization, and actual paid AI provider requests require separate validation; browser mocks do not prove those paths.
