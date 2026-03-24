---
name: app-usage-tracker-query
description: Query local App Usage Tracker history through the bundled CLI. Use when an AI agent needs to inspect available tracking dates, fetch top apps or sites for a day or the recent week, search historical items by name/host/URL, or retrieve detailed usage history for a specific tracked item from this repository's usage data file.
---

# App Usage Tracker Query

Use the repository CLI to read local usage history without opening the Electron UI. Prefer JSON output so the result can be parsed directly by the agent.

## Command Choice

Use `app-usage-tracker-cli` when it is on `PATH`.

Otherwise, from this repository root use:

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
node src/cli/query.js days --format json
```

Get the top items for the latest tracked day:

```powershell
node src/cli/query.js top --range day --day latest --limit 10 --format json
```

Get the recent 7-day ranking:

```powershell
node src/cli/query.js top --range week --limit 10 --format json
```

Search items by label, host, page title, URL, or key:

```powershell
node src/cli/query.js search --query "ChatGPT" --limit 10 --format json
```

Fetch detailed history for one item:

```powershell
node src/cli/query.js detail --key "service:chatgpt" --format json
```

Read the full serialized snapshot:

```powershell
node src/cli/query.js snapshot --format json
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
- Use `--format json` for agent workflows.
- If `detail --query` is ambiguous, run `search` first and then call `detail --key`.
