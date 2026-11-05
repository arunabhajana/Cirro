# Cirro

A React, Tailwind CSS, and Tauri desktop app for a calmer Google Drive experience. Single-account Google Drive integration with a local SQLite metadata cache.

## Run

```sh
npm install
npm run dev
```

Open http://127.0.0.1:1420 for the browser welcome-screen preview. Google sign-in requires the Tauri desktop app. Copy `.env.example` to `.env` and add a Google **Desktop app** OAuth client, following [the setup guide](docs/google-sign-in.md).

```sh
npm run build
npm run tauri dev
```

The desktop development command requires Rust and the Windows Tauri prerequisites (Microsoft C++ Build Tools and WebView2).

Google sign-in opens the system browser and returns to Home after verification. The sidebar and Settings → Accounts show your real name, email, and profile photo, with sign-out controls. A session is saved in the OS credential store and verified with Google when the app restarts. Only one Google account is supported in this phase. Enable Google Drive API, add the full Drive scope, and sign in again as described in [Drive setup](docs/drive-integration.md).

Run `npm test` for authentication UI checks and `cargo test --manifest-path src-tauri/Cargo.toml` for native OAuth callback checks. The callback integration test needs local loopback networking. Live Google consent and token exchange require your own configured credentials.

## Design interactions

- Pin files and folders to Home or the sidebar using their context menus. Customize Home manages existing pins and widgets; sidebar customization lists only current pins with sorting, ordering and unpinning.
- Browse folders, search all accounts or a single drive, switch list/grid views, and sort files.
- Inspect file details, star files, move them to Trash, and restore them.
- Create folders and choose a connected drive before adding local files. The upload dialog shows account storage and offers destination folders.
- Explore account settings, storage breakdowns, and the Google-only welcome screen.
- Use the account menu at the sidebar bottom to view your connected Google profile or sign out; settings is beside the menu. The file views use the connected Drive.
- Use the New menu in the page toolbar to add local files, add a folder with its hierarchy, or create a folder. Home keeps pinned folders in the main area and shows up to four recent files below composition in the right pane (three in shorter desktop windows). Quick actions support arrow keys; dialogs keep keyboard focus inside and restore it on close.
- Settings → Appearance offers Light, Dark, and System themes. The choice persists on this device; System follows operating-system appearance changes. Theme initialization runs before the app renders. Both themes cover the welcome screen, titlebar, browsing, accounts, widgets, settings, menus, and dialogs.
- Inter is bundled locally for offline typography. The custom titlebar has centered search and native minimize, maximize/restore, and close controls. Window controls are disabled in browser previews and enabled in Tauri.
- Customize Home includes optional Sync status, Starred files, Drive storage, and Trash overview widgets. Sync status distinguishes Google sign-in from future Drive sync and separately reports the device's online state.
- Right-click files, folders, sidebar shortcuts, or empty workspace areas for context-specific actions. Rename, star, pin, copy, cut, paste, move to Trash, and restore operate on Google Drive. Folder copies preserve hierarchy and prevent cycles and conflicting moves.
- All files has back/forward/up navigation, folder breadcrumbs, sortable columns, list/grid views, multi-selection, pagination, and keyboard shortcuts (Ctrl+A/C/X/V, F2, Delete, Alt+arrows). The file list scrolls independently while pagination stays visible; view and page-size choices persist.
- Customize sidebar can hide and reorder navigation, sort or reorder current shortcuts, unpin items, adjust density, and widen the sidebar. These choices persist on this device.
- The icon beside Library opens sidebar customization; the matching icon beside Pinned opens pinned-item customization directly.
- Settings has category navigation and full-text keyword search. Notifications, startup behavior, storage/sync, and privacy controls are listed as planned and disabled; they do not change operating-system settings.
- File search matches names, accounts, and ancestor folder names. Combine terms, use quoted phrases, or filter with `type:pdf`, `account:work`, and `in:Projects`.

Single-click a file or folder for details in the right-hand inspector. Space opens Quick Look in a separate modal with preview content only; unavailable previews show file information instead. Double-click or Enter opens a folder or the full viewer. New folder supports six colors and eight icon styles with a live preview. File selection uses custom checkboxes with an indeterminate page state. [Preview formats and limits](docs/file-previews.md) cover local images, media, PDFs, text/code, ZIP listings, and Office/OpenDocument content.

Settings → Appearance → App icon switches between transparent, blue-tile and frosted-glass cloud logos. Native window icons update with the choice, and tray-sized exports are ready for future tray support. [Branding assets and imagegen prompts](docs/branding.md) document the generated originals.

The desktop window is fitted to the monitor work area before it appears. On Windows, maximization respects top/side/bottom taskbars, monitor offsets and display scaling. Vite ignores Rust build output to avoid Windows DLL watcher locks during native builds.

Drive metadata, folder structure, incoming shares, Trash, starred items, quotas, file actions, resumable uploads and on-demand previews use Google Drive. SQLite stores account-scoped metadata, thumbnails, cursors and workspace preferences; file contents are not persisted. See [integration details and limits](docs/drive-integration.md).
