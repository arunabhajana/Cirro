# Cirro Android

Package: **com.cirro.android**. Minimum Android: **7 / API 24**; target/compile SDK **36**.
The mobile React UI uses Capacitor; Windows continues using Tauri.

## Build tools and Google configuration

- Install Android Studio, Android SDK Platform 36, Build-Tools 36.0.0 and Platform-Tools.
- Use JDK 21. Rabbit2's bundled Java 25 cannot run this Gradle 8 build. This PC has a checksum-verified Microsoft JDK 21 under `.qa/android-tools/jdk21`; the helper uses it automatically. For another PC set JAVA_HOME to JDK 21 and ANDROID_HOME to the SDK. In Android Studio choose JDK 21 under Build Tools → Gradle → Gradle JDK.
- Put the public Web OAuth client ID in VITE_ANDROID_GOOGLE_WEB_CLIENT_ID in .env.local; see android.env.example. Do not include a client secret.
- Run `npm run android:signing-report` and register the debug SHA1 in an Android OAuth client for com.cirro.android, in the same Google Cloud project as the Web client. Include test users when the consent screen is in Testing.
- Enable Google Drive API and configure the full Drive scope in the project's consent screen, as for desktop. Login uses only openid/email/profile. **Connect Drive** asks for Drive permission separately, tied to the selected identity.

## Everyday testing: USB live reload

1. Build once: `npm run android:live:apk`.
2. Connect the phone with USB debugging enabled and approve the debugging prompt.
3. Install once: `npm run android:live:install`. This replaces the normal Cirro debug app; both use the same package/signing certificate.
4. Run `npm run android:live` and leave the terminal open. It configures adb reverse, starts Vite on the PC's loopback port 1423, and opens Cirro. Stop any other Vite server on port 1423 first.
5. React and CSS edits now update directly in the phone's native shell. Adding/changing native plugins, permissions or Java requires rebuilding/reinstalling the live APK; frontend edits do not.

The development URL is **http://localhost:1423/android**, carried over ADB (USB or already paired wireless debugging). The helper reconnects a single advertised paired wireless endpoint automatically. This is deliberately not a LAN HTTP server for native login. Only debug builds permit localhost cleartext; other hosts remain HTTPS-only. The build helper resets the normal Capacitor configuration after producing the live APK. If several devices are attached, set ANDROID_SERIAL.

Without USB, use `npm run dev:android` for browser-only mock UI testing on the same Wi-Fi. Native login and real Drive authorization require the native shell. A disconnected live APK cannot load its frontend; reconnect and run the live command, or install a normal APK.

## Normal standalone APK

Run `npm run android:apk`. Output is copied to **.qa/android-apks/Cirro-debug.apk**.
The live build is **.qa/android-apks/Cirro-live-debug.apk**. Both also build through native/android/app/build/outputs/apk/debug/app-debug.apk; use the named copies to distinguish them.

Run `npm run android:share` to serve just those APKs on port 1430. Open /cirro.apk for normal, or /cirro-live.apk for live, using the PC's printed Wi-Fi address. Normal APKs include their frontend and do not need a server. Installing either retains app data. Release distribution requires a release signing key and its separate Google OAuth SHA1 registration.

## Drive behavior

- Login verifies Google's ID-token signature, issuer, audience, expiry and login nonce before showing the profile. Settings and the switcher share that identity; photos fall back to initials.
- Connect Drive requests full Drive consent, as used on desktop. Picking a different identity is rejected rather than routing its token to the selected account. Native SDK operations are serialized. Access tokens are kept in memory per verified subject; background sync never opens consent prompts.
- Initial sync enumerates every file page in the user corpus, Trash included, all shared drives and their contents, and incoming shared-folder descendants. Each account has its own root, metadata, quota and change cursors. IDs are account-prefixed to prevent collisions.
- Change cursors are captured before enumeration and replayed afterwards. Subsequent syncs use all change pages and remove deleted/revoked inherited descendants. Expired cursors trigger a complete rescan; full reconciliation also runs every 15 minutes. Foreground refresh runs every minute, when returning to the app, and after connectivity returns.
- Partial/incomplete listings fail rather than replacing a complete cache. Interrupted and failed syncs keep the prior metadata visible with an error and retry control. IndexedDB caches metadata only, with no access tokens or file contents. Sign-out cancels work and clears cached account data.
- All files, Shared with me, Starred, Recent, Trash, folder navigation, pinned folders, search, file composition and storage use that metadata. Shared drives appear as root folders. Star/unstar, Trash/restore and folder creation write to Drive with permission checks. Google Drive links open using each file's own link.
- Offline files stream to app storage or a user-selected Android document-tree folder. Settings changes the destination for new downloads; existing files remain where saved. Each saved copy belongs to its Google account. Folder selections enumerate their current Drive descendants and save the files individually. Offline download cancellation cleans partial copies. Filesystem mirroring remains desktop-only.
- Up to three identities persist in an Android Keystore encrypted profile vault. Unified mode combines their files and widgets; individual mode filters by account. Native Google authorization renews access for the specific saved account and checks its subject against Google userinfo. Consent resolutions require an explicit Connect Drive action; refresh/access tokens are not stored in the web cache. Disconnect removes the profile from Cirro, while offline copies remain in their chosen folders.
- Tap a file to preview images, audio/video, PDFs, text/code, ZIP listings and Office/OpenDocument text/tables. Google Workspace documents export to PDF. All preview downloads and offline preview copies have a hard 32 MiB cap, enforced against metadata and actual streamed bytes. The shared desktop parsers retain their extraction/entry limits. Google also enforces its own Workspace export size limits. Unsupported files and permission errors show dialogs, with Open in Google Drive available.
- Home has Widgets, Quick actions and Pinned sections: hide/show and reorder them in Customize Home. Storage, File composition and Recent files are the three defaults; Starred, Shared files, Offline files, Trash and Sync status are optional. Each widget can be toggled and reordered. Pin folders yourself and reorder them in Manage pinned folders.

## Theme and system UI

Settings → Appearance contains five accent colours and Dark mode; both persist on this device. Both login and workspace follow it. The native AppAppearance bridge keeps the activity window, WebView and system-bar surfaces aligned with that choice before Capacitor SystemBars applies contrasting icons. This also prevents the operating-system dark theme from leaving gray inset bands around a light Cirro screen. Android applies system-bar and cutout insets to its native content frame. The WebView scrolls inside that clipped frame, so Home, Settings and preview dialogs cannot scroll behind the status bar. Capacitor CSS inset handling is disabled to avoid double spacing. The Home avatar uses a single clipped image container.

## Verification

`npm run lint`, `npm run build`, and the mobile test suite cover identity verification, cross-account token binding, pagination, shared-drive membership, incoming share recursion, incremental updates/deletions, expired cursors, failed-sync cache retention, sign-out races, login/profile controls, avatar structure and theme persistence. Native builds must also pass Gradle. Real Google consent and live reload must be checked on a connected phone.

References: [Capacitor SystemBars](https://capacitorjs.com/docs/apis/system-bars), [live reload](https://capacitorjs.com/docs/guides/live-reload), [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes).

## Mobile personalization and previews

Each account and Unified keep their own Home layout, widget choices, pins and pin-sort direction on this device. Existing shared Home preferences migrate to Unified only. Widgets stay 216 CSS pixels high; Recent shows two files, and cards show a compact account summary with the full breakdown available by opening the widget. Name sorting toggles A–Z/Z–A. Account labels and colours are device preferences under Settings → Account settings.

Storage values use decimal B–EB units with at most one fractional digit. Settings groups accounts, personalization, file storage and About; About contains Android-specific release notes and Software update.

In-app activity/error banners last two seconds and remain in the notification centre. Settings controls banners, quiet mode and alert categories. Only explicit permission/confirmation dialogs remain open for action. Android notification permission and channel settings are available under Settings → Notifications. Shared-file alerts are detected on Drive sync; no closed-app webhook/push service is configured.

Opened previews use a 48 MiB / three-item in-memory LRU cache with a five-minute lifetime; changes to file identity, account, modification, size or online/offline source select a new entry. Sign-out clears it. Preview reads still enforce the 32 MiB limit, with throttled download progress and a branded loader. Document parsing reuses downloaded bytes; mobile PDF pages initially fit their viewport width. Cold downloads still depend on Drive and network speed.

## Touch scrolling and initial Drive approval

The Home rail is the only horizontal scrolling container in the widget panel. Cards and their summaries do not create nested scroll areas. Native touch panning decides the gesture axis; proximity snapping preserves momentum. Page/panel scrollbar indicators have been removed at the user’s request. Native WebView scrollbar overlays are disabled, file rows use off-screen rendering containment, and opaque navigation surfaces avoid scroll-time backdrop blur.

After native sign-in or restore, a missing Drive grant opens the same explicit approval sheet used by Sync. Google consent starts only when Continue with Google is tapped. Accounts are prompted once per session, so Not now does not repeatedly interrupt browsing; Sync and notification actions can reopen approval later.

## Android core file operations

Long-press a file (or use Select files) to enter custom-checkbox selection. Bulk actions support copy, move, Trash, permanent deletion from Trash, restore, star/unstar and offline downloads. Single-item actions also include rename and desktop-style sharing. Owners and inherited sharing rules are protected; public viewer links require confirmation.

Folder creation and uploads require choosing an account, drive and folder. Unified never silently chooses the currently signed-in account. Uploads use Android’s document picker with persisted URI grants, staging to private cache and bounded-memory resumable 1 MiB chunks. Bytes stay out of the JavaScript bridge; uploaded size/MD5 are verified and partial staging files cleaned. Interrupted UI jobs remain in Transfers for review/retry.

Same-account moves change parents and preserve IDs. Folder copies enumerate live children. Cross-account binary copies stream through native private-cache staging; Google Workspace files use server copy and require existing access for the destination account. Cross-account moves verify source versions and destination content before trashing source roots. Transfer markers avoid re-copying completed destinations on retry. Partial copies remain visible when a transfer fails; originals are retained unless an earlier operation already completed.

Starting a transfer keeps the current page and folder open. Transfers remains available from More for item/byte progress, cancel and retry. The first transfer requests Android notification permission once; explicit notification choices in Settings are respected. Native foreground notifications show uploads, offline downloads, copy, move, Trash, restore and deletion progress, then replace the progress bar with a clear completion or error message. Offline downloads stream byte progress through the native bridge. Foreground data-sync notifications are stopped when work finishes or the app is removed from recents. Work is coordinated by the open app; process death requires reviewing/retrying interrupted jobs. Shared-file notifications are sync-based, not real-time push while the app is closed.

## Search, Home ordering and Android updates

Search opens a dedicated mobile screen with a focused search field, file-type chips, account filters, Starred filtering and six recent searches per Home. It searches synced file names locally and excludes Trash. Results render in batches of 60; typing uses deferred filtering. Customize Home supports drag handles and accessible up/down buttons for section and widget order. These preferences remain separate for every account and Unified.

Notifications use Cirro branding, readable file/action summaries and transfer destinations. Sharing confirmations identify the file, recipient and access level; transfer completion alerts link to Transfers in the in-app inbox. Android foreground transfer notifications carry the same completion wording without posting a second success notification.

Software update checks public, stable releases in `arunabhajana/Cirro` for an asset named exactly `Cirro-android.apk` on startup, on return to the app, and every 15 minutes while visible. No Android APK is published by making these source changes. Until a signed asset is released, Settings explains that no Android release is available. Automatic downloading is enabled by default, with a switch under Software update; downloads may use mobile data. Downloads show real byte progress in-app and an Android foreground notification, and support cancellation. Later dismisses that version's automatic prompt while retaining the update indicator in Settings; cancellation pauses automatic retries for that version. Android confirms installation; permission to install from Cirro may be required. After an updated native build opens, What's new appears once for that build, using the packaged Android notes in `src/platforms/android/updates/release.json`.

The native updater enforces a 512 MiB cap, HTTPS official-repository URLs, GitHub's SHA-256 asset digest, the Cirro package ID, a strictly newer version code and the exact signing certificate of the installed app. APK bytes stay in private app storage and are verified again before installation. A release signed with a new production key cannot update an existing debug installation; register the production signing SHA-1 for Google OAuth and plan that initial migration separately. Never publish a debug signing key.

For a signed release, set `CIRRO_ANDROID_KEYSTORE_PATH` (absolute path), `CIRRO_ANDROID_KEYSTORE_PASSWORD`, `CIRRO_ANDROID_KEY_ALIAS` and `CIRRO_ANDROID_KEY_PASSWORD`, then run `npm run android:release:apk`. The output is `.qa/android-apks/Cirro-android.apk`. Version name comes from `package.json`; code is major × 1,000,000 + minor × 1,000 + patch (minor/patch ≤ 999). Increment the version for every distributed update and edit the packaged Android notes before building.

## CI/CD and launcher assets

**Android build** validates pull requests and Android-related main changes with lint, TypeScript and a debug APK build. Its workflow artifact is a build-check artifact; its temporary CI signing identity is not registered for Google sign-in. The optional repository variable `ANDROID_GOOGLE_WEB_CLIENT_ID` provides the public Web OAuth ID to these builds. No production signing secrets are exposed to pull requests.

Pushing a stable `vX.Y.Z` tag on main now runs the reusable **Package Cirro Android** workflow, then the Windows release build. Both use the existing version helper and require matching `src/releases/X.Y.Z.json` notes. The signed APK is passed as a workflow artifact, attached to the same draft GitHub release as Windows, and checked against GitHub's asset SHA-256 digest before publication. A failed Android build, missing APK or mismatched digest prevents publication. The updater ignores drafts/prereleases. Nothing is published by a local build.

Configure repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` and `ANDROID_GOOGLE_WEB_CLIENT_ID`. The Android workflow also supports manual builds; its optional **Attach to release** action attaches to an existing draft only. Keep the signing key backed up securely: subsequent Android updates must use the same key, and the production certificate's SHA-1 must be registered as an Android OAuth client for `com.cirro.android` in the same Google Cloud project.

On this Windows workspace the production key has been generated and those GitHub secrets configured. The ignored `.qa/android-signing/` folder contains the keystore, public certificate, Windows DPAPI password backup and recovery instructions. The DPAPI password backup requires this Windows user profile; export the password privately to a password manager for a portable backup. `pwsh -File scripts/android-release-local.ps1` builds with the saved key without putting passwords on the command line. The idempotent `scripts/setup-android-signing.ps1` can reconfigure GitHub secrets from the saved key and will not overwrite it. Production SHA-1: `1D:07:6C:F9:83:49:FB:9C:A3:8B:16:FC:2D:F7:C6:56:58:D1:2E:AB`.

Android uses the existing Cirro cloud branding with a white adaptive-icon background, foreground safe-zone padding, round and legacy launcher variants, the Cirro splash icon, a cloud notification glyph, and Android 13+ monochrome themed icons. These are native resources shared by local and CI builds.
