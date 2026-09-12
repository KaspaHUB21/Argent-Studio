# Changelog

## 0.45.11

- Float the code font slider inside the editor at the bottom right without a separate toolbar row.
- Remove the idle connection hint and shared-definition notice above the structure code editor.

- Replace the structure overview with a source-derived rule network: inputs on the left, rules in the middle, outputs on the right.
- Expand and collapse App, Actor, action and rule groups with a double-click while preserving source order and nested expansion state.
- Route colored value connections around blocks; highlight related connections on block hover and show line details on hover.
- Show source conditions instead of numbered check labels, omit file paths from block tooltips and strengthen expanded group outlines.
- Keep code editing, shared font zoom and detached structure windows integrated with the new graph in German and English.
## 0.45.10

- Add a code font size slider to text and structure editors, with a shared saved zoom level and one-click reset.
- Show the installed application version in Help below Updates.
- Open the structure view in a separate window and dock it back into the workspace.
- Synchronize source edits between windows and preserve drafts when concurrent edits conflict.
- Preserve structure selection, expanded blocks and diagram position when docking.
- Keep workspace resize handles accessible beside editor controls.
- Slightly round the corners of structure blocks.

## 0.45.9

- Indent new lines inside blocks, calls and arrays automatically.
- Align closing brackets with their opening level.
- Preserve correct indentation around comments, strings and nested state initializers.

## 0.45.8

- Add local inline completion, parameter hints, matching-name highlights and sticky block context.
- Add quiet syntax and semantic checks with explicit corrections and related-definition navigation.
- Refresh import checks from unsaved changes in other open files.
- Complete state initializer keys using their declared fields, including redeemed in the ticket example.
- Preserve indentation when accepting completion suggestions quickly.

## 0.45.7

- Automatically select the first Argent source in a new project for compilation.
- Ask for a build entry when opening a project with multiple sources and no saved selection.
- Remember the build entry and application name per project, including moved and duplicated projects.
- Keep the project build entry when switching editor tabs.

## 0.45.6

- Add macOS preview downloads for Apple Silicon and Intel.
- Enable in-app updates on macOS.
- Preserve unsaved changes when quitting from the macOS application menu.
- Support macOS system path aliases while keeping project file access scoped.
- Preserve files and concurrent edits when moving removed files across Mac volumes.

## 0.45.5

- Preserve structure block proportions and zoom while resizing the build output and diagram panes.

- Update the bundled compiler and transaction runtime to SilverScript 1.0.0.
- Restore saved build files for the selected project and clear output and errors when switching projects.

## 0.45.4

- Move Project, Build / results and AI assistant controls into the second toolbar for direct access.
- Remove the View dropdown menu.

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
