# App Usage Tracker

[中文说明](./README.zh-CN.md)

App Usage Tracker is a Windows-focused desktop usage tracker built with Electron. It records foreground app time, can attribute browser usage to websites with a companion extension, and provides a local CLI plus AI-ready skill files for automation.

## Highlights

- Track foreground app usage time on Windows
- Track actual music playback time with a hybrid SMTC + WASAPI detector, including background playback
- Attribute browser time to websites when the browser extension is enabled
- Aggregate web usage by root domain instead of individual URLs
- Create custom service merge rules for desktop apps plus website domains
- Apply category rules such as Work, Entertainment, Study, or Communication
- View daily rankings, 7-day trends, and per-item detail pages
- Run from the system tray and support launch at login
- Query local usage data from the CLI
- Ship AI skill files for tools such as OpenClaw, Codex, or similar assistants

Built-in service merge rules currently include:

- ChatGPT desktop app + `chatgpt.com`
- bilibili desktop app + `bilibili.com`

## How It Works

Windows can reliably identify the active application window, but not the full browser URL. To get website-level tracking, the project uses a desktop app plus browser extension workflow:

1. The desktop app detects the current foreground window.
2. The browser extension sends the active tab title and URL to a local bridge.
3. For music apps, the desktop app reads both Windows SMTC media sessions and WASAPI audio sessions.
4. It fuses those signals to record actual playback time for the music app.
5. The desktop app then combines all signals and records usage by app, site, or merged service.

Without the extension, browser usage is still tracked, but only at the browser app level.

Notes:

- Music playback time primarily comes from Windows SMTC (System Media Transport Controls) and uses WASAPI audio sessions as a fallback for players that do not expose usable SMTC metadata.
- Playback time can overlap with another foreground app, so per-item totals can differ from pure foreground-window time.
- Apps that expose neither usable SMTC nor an active WASAPI session fall back to regular foreground-window tracking.

## Requirements

- Windows
- Node.js 20+
- npm
- Visual Studio 2022 Build Tools with `Desktop development with C++` if you want to build Windows packages locally

## Quick Start

Install dependencies:

```powershell
npm install
```

Start the packaged-style detached app:

```powershell
npm start
```

Start with foreground logs for development:

```powershell
npm run start:dev
```

## CLI

The repository includes a local CLI at `src/cli/query.js`.

From the repository:

```powershell
npm run query -- days --format json
npm run query -- top --range day --day latest --limit 10 --format json
npm run query -- search --query "ChatGPT" --format json
npm run query -- detail --key service:chatgpt --format json
```

From an installed Windows build:

```powershell
app-usage-tracker-cli days --format json
```

Notes:

- The installer adds the app install directory to the current user's `PATH`
- Reopen PowerShell, Command Prompt, or Windows Terminal if the shell was already open before installation
- The installed wrapper is available at `%LOCALAPPDATA%\Programs\app-usage-tracker\app-usage-tracker-cli.cmd`
- The CLI respects visibility settings from `settings.json`, so hidden items are excluded from totals, rankings, searches, and snapshots
- Prefer `--format json` for scripts, agents, and automation

Supported data-location overrides:

- `--data-file <path>`
- `APP_USAGE_TRACKER_DATA_FILE`
- `--user-data-dir <dir>`
- `APP_USAGE_TRACKER_USER_DATA_DIR`

## Browser Extension

The repository contains a Chromium-compatible extension in [`browser-extension`](./browser-extension).

To load it in Chrome, Edge, Brave, or Opera:

1. Open the browser extensions page
2. Enable developer mode
3. Choose `Load unpacked`
4. Select the `browser-extension` directory from this repository

The extension reports active tab metadata to:

```text
http://127.0.0.1:32123/v1/browser-event
```

If the desktop app stops receiving extension heartbeats for a while, the UI shows a warning that the browser extension is not currently connected.

## AI Skill Files

The project includes AI skill files in [`skills/app-usage-tracker-query`](./skills/app-usage-tracker-query) so assistants can query local usage data through the CLI.

The GitHub Release workflow also publishes a `skills.zip` asset alongside the app packages.

## Data Locations

By default the app stores data under `%APPDATA%\app-usage-tracker\`:

- Usage data: `usage-data.json`
- App settings: `settings.json`
- Icon cache: `icon-cache\`

## Packaging

Build an unpacked app:

```powershell
npm run pack
```

Build Windows release packages:

```powershell
npm run dist
```

Additional package commands:

```powershell
npm run dist:portable
npm run dist:installer
```

Typical outputs:

- NSIS installer
- Portable Windows executable
- Browser extension zip
- Skills zip

## GitHub Actions and Releases

The repository includes a Windows build workflow at `.github/workflows/build-windows.yml`.

On pushes to `main`, it builds Windows artifacts.
On tags matching `v*`, it also creates a GitHub Release and uploads:

- `App-Usage-Tracker-<version>-installer.exe`
- `App-Usage-Tracker-<version>-portable.exe`
- `App-Usage-Tracker-<version>-browser-extension.zip`
- `App-Usage-Tracker-<version>-skills.zip`

## Project Structure

- `src/main`: Electron main-process code
- `src/renderer`: renderer UI
- `src/cli`: local query CLI
- `browser-extension`: browser bridge extension
- `skills`: AI skill files
- `scripts`: helper scripts
- `test`: automated tests

## Limitations

- The project currently focuses on Windows
- Firefox support is limited; the bundled extension is implemented for Chromium-style extension APIs
- Service merging and categorization depend on the rules you configure; unmatched items stay as regular apps or sites
- Direct favicon or raw asset URLs may occasionally appear as recent web entries
- Music playback tracking still depends on the player exposing a recognizable SMTC or WASAPI session; browser-based web players are not tracked as separate music apps

## License

This repository is licensed under the [MIT License](./LICENSE).
