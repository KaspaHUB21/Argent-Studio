# Argent Studio identity

The Kaspa Argent logo uses a turquoise and silver KA monogram. The supplied full logo is `kaspa-argent-logo.png`. The scalable monogram is `argent-studio.svg`; PNG and ICO copies support native consumers.

The toolbar and browser favicon use the SVG. Tauri application, taskbar, shortcut and installer icons are generated from it in `src-tauri/icons`, including ICO for Windows and ICNS for macOS.

Regenerate the desktop icon set with `pnpm tauri icon resources/assets/argent-studio.svg --output test-output/brand-icons`, then copy the desktop icons into `src-tauri/icons` and the PNG/ICO copies into this directory.
