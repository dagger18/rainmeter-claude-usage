# Claude Code Usage Monitor — Rainmeter Plugin

A Rainmeter desktop widget that shows your **Claude Code** token and cost usage for the **current session** and **rolling 7-day week**, with live progress bars and a refresh button.

---

## 📁 Files

```
ClaudeUsage/
├── ClaudeUsage.ini     ← Main skin (the widget you see)
├── Settings.ini        ← Limit editor panel
├── Parser.lua          ← Lua script: reads JSON, feeds meters
├── FetchUsage.ps1      ← PowerShell: reads Claude Code logs → writes JSON
└── @Resources/
    └── Variables.inc   ← Shared theme tokens
```

---

## 🚀 Installation

### 1. Copy the skin folder

```
%USERPROFILE%\Documents\Rainmeter\Skins\ClaudeUsage\
```

So the path looks like:
```
C:\Users\YourName\Documents\Rainmeter\Skins\ClaudeUsage\ClaudeUsage.ini
```

### 2. Allow PowerShell scripts (one-time, run as Administrator)

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 3. Run FetchUsage.ps1 once manually to create the data file

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\...\Skins\ClaudeUsage\FetchUsage.ps1"
```

This creates: `%APPDATA%\Claude\usage_data.json`

### 4. Load the skin in Rainmeter

- Open **Rainmeter** → Manage → Skins
- Find `ClaudeUsage` → `ClaudeUsage.ini` → **Load**

---

## ⚙️ Configuring Your Limits

Open `FetchUsage.ps1` and edit the `CONFIG` section at the top:

```powershell
$SessionTokenLimit   = 200000    # tokens per session (resets daily)
$SessionCostLimit    = 5.00      # USD per session
$WeeklyTokenLimit    = 2000000   # tokens per rolling 7 days
$WeeklyCostLimit     = 50.00     # USD per rolling 7 days

# Pricing per 1M tokens (Claude Sonnet 4 defaults)
$InputPricePer1M     = 3.00
$OutputPricePer1M    = 15.00
```

---

## 🔄 Auto-Refresh

By default the skin polls every **5 seconds** (Rainmeter `Update=5000`) but only calls PowerShell when you press **↻ Refresh Now** or every skin reload.

To auto-fetch on a schedule, add a Windows Task Scheduler entry:

```
Program : powershell.exe
Args    : -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\...\FetchUsage.ps1"
Trigger : Every 5 minutes
```

---

## 📂 Claude Code Data Sources

`FetchUsage.ps1` searches these paths for usage logs:

| Source | Path |
|--------|------|
| VSCode Extension | `%APPDATA%\Code\User\globalStorage\anthropic.claude-code\` |
| VSCode Insiders | `%APPDATA%\Code - Insiders\...` |
| Claude Desktop App | `%APPDATA%\Claude\` |
| CLI config | `%USERPROFILE%\.claude\` |

It reads `usage.jsonl` and any `conversation*.json` / `messages*.json` files it finds.

---

## 🎨 Customisation

| What | Where |
|------|-------|
| Colors / fonts | `ClaudeUsage.ini` → `[Variables]` section |
| Bar width / height | `BarW` / `BarH` variables |
| Skin size | `W` variable + `[Background]` shape |
| Pricing model | `FetchUsage.ps1` `$InputPricePer1M` / `$OutputPricePer1M` |

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| All values show `0` | Run `FetchUsage.ps1` manually; check that `usage_data.json` is created |
| "N/A" on last updated | Data file missing — check PowerShell execution policy |
| Wrong token counts | Claude Code may store logs in a different path; open `FetchUsage.ps1` and add your path to `$candidates` |
| Bars always full/empty | Adjust `$SessionTokenLimit` / `$WeeklyTokenLimit` in `FetchUsage.ps1` |

---

## 📜 License

MIT — free to use, modify, and redistribute.
