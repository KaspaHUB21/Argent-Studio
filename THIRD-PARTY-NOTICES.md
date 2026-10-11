# Third-party components

Vendored code retains the license provided with that code. The root MIT license applies to original Argent Studio code only.

## Argent

The compiler source snapshot originates from `https://github.com/argent-lang/argent` at commit `b312deda6fe10f6493c8d49eb748e3f61860458a`. The copied sources include the local Studio transaction-runner integration (`examples/studio_test.rs`). This is a vendored working snapshot, not a claim of an unmodified upstream checkout.

- Source: `resources/toolchains/argent-master`
- License: ISC, retained in that directory's `LICENSE`
- Example licenses: retained alongside each public template
- Language-service license: `resources/assets/language/ARGENT-LICENSE`

The local Studio integration uses SilverScript workspace version 1.0.1 at commit `a0dd7448ccc7bad5b99140f2c8edbbd0b2a874f1` and Kaspa registry crates pinned to exact version `2.1.0`. Compatibility adaptations are local Studio changes to the retained Argent source snapshot, not a claim that the unmodified upstream snapshot supports these dependency versions. The Cargo manifests and accompanying lockfile record the resolved dependencies.

## kaspa-hashes

The vendored `resources/toolchains/kaspa-hashes-2.1.0` contains the official registry package version 2.1.0 (ISC; license retained in its `LICENSE`). Its omitted MSVC assembly file and ISC license are restored from immutable official Kaspa v2.1.0 tag revision `01b532e8b553523216471682649693af92f0fd16`, at source path `crypto/hashes`. The package's embedded VCS revision was not publicly resolvable and was not used for restoration. `vendor-provenance.json` records exact origins and file checksums. The local workspace patch preserves package version and hashing logic.

## Node.js

`scripts/build-runtime.mjs` copies the locally installed Node executable for use as the bundled language-service runtime. No Node binary is checked into this repository. The retained runtime license is in `resources/bin/runtime/LICENSE`; distributors must include the notices appropriate to the Node version they package.

## Application dependencies

CodeMirror, Lezer, Tauri, lossless-json, Vite, Playwright, and Rust crates are resolved through the checked-in package manifests and lockfiles. Their packages contain their respective licenses. Preserve applicable third-party notices when distributing compiled applications.
