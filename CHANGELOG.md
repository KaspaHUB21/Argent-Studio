# Changelog

## 0.45.1

- Serialize saves and preserve the exact written snapshot so edits during a pending save remain unsaved.
- Clear shared AI context and pending proposals when access is revoked or AI is disabled. Reject late results from the revoked session.
- Route AI source and generated-file reads through native scoped file handles; reject symbolic links and Windows reparse points, including already-open source documents.
- Preserve large decimal/exponent JSON integers without rounding and reject unsupported typed values.
- Remove personal build paths from desktop and helper binaries and add a release binary scanner.
- Repair service-test example paths and add targeted save, AI privacy, numeric and native filesystem regression tests.

The Windows installer remains unsigned pending a trusted code-signing certificate/service. Linux and macOS support are not validated by this Windows release; Linux credential-store configuration remains pending.
