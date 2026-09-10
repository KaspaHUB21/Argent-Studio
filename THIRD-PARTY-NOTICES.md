# Third-party components

Vendored code retains the license provided with that code. The root MIT license applies to original Argent Studio code only.

## Argent

The compiler source snapshot originates from `https://github.com/argent-lang/argent` at commit `d08e52dd1e18c9f7e9a2dc482048c2db31d25611`. The copied sources include the local Studio transaction-runner integration (`examples/studio_test.rs`). This is a vendored working snapshot, not a claim of an unmodified upstream checkout.

- Source: `resources/toolchains/argent-master`
- License: ISC, retained in that directory's `LICENSE`
- Example licenses: retained alongside each public template
- Language-service license: `resources/assets/language/ARGENT-LICENSE`

The compiler uses SilverScript v1.0.0 at commit `3ed973335b59269293564805cc2c58a14595ec03`, with the local ABI adapter updated to `check_consistency`. Its rusty-kaspa revision remains `a41a333b08848f41bf737b72592e463a6011b8ac`. The compiler's Cargo manifests pin these revisions. The accompanying Cargo lockfile records the resolved transitive dependencies.

## Node.js

`scripts/build-runtime.mjs` copies the locally installed Node executable for use as the bundled language-service runtime. No Node binary is checked into this repository. The retained runtime license is in `resources/bin/runtime/LICENSE`; distributors must include the notices appropriate to the Node version they package.

## Application dependencies

CodeMirror, Lezer, Tauri, lossless-json, Vite, Playwright, and Rust crates are resolved through the checked-in package manifests and lockfiles. Their packages contain their respective licenses. Preserve applicable third-party notices when distributing compiled applications.
