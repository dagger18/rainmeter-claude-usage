# Claude Usage Monitor — Chrome Extension + Native Host Design

**Date:** 2026-06-23  
**Status:** Approved  
**Scope:** Replace JSONL-based data fetching with a Chrome extension that scrapes claude.ai/settings/usage and feeds data to the existing Rainmeter skin via Chrome Native Messaging.

---

## Problem

The existing `FetchUsage.ps1` scans local JSONL files from `~/.claude/projects` to compute token usage. These files are unreliable — counts are inaccurate and limits are hardcoded. The claude.ai web interface shows authoritative usage data (actual used tokens, actual limits, accurate reset times) that is not available locally.

---

## Solution Overview

A Chrome extension scrapes the DOM of an open `claude.ai/settings/usage` tab and sends the data to a Python native host via Chrome Native Messaging. The native host writes `%APPDATA%\Claude\usage_data.json` — the same file the existing `reader.lua` and Rainmeter skin already read. The display layer (`ClaudeUsage.ini`, `reader.lua`) is unchanged.

---

## Data Flow

```
claude.ai/settings/usage tab (Chrome)
        ↓  content.js reads DOM
background.js (service worker)
        ↓  chrome.runtime.connectNative()
claude_usage_host.py  (native host)
        ↓  writes file
%APPDATA%\Claude\usage_data.json
        ↓  reader.lua reads on update
Rainmeter skin (unchanged)
```

**On-demand refresh (Rainmeter "Refresh" button):**
```
Rainmeter → FetchUsage.ps1 → writes refresh_requested.txt
                ↑
background.js sentinel-check alarm (every 30s) → triggers scrape
```

---

## Components

### 1. Chrome Extension (`chrome-extension/`)

**`manifest.json`** — Manifest V3.
- Permissions: `nativeMessaging`, `tabs`, `scripting`, `alarms`
- Host permission: `https://claude.ai/*`
- Background: service worker (`background.js`)
- Content scripts: `content.js` on `https://claude.ai/*`, `run_at: document_idle`

**`background.js`** — Service worker with two alarms:

| Alarm | Period | Action |
|---|---|---|
| `periodic-scrape` | 5 minutes | Find open usage tab → reload → wait for content script → send data to native host |
| `sentinel-check` | 30 seconds | Ask native host if `refresh_requested.txt` exists → if yes, trigger scrape immediately |

Scrape flow:
1. Query all tabs for URL matching `*://claude.ai/*usage*`
2. If none found: send `{error: "No usage tab open"}` to native host → native host writes error to JSON → Rainmeter shows error. Stop.
3. If found: call `chrome.tabs.reload(tabId)` → wait for `chrome.tabs.onUpdated` status `"complete"` → send `{action: "scrape"}` message to content script in that tab → receive scraped data → forward to native host with `{action: "write", data: {...}}`

**`content.js`** — Injected into `claude.ai` pages. Does NOT auto-fire. Listens for `{action: "scrape"}` from background worker.

On scrape request:
- Retries up to 5× with 1-second delays until usage elements are present in DOM
- Targets text content by semantic patterns (numbers adjacent to "tokens", "resets in", percentage labels) — not CSS class names
- Computes `session_pct = Math.round(session_tokens_used / session_token_limit * 100)`
- Computes `weekly_pct` equivalently
- Formats reset times as `"Xh Ym"` strings matching existing `reader.lua` expectations
- Returns: `{session_pct, session_tokens, session_limit, session_reset_label, weekly_pct, weekly_tokens, weekly_limit, weekly_reset_label, last_updated, error}`
- On parse failure after 5 retries: returns `{error: "Could not parse usage page"}`

### 2. Native Host (`native-host/`)

**`claude_usage_host.py`** — Python 3 script. Implements Chrome Native Messaging protocol (4-byte little-endian length prefix + UTF-8 JSON on stdin/stdout).

Handles two message types:

```
{action: "write", data: {...}}
  → writes data to %APPDATA%\Claude\usage_data.json
  → responds {ok: true}

{action: "check_sentinel"}
  → checks for refresh_requested.txt in skin directory
  → responds {trigger: true} and deletes the file if found
  → responds {trigger: false} if not found
```

The skin directory path is passed as a command-line argument when Chrome launches the host (set in `claude.silkwires.usage.json`).

**`claude.silkwires.usage.json`** — Native messaging host manifest:
```json
{
  "name": "claude.silkwires.usage",
  "description": "Claude Usage Monitor native host",
  "path": "C:\\Users\\USER\\Documents\\Rainmeter\\Skins\\ClaudeUsage\\native-host\\launch_host.bat",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
}
```

**`launch_host.bat`** — Launches `python claude_usage_host.py "<skin_dir>"` with the correct working directory.

**`install_host.bat`** — One-time setup script (run as Administrator):
- Writes `claude.silkwires.usage.json` to `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\`
- Adds registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\claude.silkwires.usage` pointing to the manifest

### 3. Modified `FetchUsage.ps1`

Replaces the existing 188-line JSONL scanner with ~5 lines:

```powershell
# Signals the Chrome extension to scrape usage immediately
$SkinDir = $PSScriptRoot
$sentinel = Join-Path $SkinDir "refresh_requested.txt"
Set-Content $sentinel "1" -Encoding UTF8
```

`ClaudeUsage.ini` is unchanged — it still calls `FetchUsage.ps1` via `RunCommand` on button press.

---

## Output JSON Schema

The native host writes the same schema `reader.lua` already reads:

```json
{
  "session_pct": 42,
  "session_tokens": 1893240,
  "session_limit": 4517000,
  "session_reset_label": "2h 14m",
  "weekly_pct": 18,
  "weekly_tokens": 7848000,
  "weekly_limit": 43600000,
  "weekly_reset_label": "4d 7h",
  "last_updated": "14:32:01",
  "error": ""
}
```

---

## Error Handling

| Condition | Behavior |
|---|---|
| No usage tab open | `error: "No usage tab open"` written to JSON, shown in Rainmeter error bar |
| DOM parse fails after 5 retries | `error: "Could not parse usage page"` written to JSON |
| Native host not running / not installed | Extension logs to console; Rainmeter shows stale data |
| `refresh_requested.txt` never cleaned up | Native host deletes on first successful read; no accumulation |

---

## Installation Steps

1. Load unpacked extension: `chrome://extensions` → Developer mode → Load unpacked → `chrome-extension/`
2. Copy the extension ID shown in `chrome://extensions`
3. Paste it into `native-host/claude.silkwires.usage.json` → `allowed_origins`
4. Run `native-host/install_host.bat` as Administrator
5. Open `https://claude.ai/settings/usage` in Chrome and leave the tab open
6. Reload the Rainmeter skin

---

## Files Changed / Added

```
ClaudeUsage/
├── ClaudeUsage.ini              ← UNCHANGED
├── reader.lua                   ← UNCHANGED
├── config.json                  ← UNCHANGED (limits no longer used by PS1, kept for reference)
├── FetchUsage.ps1               ← REPLACED (sentinel-writer, ~5 lines)
├── chrome-extension/
│   ├── manifest.json            ← NEW
│   ├── background.js            ← NEW
│   └── content.js               ← NEW
├── native-host/
│   ├── claude_usage_host.py     ← NEW
│   ├── claude.silkwires.usage.json  ← NEW
│   ├── launch_host.bat          ← NEW
│   └── install_host.bat         ← NEW
└── docs/superpowers/specs/
    └── 2026-06-23-claude-usage-chrome-extension-design.md  ← THIS FILE
```

---

## Out of Scope

- Supporting Firefox or Edge (Chrome Native Messaging only)
- Auto-opening the usage tab if not already open
- Reading data from the Claude API directly
- Modifying the Rainmeter skin display layer
