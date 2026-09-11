# Release verification and signing

Build native helpers with node scripts/build-runtime.mjs before pnpm tauri build. These commands generate ignored .cargo/config.toml with neutral Rust source paths. Do not override its rustflags in a release build. Rebuild every native helper when compiler flags change.

Scan the unpacked desktop executable, compiler and transaction runner with node scripts/check-binary-paths.mjs followed by their paths. Scan before packaging: compressed installers hide embedded strings.

## Windows Authenticode

A trusted code-signing certificate or managed signing service is required. An unsigned installer must be explicitly described as unsigned. A checksum and a self-signed certificate do not establish a trusted publisher.

With an appropriate certificate in the Windows certificate store, use the Windows SDK SignTool with SHA-256 file digest and an RFC 3161 SHA-256 timestamp. Select the intended certificate explicitly. Sign the application and owned helper binaries before bundling, then sign the final installer. Do not overwrite third-party runtime signatures. Verify each signature and its timestamp using SignTool verify /pa /all /v, then download the published installer and verify again.

Keep private keys, certificate exports and signing-service credentials outside the repository. Release publishing must not claim signing unless verification passed. Signing is currently pending certificate/service provisioning.

## Git commits and version tags

Configure a dedicated SSH or GPG signing key and register its public signing key on the maintainer GitHub account. Enable commit.gpgsign and tag.gpgSign for this repository. Create annotated signed release tags and verify signatures locally and on GitHub. A lightweight tag does not carry a signature. Do not rewrite already published commits or move existing release tags to retrofit signatures.

## Validation

Run Node and browser regression tests, Rust tests, real compiler/transaction tests and packaged desktop smoke checks. Record which operating systems were actually tested. Build numbers and release notes must distinguish a corrected installer from older downloads.

## Signed application updates

The updater uses the public key in src-tauri/tauri.conf.json. Its private key must remain outside Git. The local Windows build script uses an encrypted key in the maintainer's .tauri directory and a password protected with Windows DPAPI for the same Windows user. Back up the key and password securely; DPAPI data alone cannot be decrypted on a different Windows account or machine. Losing this key prevents installed clients from accepting future updates.

Run scripts/build-windows.ps1 in PowerShell after building the native helpers. It loads the protected password only for the build process and clears the signing environment afterward. Other build environments must provide TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD securely.

Then run node scripts/update-manifest.mjs. Publish the matching setup.exe, setup.exe.sig and latest.json in the same GitHub Release. The manifest references the version-specific installer URL. Keep the release in draft until every asset is uploaded, then mark it latest. Never publish a latest release without latest.json, as installed clients use releases/latest/download/latest.json. The manifest notes come from the matching English CHANGELOG.md section.

Run the packaged executable with --verify-update --verify-update-report followed by an absolute JSON report path to test the public feed. This mode downloads and verifies the released installer, checks that a corrupted signature is rejected, and exits without installing. It deliberately permits re-verifying the current version only in this explicit diagnostic mode.

This cryptographic update signature does not replace Windows Authenticode signing. Updates are enabled in Windows release builds and macOS preview builds. For a combined release, include both Mac app archives and their updater signatures and generate the complete feed as described in [MACOS.md](MACOS.md). Mac preview ZIPs are first-install downloads; they are not Apple-notarized builds.
