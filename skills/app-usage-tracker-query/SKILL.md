---
name: app-usage-tracker-query
description: Query local App Usage Tracker history through the bundled CLI. Use when an AI agent needs to inspect available tracking dates, fetch top apps or sites for a day or the recent week, search historical items by name/host/URL, or retrieve detailed usage history for a specific tracked item from this repository's usage data file.
---

# App Usage Tracker Query

Use the bundled CLI to read local usage history without opening the Electron UI. Prefer JSON output so the result can be parsed directly by the agent.

## Command Choice

Use `app-usage-tracker-cli` when it is on `PATH`. This is the preferred command for the Windows installer build.

If the app was installed but the current shell was opened before installation, reopen the shell first. If needed, you can also run the wrapper directly from the install directory:

```powershell
C:\Users\<username>\AppData\Local\Programs\app-usage-tracker\app-usage-tracker-cli.cmd <command> ...
```

If you are working from the repository instead of an installed app, use:

```powershell
node src/cli/query.js <command> ...
```

## Query Workflow

1. Run `days` first when you need to know which dates exist.
2. Run `top --range day` or `top --range week` for rankings and totals.
3. Run `search --query "<name>"` before requesting item details if the item key is unknown.
4. Run `detail --key "<itemKey>"` once you have the exact key.

Do not guess hashed item keys. Use `search` to resolve them first.

## Preferred Commands

List available days:

```powershell
app-usage-tracker-cli days --format json
```

Get the top items for the latest tracked day:

```powershell
app-usage-tracker-cli top --range day --day latest --limit 10 --format json
```

Get the recent 7-day ranking:

```powershell
app-usage-tracker-cli top --range week --limit 10 --format json
```

Search items by label, host, page title, URL, or key:

```powershell
app-usage-tracker-cli search --query "ChatGPT" --limit 10 --format json
```

Fetch detailed history for one item:

```powershell
app-usage-tracker-cli detail --key "service:chatgpt" --format json
```

Read the full serialized snapshot:

```powershell
app-usage-tracker-cli snapshot --format json
```

## Storage Overrides

If the data file is not in the default location, prefer explicit overrides in this order:

1. `--data-file <absolute-path-to-usage-data.json>`
2. `APP_USAGE_TRACKER_DATA_FILE`
3. `--user-data-dir <directory>`
4. `APP_USAGE_TRACKER_USER_DATA_DIR`

On Windows, the default data file is `%APPDATA%/app-usage-tracker/usage-data.json`.

## Notes

- The CLI reads the on-disk `usage-data.json`; the newest few seconds of live activity may not appear until the desktop app saves.
- The CLI respects `settings.json` visibility rules, so hidden items are excluded from totals, rankings, searches, and snapshots.
- Use `--format json` for agent workflows.
- If `detail --query` is ambiguous, run `search` first and then call `detail --key`.
- The installer adds the app install directory to the current user's `PATH`, but a shell opened before installation may need to be restarted before the command is available.
