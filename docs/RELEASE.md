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
