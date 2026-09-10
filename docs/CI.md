# Windows continuous integration

[Windows build and tests](https://github.com/KaspaHUB21/Argent-Studio/actions/workflows/windows.yml) runs for pushes to `main`, pull requests, and manual dispatches from the Actions page.

Each run uses a disposable GitHub-hosted Windows Server 2022 x64 runner. It installs Node.js 24.21.0, pnpm 11.19.0 and Rust 1.94.0, restores dependency/build caches, and builds the compiler and transaction runtime from the vendored sources. Microsoft Edge and the Visual Studio C++ tools are supplied by the runner image.

The workflow runs the application, language service, browser and Rust tests, builds the NSIS installer, and checks the installed application with the native smoke diagnostics. Personal build paths are scanned in the unpacked application and helper binaries.

Successful runs provide an installer artifact with its SHA-256 checksum and source commit. Test reports and available screenshots are retained for 14 days. Open a workflow run, then download its installer under **Artifacts**. Downloading Actions artifacts requires a GitHub account. Stable public downloads remain on the Releases page.

## Signing and releases

CI builds use `.github/tauri.ci.json` to disable creation of updater signatures. The application still contains the public update verification key. No private signing keys or API credentials are required by this workflow. Its token has read-only repository permissions, and checkout credentials are not persisted.

CI installers are test builds without Authenticode or updater signatures. They are not automatically published as releases and must not be added to the update feed. Follow [RELEASE.md](RELEASE.md) when preparing a release.

SignPath integration is pending approval of the project. Once approved, configure its project, signing policy and protected signing credentials, then add signing to the release process. The final Authenticode-signed installer must receive its Tauri updater signature afterwards; modifying an installer after updater signing invalidates that signature.
