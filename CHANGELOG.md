# Changelog

## 0.45.3

- Group the top navigation by task with keyboard-accessible menus and direct save/build actions.

- Replace application, installer and repository branding with the Kaspa Argent logo.

- Build and test Windows installers automatically with GitHub Actions.
- Allow reversible file removal when Windows projects and the application data folder are on different drives.

## 0.45.2

- Check for new versions automatically when the application starts.
- Review release notes and install updates directly from the application.
- Save pending edits before updating and display download progress.
- Verify update signatures before installation.

## 0.45.1

- Serialize saves and preserve the exact written snapshot so edits during a pending save remain unsaved.
- Clear shared AI context and pending proposals when access is revoked or AI is disabled. Reject late results from the revoked session.
- Route AI source and generated-file reads through native scoped file handles; reject symbolic links and Windows reparse points, including already-open source documents.
- Preserve large decimal/exponent JSON integers without rounding and reject unsupported typed values.
- Remove personal build paths from desktop and helper binaries and add a release binary scanner.
- Repair service-test example paths and add targeted save, AI privacy, numeric and native filesystem regression tests.

The Windows installer remains unsigned pending a trusted code-signing certificate/service. Linux and macOS support are not validated by this Windows release; Linux credential-store configuration remains pending.
