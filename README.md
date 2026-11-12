 <p align="center">
  <img src="public/branding/cirro-transparent.png" width="140" alt="Cirro" />
</p>

<h1 align="center">Cirro</h1>

<p align="center">
  A customizable, multi-account Google Drive client for Windows and Android.
</p>

<p align="center">
  <a href="https://github.com/arunabhajana/Cirro">Repository</a> ·
  <a href="https://github.com/arunabhajana/Cirro/issues">Issues</a> ·
  <a href="https://github.com/arunabhajana/Cirro/releases">Releases</a>
</p>

---

## Overview

Cirro is a Google Drive client built for Windows and Android. It provides an alternative way to browse, organize and manage your Google Drive files, with an emphasis on customization and a consistent experience across devices.

Connect multiple Google accounts, personalize your home screen, configure your navigation bar and manage your files from one place.

Cirro uses the official Google Drive API and Google OAuth for account access.

## Features

### Accounts
- Connect multiple Google accounts.
- Switch between accounts.
- Browse files from individual accounts.
- Manage account-specific settings.

### Home
- Customizable home screen.
- Pin frequently accessed files and folders.
- Recent files and starred items.
- Configurable home widgets.

### Navigation
- Customizable navigation bar.
- Reorder navigation items.
- Pin frequently used locations.
- Adjust sidebar width and layout.

### File Management
- Browse files and folders.
- Upload and download files.
- Create and manage folders.
- Rename, copy, move and delete files.
- Star important files.
- Search across Drive.
- Grid and list views.
- Sorting and multi-selection.
- Manage shared files and Trash.

### File Preview
- Image previews.
- Video playback.
- PDF viewing.
- Text and code previews.
- ZIP archive inspection.
- Supported Office document previews.

### Appearance
- Light and dark themes.
- System theme support.
- Custom accent colours.
- Adjustable interface preferences.
- Reduced motion and transparency options.

### Android
- Native Google sign-in.
- Offline file access.
- Resumable uploads.
- Native Android integration.
- Platform-specific interface and settings.

## Platforms

| Platform | Framework |
|---|---|
| Windows | Tauri, React |
| Android | Capacitor, React |

## Technology

| Technology | Usage |
|---|---|
| React | Frontend |
| TypeScript | Application logic |
| Tailwind CSS | Styling |
| Vite | Build tooling |
| Tauri | Windows application |
| Rust | Desktop native functionality |
| SQLite | Local data storage |
| Capacitor | Android integration |
| Kotlin | Native Android functionality |
| Google Drive API | File operations |
| Google OAuth 2.0 | Authentication |

---

# Development

## Requirements

### Windows
- Node.js (LTS)
- npm
- Rust and Cargo
- Microsoft C++ Build Tools
- WebView2 Runtime

### Android
- Node.js (LTS)
- npm
- Android Studio
- Android SDK
- Java development environment

## Getting Started

Clone the repository:

```bash
git clone https://github.com/arunabhajana/Cirro.git
cd Cirro
```

Install dependencies:

```bash
npm install
```

## Google Cloud Setup

Cirro uses Google OAuth 2.0 for authentication and the Google Drive API for accessing user files.

To configure Google services:

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the Google Drive API.
3. Configure Google Auth Platform and the OAuth consent screen.
4. Create the required OAuth client credentials.
5. Configure the credentials for your development environment.

### Required API

Google Drive API:

```text
https://www.googleapis.com/auth/drive
```

### OAuth Credentials

Create the appropriate OAuth clients for each platform.

**Windows**

Create a Desktop application OAuth client.

**Android**

Create an Android OAuth client with your application's package name and signing certificate SHA-1.

Also configure a Web application OAuth client if required by the Android Google sign-in implementation.

All OAuth clients should belong to the same Google Cloud project.

## Environment Configuration

Create local environment files from the provided templates, if available.

Example:

```bash
cp .env.example .env
```

For Android-specific configuration:

```bash
cp android.env.example .env.local
```

Configure the required OAuth client IDs according to the authentication implementation.

Example of a public client ID variable:

```env
VITE_ANDROID_GOOGLE_WEB_CLIENT_ID=your_client_id.apps.googleusercontent.com
```

The exact variable names should match the environment templates in the repository.

Do not commit environment files, OAuth client secrets, signing keys or other private credentials.

Never expose OAuth client secrets through frontend environment variables such as `VITE_*`.

## Windows Development

Start the frontend development server:

```bash
npm run dev
```

Run the desktop application:

```bash
npm run tauri dev
```

Build the application:

```bash
npm run build
```

## Android Development

Start the Android development server:

```bash
npm run dev:android
```

Sync the Android project:

```bash
npm run android:sync
```

Open the project in Android Studio:

```bash
npm run android:open
```

Build a debug APK:

```bash
npm run android:apk
```

Run on a connected device:

```bash
npm run android:run
```

## Testing

Run the test suite:

```bash
npm run test
```

Run linting:

```bash
npm run lint
```

Run release checks:

```bash
npm run test:release
```

Run Rust tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Versioning

Update the application version:

```bash
npm run version:bump -- 1.0.0
```

Other supported version increments:

```bash
npm run version:bump -- patch
npm run version:bump -- minor
npm run version:bump -- major
```

Check version consistency:

```bash
npm run version:check
```

---

# Contributing

Contributions and suggestions are welcome.

1. Fork the repository.
2. Create a branch for your changes.
3. Make your changes.
4. Run the relevant tests.
5. Submit a pull request describing your changes.

For larger changes, open an issue first to discuss the proposed implementation.

## Bug Reports

If you encounter a problem, open an issue with:

- A description of the problem.
- Steps to reproduce it.
- Expected and actual behaviour.
- Application version and platform.
- Screenshots or logs, if relevant.

[Report an issue](https://github.com/arunabhajana/Cirro/issues)

## Security

Do not include access tokens, OAuth secrets, signing credentials or personal account information in bug reports or pull requests.

For security concerns, contact the repository maintainer privately rather than opening a public issue.

## License

The project license will be specified here once a LICENSE file has been added.

---

<p align="center">
  <strong>Cirro</strong>
  <br />
  Built by <a href="https://github.com/arunabhajana">Arun</a>
</p>
