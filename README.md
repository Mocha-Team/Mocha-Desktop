# Mocha Desktop

Desktop client for Mocha file hosting. Browse files, upload and download, make share links, and keep local folders in sync.

Go + Wails v2 on the backend, React + Vite + Tailwind on the frontend. Windows is the main target, macOS and Linux also build.

## Requirements

- Go 1.25
- Node 20+
- Wails CLI:

```
go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0
```

Linux also needs GTK3 and WebKitGTK 4.1, plus a Secret Service provider (such as gnome-keyring) for key storage:

```
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev pkg-config gcc
```

## Build and run

From the repo root:

```
wails build
wails dev
```

Output goes to `build/bin/`. Wails cannot cross-compile GUI apps, so build on each OS you need.

Frontend only, from `frontend/`:

```
npm install
npm run build
npm run dev
```

Backend only, from the repo root:

```
go vet ./...
go build ./...
```

Windows installer (needs NSIS):

```
wails build -nsis
```

## Connect

1. In the Mocha web dashboard, mint an API key under API Keys. It starts with `mocha_`.
2. Open the desktop app, enter your app URL and the key, click Connect Mocha.

The key is stored in the OS credential store: Credential Manager on Windows, Keychain on macOS, Secret Service on Linux. If the key store is missing, the app falls back to an `api-key` file in its config dir. Everything else lives in `config.json` in the `mocha-desktop` folder inside the OS config dir. Sign out clears the key.

The API base URL is fixed to `https://api.mocha.my`. Only the app URL is configurable.

## What it does

- File browser with list and grid views, search, rename, move, delete, new folder
- Multi-select and bulk download as zip
- Previews for images, audio, and supported video formats, plus browsing inside zips from the list view with per-file extract
- Trash with per-item delete and empty-all
- Share links with copy and revoke
- Folder sync that uploads new and changed files in the background, with optional two-way sync, per-folder pause, pause-all, rescan, and ignore patterns
- Uploads and downloads with progress and cancel. Uploads retry automatically. Downloads resume across restarts
- Tray icon with Show, Pause sync, Rescan, and Quit. Clicking the icon while the window is hidden opens a small flyout with sync status
- Explorer right-click Quick Share on Windows, toggled in Settings

## Platform notes

Closing the window hides it to the tray on Windows/Linux. Use Quit in the tray menu to exit fully (on macOS use the Dock menu or Cmd+Q, as there is no tray icon).

macOS: install from the `.dmg` (drag the app to `/Applications`). Ad-hoc signed builds are blocked by Gatekeeper on first open: right-click the app and pick Open, or run `xattr -cr "/Applications/Mocha.app"`. For public distribution, sign with a Developer ID and notarize. There is a base entitlements file at `build/darwin/entitlements.plist`, and `build/darwin/package-dmg.sh` rebuilds the `.dmg` from `build/bin/*.app`. The tray icon is disabled on macOS (it conflicts with the main UI thread and crashes); use the window and Cmd+Q to quit.

Linux: the tray icon needs StatusNotifier over DBus, so GNOME needs an AppIndicator extension and KDE works as is. A `mocha-desktop.desktop` file is in `build/linux/`. Watching large trees can hit the inotify limit, raise `fs.inotify.max_user_watches` if sync reports watcher errors. Video playback depends on OS codecs, so some HEVC/MKV files will not play in WebKitGTK.

## Layout

```
main.go            window setup
app.go             methods exposed to the frontend
tray.go            tray icon and flyout window
backend/api/       HTTP client for the Mocha API
backend/auth/      OS keychain access
backend/config/    config file load and save
backend/contextmenu/ Windows Explorer Quick Share
backend/transfers/ upload and download logic
backend/sync/      folder watcher and sync state
frontend/src/      React app
```
