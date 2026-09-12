# Editor display and detached structure windows

Help shows the running application version below Updates. Updating an app replaces the application contents, not a user-created parent directory. On macOS, place Argent Studio.app in /Applications rather than a version-numbered folder. Do not move the application while it is running.

## Code font size

Use the font percentage slider at the bottom right of either code editor or Settings > Appearance > Code font size. The shared preference applies to text editors and editable source sections in the structure view, including detached windows. The range is 50% to 250%; 100% corresponds to 14 px. This changes text display, not the graph zoom or source contents.

## Detach and dock

Open an Argent source and use the four-way move handle in the view toolbar. Clicking opens the structure in a separate window; dragging the handle also begins detaching. Move the window to another display using its title bar or move handle.

Use Dock in either window to restore the original embedded structure. Closing the detached window also docks it. Dragging the detached move handle back over the main editor area docks the structure after the movement stops. The button is an alternative when dragging is inconvenient.

The detached structure stays attached to its source document while other files can be opened in the main window. Graph selection, expanded/collapsed blocks, connection filters, zoom, pan and inner pane sizes are retained when docking. Project changes and closing the source document dock the view first.

The main window owns the open document buffers and disk saves. Communication between the local windows uses Tauri events in the desktop app (a same-origin BroadcastChannel in browser tests) and does not require Internet access. Save operations wait for pending detached edits. Concurrent edits are not silently overwritten: the detached window retains the draft and offers explicit review and resolution before docking. Atomic multi-file edits share the main editor's undo history.

Native Windows checks cover creating the real Tauri window, displayed version/font size, document synchronization and docking. Browser tests cover editing, save coordination, conflicts, repeated docking and view-state restoration. A native macOS check and manual drag between physical displays remain part of platform release validation.
