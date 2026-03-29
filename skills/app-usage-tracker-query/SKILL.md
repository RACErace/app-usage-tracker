---
name: app-usage-tracker-query
description: Query local App Usage Tracker history through the bundled CLI. Use when an AI agent needs to inspect available tracking dates, fetch top apps or sites for a day or the recent week, replay a day's real session timeline, search historical items by name/host/URL, or retrieve detailed usage history for a specific tracked item from this repository's usage data file.
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
3. Run `timeline --day <day>` when you need real session chronology with start/end times for one tracked day.
4. Run `search --query "<name>"` before requesting item details if the item key is unknown.
5. Run `detail --key "<itemKey>"` once you have the exact key.

Do not guess hashed item keys. Use `search` to resolve them first.

## `detail` vs `timeline`

Use `timeline` for chronology. It answers questions like:

- "What apps or sites were used between 13:00 and 15:00?"
- "When did the user switch from one app to another?"
- "What was the order of sessions on a given day?"

Use `detail` for item history. It answers questions like:

- "What exact pages were visited inside this site?"
- "How much total time was spent on this app or site?"
- "What is the day-by-day history for this tracked item?"

Important distinction for agents:

- `timeline` is a day view of session segments and may merge nearby segments for the same app or site to make the chronology easier to read.
- `timeline` is no longer the authoritative source for per-page browsing detail when multiple pages from the same site are merged into one site-level session.
- `detail --key <siteKey> --format json` is the authoritative source for concrete page-level data. Read `item.pageBreakdown` in the JSON response.
- For website investigation, the usual flow is `search` -> resolve the site key -> `detail --key ... --format json` -> inspect `item.pageBreakdown`.
- For activity reconstruction, the usual flow is `days` -> `timeline --day ... --format json`.

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

Get a day's real session timeline:

```powershell
app-usage-tracker-cli timeline --day latest --limit 20 --format json
```

Search items by label, host, page title, URL, or key:

```powershell
app-usage-tracker-cli search --query "ChatGPT" --limit 10 --format json
```

Fetch detailed history for one item:

```powershell
app-usage-tracker-cli detail --key "service:chatgpt" --format json
```

Fetch page-level breakdown for a site item:

```powershell
app-usage-tracker-cli detail --key "site:openai" --format json
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
- The CLI respects `settings.json` visibility rules, so hidden items are excluded from totals, rankings, timelines, searches, and snapshots.
- `timeline` returns session chronology for a day. It may merge nearby segments for the same app or site, so use `detail` when you need exact page-level website detail.
- `detail` returns item history and includes `pageBreakdown` for website items.
- Older aggregated-only days may report totals but no session list.
- Use `--format json` for agent workflows.
- If `detail --query` is ambiguous, run `search` first and then call `detail --key`.
- The installer adds the app install directory to the current user's `PATH`, but a shell opened before installation may need to be restarted before the command is available.
