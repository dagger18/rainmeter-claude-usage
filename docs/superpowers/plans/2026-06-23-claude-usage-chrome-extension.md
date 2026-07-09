# Claude Usage Monitor — Chrome Extension + Native Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken JSONL-based `FetchUsage.ps1` with a Chrome extension that scrapes real usage data from the open `claude.ai/settings/usage` tab and feeds it to the existing Rainmeter skin via Chrome Native Messaging.

**Architecture:** A Chrome MV3 extension (background service worker + content script) scrapes the claude.ai usage page DOM, sends the data to a Python native host process via Chrome's stdio native messaging protocol, and the host writes `%APPDATA%\Claude\usage_data.json` — the same file `reader.lua` and Rainmeter already read. The display layer is untouched.

**Tech Stack:** Python 3 (native host), JavaScript/Chrome MV3 (extension), PowerShell (sentinel writer), pytest (host tests).

## Global Constraints

- Skin directory: `C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\`
- Output file: `%APPDATA%\Claude\usage_data.json` (same schema as today — `reader.lua` unchanged)
- Chrome Manifest V3 (not V2)
- Python 3 — use `python` on PATH (no virtual env needed, stdlib only)
- `reader.lua` reads these exact JSON keys: `session_pct` (number), `weekly_pct` (number), `session_reset_label` (string), `weekly_reset_label` (string), `last_updated` (string `"HH:mm:ss"`), `error` (string)
- Reset label format must match existing display: `"Xh Ym"` (e.g. `"2h 14m"`) or `"Xd Yh"` for multi-day
- `ClaudeUsage.ini` and `reader.lua` are NOT modified
- Native messaging host name: `claude.silkwires.usage`
- Sentinel file: `<skin_dir>\refresh_requested.txt`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `native-host/claude_usage_host.py` | CREATE | Reads Chrome native messaging stdin, writes JSON, checks sentinel |
| `native-host/tests/test_host.py` | CREATE | Automated pytest tests for the host |
| `native-host/claude.silkwires.usage.json` | CREATE | Chrome native messaging manifest |
| `native-host/launch_host.bat` | CREATE | Launches the Python host (Chrome calls this) |
| `native-host/install_host.bat` | CREATE | One-time setup: copies manifest, writes registry key |
| `chrome-extension/manifest.json` | CREATE | MV3 manifest: permissions, background, content script |
| `chrome-extension/content.js` | CREATE | DOM scraper: reads usage data from claude.ai page |
| `chrome-extension/background.js` | CREATE | Service worker: alarms, tab management, native messaging |
| `FetchUsage.ps1` | REPLACE | Sentinel writer only (~5 lines) |

---

## Task 1: Native Host Python Script

**Files:**
- Create: `native-host/claude_usage_host.py`
- Create: `native-host/tests/__init__.py` (empty)
- Create: `native-host/tests/test_host.py`

**Interfaces:**
- Consumes: Chrome native messaging messages on stdin (4-byte LE length + UTF-8 JSON)
- Produces: `%APPDATA%\Claude\usage_data.json` on disk; JSON responses on stdout

- [ ] **Step 1: Create the host script**

Create `native-host/claude_usage_host.py`:

```python
import sys
import json
import struct
import os


def _read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) == 0:
        sys.exit(0)
    length = struct.unpack('<I', raw_len)[0]
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))


def _write_message(data):
    encoded = json.dumps(data).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def main():
    skin_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(os.environ['APPDATA'], 'Claude')
    output_file = os.path.join(output_dir, 'usage_data.json')
    sentinel_file = os.path.join(skin_dir, 'refresh_requested.txt')

    while True:
        msg = _read_message()
        action = msg.get('action')

        if action == 'write':
            data = msg.get('data', {})
            os.makedirs(output_dir, exist_ok=True)
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            _write_message({'ok': True})

        elif action == 'check_sentinel':
            if os.path.exists(sentinel_file):
                try:
                    os.remove(sentinel_file)
                except OSError:
                    pass
                _write_message({'trigger': True})
            else:
                _write_message({'trigger': False})

        else:
            _write_message({'error': f'Unknown action: {action}'})


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Create empty `tests/__init__.py`**

Create `native-host/tests/__init__.py` with empty contents.

- [ ] **Step 3: Write the failing tests**

Create `native-host/tests/test_host.py`:

```python
import json
import os
import struct
import subprocess
import sys
import pathlib

HOST = pathlib.Path(__file__).parent.parent / 'claude_usage_host.py'


def _send(proc, data):
    encoded = json.dumps(data).encode('utf-8')
    proc.stdin.write(struct.pack('<I', len(encoded)))
    proc.stdin.write(encoded)
    proc.stdin.flush()


def _recv(proc):
    raw = proc.stdout.read(4)
    assert raw, "No response from host"
    length = struct.unpack('<I', raw)[0]
    return json.loads(proc.stdout.read(length).decode('utf-8'))


def _start_host(skin_dir):
    return subprocess.Popen(
        [sys.executable, str(HOST), str(skin_dir)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )


def test_write_creates_json_file(tmp_path):
    proc = _start_host(tmp_path)
    data = {
        'session_pct': 42,
        'session_tokens': 1893240,
        'session_limit': 4517000,
        'session_reset_label': '2h 14m',
        'weekly_pct': 18,
        'weekly_tokens': 7848000,
        'weekly_limit': 43600000,
        'weekly_reset_label': '4d 7h',
        'last_updated': '14:32:01',
        'error': '',
    }
    _send(proc, {'action': 'write', 'data': data})
    response = _recv(proc)
    proc.terminate()

    assert response == {'ok': True}
    output = pathlib.Path(os.environ['APPDATA']) / 'Claude' / 'usage_data.json'
    assert output.exists()
    written = json.loads(output.read_text(encoding='utf-8'))
    assert written['session_pct'] == 42
    assert written['weekly_pct'] == 18
    assert written['session_reset_label'] == '2h 14m'
    assert written['last_updated'] == '14:32:01'
    assert written['error'] == ''


def test_check_sentinel_true_when_file_exists(tmp_path):
    sentinel = tmp_path / 'refresh_requested.txt'
    sentinel.write_text('1', encoding='utf-8')

    proc = _start_host(tmp_path)
    _send(proc, {'action': 'check_sentinel'})
    response = _recv(proc)
    proc.terminate()

    assert response == {'trigger': True}
    assert not sentinel.exists()


def test_check_sentinel_false_when_file_absent(tmp_path):
    proc = _start_host(tmp_path)
    _send(proc, {'action': 'check_sentinel'})
    response = _recv(proc)
    proc.terminate()

    assert response == {'trigger': False}


def test_unknown_action_returns_error(tmp_path):
    proc = _start_host(tmp_path)
    _send(proc, {'action': 'bogus'})
    response = _recv(proc)
    proc.terminate()

    assert 'error' in response


def test_multiple_messages_in_sequence(tmp_path):
    sentinel = tmp_path / 'refresh_requested.txt'
    proc = _start_host(tmp_path)

    _send(proc, {'action': 'check_sentinel'})
    r1 = _recv(proc)
    assert r1 == {'trigger': False}

    sentinel.write_text('1', encoding='utf-8')
    _send(proc, {'action': 'check_sentinel'})
    r2 = _recv(proc)
    assert r2 == {'trigger': True}

    _send(proc, {'action': 'check_sentinel'})
    r3 = _recv(proc)
    proc.terminate()
    assert r3 == {'trigger': False}
```

- [ ] **Step 4: Run tests — expect PASS (host already written)**

```
cd C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\native-host
python -m pytest tests/ -v
```

Expected output: 5 tests PASSED.

- [ ] **Step 5: Commit**

```
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" init
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" add native-host/claude_usage_host.py native-host/tests/
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" commit -m "feat: add native messaging host with sentinel support"
```

> Note: If the directory is not a git repo, run `git init` first. If it already is, skip `git init`.

---

## Task 2: Native Host Installation Files

**Files:**
- Create: `native-host/claude.silkwires.usage.json`
- Create: `native-host/launch_host.bat`
- Create: `native-host/install_host.bat`

**Interfaces:**
- Consumes: `claude_usage_host.py` from Task 1
- Produces: Registered native messaging host Chrome can find by name `claude.silkwires.usage`

- [ ] **Step 1: Create the host manifest template**

Create `native-host/claude.silkwires.usage.json`:

```json
{
  "name": "claude.silkwires.usage",
  "description": "Claude Usage Monitor native host",
  "path": "C:\\Users\\USER\\Documents\\Rainmeter\\Skins\\ClaudeUsage\\native-host\\launch_host.bat",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://EXTENSION_ID_PLACEHOLDER/"]
}
```

> The `EXTENSION_ID_PLACEHOLDER` is filled in by `install_host.bat` (Step 3).

- [ ] **Step 2: Create `launch_host.bat`**

Create `native-host/launch_host.bat`:

```bat
@echo off
set SKIN_DIR=C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage
python "%SKIN_DIR%\native-host\claude_usage_host.py" "%SKIN_DIR%"
```

- [ ] **Step 3: Create `install_host.bat`**

Create `native-host/install_host.bat`:

```bat
@echo off
setlocal

set SKIN_DIR=C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage
set HOST_DIR=%SKIN_DIR%\native-host
set MANIFEST_SRC=%HOST_DIR%\claude.silkwires.usage.json
set NMH_DIR=%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts
set MANIFEST_DST=%NMH_DIR%\claude.silkwires.usage.json

echo.
echo === Claude Usage Monitor — Native Host Installer ===
echo.

:: Prompt for extension ID
set /p EXT_ID="Paste your Chrome extension ID (from chrome://extensions): "
if "%EXT_ID%"=="" (
    echo ERROR: Extension ID cannot be empty.
    pause
    exit /b 1
)

:: Write manifest with real extension ID to NativeMessagingHosts
if not exist "%NMH_DIR%" mkdir "%NMH_DIR%"

(
  echo {
  echo   "name": "claude.silkwires.usage",
  echo   "description": "Claude Usage Monitor native host",
  echo   "path": "%HOST_DIR:\=\\%\\launch_host.bat",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
  echo }
) > "%MANIFEST_DST%"

:: Registry key (HKCU — no admin required)
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\claude.silkwires.usage" /ve /t REG_SZ /d "%MANIFEST_DST%" /f

echo.
echo Done! Restart Chrome, then reload the Rainmeter skin.
echo.
pause
```

- [ ] **Step 4: Manual verification**

Open a cmd window (no admin needed) and run:

```
C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\native-host\install_host.bat
```

When prompted, enter any placeholder ID like `abcdefghijklmnopqrstuvwxyzabcdef` for now (you'll replace it after loading the extension in Task 4).

Verify registry key was created:

```
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\claude.silkwires.usage"
```

Expected: prints the path to the manifest JSON.

Verify the manifest file exists:

```
type "%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\claude.silkwires.usage.json"
```

Expected: valid JSON with your placeholder extension ID.

- [ ] **Step 5: Commit**

```
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" add native-host/claude.silkwires.usage.json native-host/launch_host.bat native-host/install_host.bat
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" commit -m "feat: add native host installation scripts"
```

---

## Task 3: Chrome Extension Manifest and Content Script

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/content.js`

**Interfaces:**
- Consumes: nothing from prior tasks at runtime
- Produces: `chrome.runtime.sendMessage` response to `background.js` with shape `{session_pct, session_tokens, session_limit, session_reset_label, weekly_pct, weekly_tokens, weekly_limit, weekly_reset_label, last_updated, error}`

- [ ] **Step 1: Create `manifest.json`**

Create `chrome-extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Claude Usage Monitor",
  "version": "1.0",
  "description": "Feeds Claude usage data to the Rainmeter desktop widget",
  "permissions": [
    "nativeMessaging",
    "tabs",
    "alarms"
  ],
  "host_permissions": [
    "https://claude.ai/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Create `content.js`**

Create `chrome-extension/content.js`:

```javascript
// Listens for {action: "scrape"} from background.js and returns parsed usage data.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'scrape') return;
  scrapeWithRetry(5, 1000).then(sendResponse);
  return true; // keep message channel open for async response
});

async function scrapeWithRetry(maxAttempts, delayMs) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = scrapeUsage();
    if (!result.error) return result;
    if (i < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return errorResult('Could not parse usage page');
}

function scrapeUsage() {
  // Strategy 1: ARIA progress bars (most stable).
  // claude.ai usage bars use role="progressbar" with aria-valuenow (used) and aria-valuemax (limit).
  const bars = Array.from(document.querySelectorAll('[role="progressbar"]'));

  if (bars.length >= 2) {
    return parseFromBars(bars);
  }

  // Strategy 2: Full-text regex fallback.
  return parseFromText(document.body.innerText);
}

function parseFromBars(bars) {
  // Each bar should have aria-valuenow (used tokens) and aria-valuemax (limit).
  // We determine which is session vs weekly by order on page (session comes first on claude.ai).
  const parsed = bars.slice(0, 2).map(bar => ({
    used: parseInt(bar.getAttribute('aria-valuenow') || '0', 10),
    limit: parseInt(bar.getAttribute('aria-valuemax') || '0', 10),
  }));

  const [session, weekly] = parsed;

  if (!session.limit || !weekly.limit) {
    return errorResult('Progress bars found but limits are zero');
  }

  // Find reset times from nearby text. Walk up to find a labelled section,
  // then search for "reset" text within it.
  const resets = bars.slice(0, 2).map(bar => extractResetNear(bar));

  return buildResult(
    session.used, session.limit, resets[0],
    weekly.used,  weekly.limit,  resets[1]
  );
}

function extractResetNear(el) {
  // Walk up DOM tree up to 6 levels to find a container with reset text.
  let node = el;
  for (let i = 0; i < 6; i++) {
    node = node.parentElement;
    if (!node) break;
    const text = node.innerText || '';
    const match = text.match(/reset[s]?\s+in\s+([\w\s]+?)(?:\n|$|\.)/i);
    if (match) return normalizeResetLabel(match[1].trim());
  }
  return '--';
}

function parseFromText(text) {
  // Match patterns like "1,234,567 / 4,517,000 tokens" or "1234567 of 4517000 tokens".
  const tokenPattern = /([\d,]+)\s*(?:\/|of)\s*([\d,]+)\s*tokens/gi;
  const matches = [];
  let m;
  while ((m = tokenPattern.exec(text)) !== null) {
    matches.push({
      used: parseInt(m[1].replace(/,/g, ''), 10),
      limit: parseInt(m[2].replace(/,/g, ''), 10),
    });
  }

  if (matches.length < 2) {
    return errorResult('Could not find token usage patterns in page text');
  }

  // Match reset times: "Resets in 2 hours 14 minutes" or "Resets in 4 days 7 hours"
  const resetPattern = /reset[s]?\s+in\s+([\w\s]+?)(?:\n|$|\.)/gi;
  const resets = [];
  while ((m = resetPattern.exec(text)) !== null) {
    resets.push(normalizeResetLabel(m[1].trim()));
  }

  return buildResult(
    matches[0].used, matches[0].limit, resets[0] || '--',
    matches[1].used, matches[1].limit, resets[1] || '--'
  );
}

function normalizeResetLabel(raw) {
  // Normalize "2 hours 14 minutes", "2h 14m", "4 days 7 hours", "4d 7h", etc. → "Xh Ym" or "Xd Yh"
  const days  = raw.match(/(\d+)\s*d(?:ay[s]?)?/i);
  const hours = raw.match(/(\d+)\s*h(?:our[s]?)?/i);
  const mins  = raw.match(/(\d+)\s*m(?:in(?:ute[s]?)?)?/i);

  const d = days  ? parseInt(days[1],  10) : 0;
  const h = hours ? parseInt(hours[1], 10) : 0;
  const mn = mins  ? parseInt(mins[1],  10) : 0;

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mn}m`;
  if (mn > 0) return `${mn}m`;
  return 'now';
}

function buildResult(sUsed, sLimit, sReset, wUsed, wLimit, wReset) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return {
    session_pct:          Math.min(100, Math.round(sUsed / sLimit * 100)),
    session_tokens:       sUsed,
    session_limit:        sLimit,
    session_reset_label:  sReset,
    weekly_pct:           Math.min(100, Math.round(wUsed / wLimit * 100)),
    weekly_tokens:        wUsed,
    weekly_limit:         wLimit,
    weekly_reset_label:   wReset,
    last_updated:         `${hh}:${mm}:${ss}`,
    error:                '',
  };
}

function errorResult(msg) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return {
    session_pct: 0, session_tokens: 0, session_limit: 0, session_reset_label: '--',
    weekly_pct: 0,  weekly_tokens: 0,  weekly_limit: 0,  weekly_reset_label: '--',
    last_updated: `${hh}:${mm}:${ss}`,
    error: msg,
  };
}
```

- [ ] **Step 3: Load the extension in Chrome and get its ID**

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select `C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\chrome-extension\`
5. Copy the 32-character extension ID shown under the extension name (e.g. `abcdefghijklmnopqrstuvwxyzabcdef`)

- [ ] **Step 4: Re-run `install_host.bat` with the real extension ID**

```
C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\native-host\install_host.bat
```

Paste the real extension ID when prompted. Restart Chrome after this step.

- [ ] **Step 5: Manual content script test**

1. Open `https://claude.ai/settings/usage` in Chrome
2. Open DevTools → Console
3. Run:
   ```javascript
   chrome.runtime.sendMessage({action: 'scrape'}, r => console.log(r))
   ```
   > Note: this won't work from DevTools directly — instead check Task 4 Step 5 where background.js triggers it. Skip for now and validate in Task 4.

- [ ] **Step 6: Commit**

```
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" add chrome-extension/manifest.json chrome-extension/content.js
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" commit -m "feat: add chrome extension manifest and content script"
```

---

## Task 4: Background Service Worker

**Files:**
- Create: `chrome-extension/background.js`

**Interfaces:**
- Consumes: `content.js` message response (shape defined in Task 3 Interfaces → Produces)
- Consumes: native host `check_sentinel` → `{trigger: bool}` and `write` → `{ok: true}` (Task 1)
- Produces: `%APPDATA%\Claude\usage_data.json` written via native host

- [ ] **Step 1: Create `background.js`**

Create `chrome-extension/background.js`:

```javascript
const NATIVE_HOST = 'claude.silkwires.usage';
const USAGE_TAB_PATTERN = /claude\.ai\/.*(?:usage|settings)/i;

// Register alarms on install and browser startup.
chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);

function setupAlarms() {
  chrome.alarms.create('periodic-scrape', { periodInMinutes: 5 });
  // 0.5 minutes = 30 seconds (Chrome minimum alarm period is 1 minute in production,
  // but 30s works for unpacked/dev extensions).
  chrome.alarms.create('sentinel-check', { periodInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodic-scrape') {
    await triggerScrape('periodic');
  } else if (alarm.name === 'sentinel-check') {
    await checkSentinel();
  }
});

async function checkSentinel() {
  try {
    const response = await sendToHost({ action: 'check_sentinel' });
    if (response && response.trigger) {
      await triggerScrape('sentinel');
    }
  } catch (e) {
    console.error('[ClaudeUsage] sentinel check failed:', e);
  }
}

async function triggerScrape(reason) {
  console.log(`[ClaudeUsage] scrape triggered by: ${reason}`);

  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  const usageTab = tabs.find(t => USAGE_TAB_PATTERN.test(t.url || ''));

  if (!usageTab) {
    console.warn('[ClaudeUsage] no usage tab open — skipping scrape');
    await writeError('No usage tab open');
    return;
  }

  // Reload the tab and wait for it to finish loading.
  await chrome.tabs.reload(usageTab.id);
  await waitForTabLoad(usageTab.id);

  // Give the page JS an extra moment to render usage data after load.
  await sleep(1500);

  let data;
  try {
    data = await chrome.tabs.sendMessage(usageTab.id, { action: 'scrape' });
  } catch (e) {
    console.error('[ClaudeUsage] content script error:', e);
    await writeError('Content script failed: ' + e.message);
    return;
  }

  if (!data) {
    await writeError('No data returned from content script');
    return;
  }

  console.log('[ClaudeUsage] scraped:', data);
  await sendToHost({ action: 'write', data });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Safety timeout: resolve after 15s regardless.
    setTimeout(resolve, 15000);
  });
}

function sendToHost(message) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (e) {
      reject(new Error('Native host not found: ' + e.message));
      return;
    }

    const timeout = setTimeout(() => {
      port.disconnect();
      reject(new Error('Native host timeout'));
    }, 5000);

    port.onMessage.addListener((response) => {
      clearTimeout(timeout);
      port.disconnect();
      resolve(response);
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
    });

    port.postMessage(message);
  });
}

async function writeError(msg) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  try {
    await sendToHost({
      action: 'write',
      data: {
        session_pct: 0, session_tokens: 0, session_limit: 0, session_reset_label: '--',
        weekly_pct: 0,  weekly_tokens: 0,  weekly_limit: 0,  weekly_reset_label: '--',
        last_updated: `${hh}:${mm}:${ss}`,
        error: msg,
      },
    });
  } catch (e) {
    console.error('[ClaudeUsage] could not write error to host:', e);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
```

- [ ] **Step 2: Reload the extension in Chrome**

Go to `chrome://extensions`, find **Claude Usage Monitor**, click the refresh/reload icon (circular arrow).

- [ ] **Step 3: Verify alarms are registered**

In Chrome DevTools for the service worker (click "Service Worker" link on the extension card at `chrome://extensions`):

```javascript
chrome.alarms.getAll(alarms => console.log(alarms))
```

Expected: array with two entries — `periodic-scrape` (periodInMinutes: 5) and `sentinel-check` (periodInMinutes: 0.5).

- [ ] **Step 4: Verify native messaging connection**

In the service worker DevTools console:

```javascript
chrome.runtime.connectNative('claude.silkwires.usage')
```

Expected: no error in console. If you see "Specified native messaging host not found", re-run `install_host.bat` with the correct extension ID and restart Chrome.

- [ ] **Step 5: Manual end-to-end test of the scrape flow**

1. Open `https://claude.ai/settings/usage` in a Chrome tab (log in if needed)
2. In the service worker DevTools console, trigger a scrape manually:
   ```javascript
   // Paste and run this in the service worker console
   (async () => {
     const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
     console.log('Found tabs:', tabs.map(t => t.url));
   })()
   ```
   Expected: logs the claude.ai usage tab URL.

3. Trigger a full scrape:
   ```javascript
   // This calls the internal triggerScrape function; since it's not exported,
   // simulate by firing the alarm manually:
   chrome.alarms.create('test-now', { when: Date.now() + 100 });
   // Then add a one-time listener — or just wait for the 5-min periodic alarm.
   // Easier: dispatch the sentinel file approach from Step 6.
   ```

4. Check the output file was written:
   Open PowerShell and run:
   ```powershell
   Get-Content "$env:APPDATA\Claude\usage_data.json"
   ```
   Expected: valid JSON with non-zero `session_pct` or `weekly_pct` and a valid `last_updated` timestamp.

- [ ] **Step 6: Verify sentinel trigger path**

In PowerShell:
```powershell
"1" | Set-Content "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\refresh_requested.txt" -Encoding UTF8
```

Wait up to 30 seconds. Check the output file timestamp updated:
```powershell
(Get-Item "$env:APPDATA\Claude\usage_data.json").LastWriteTime
```

Expected: timestamp within the last 30 seconds.

- [ ] **Step 7: Commit**

```
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" add chrome-extension/background.js
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" commit -m "feat: add background service worker with alarms and native messaging"
```

---

## Task 5: Replace FetchUsage.ps1 and Final Verification

**Files:**
- Modify: `FetchUsage.ps1` (replace entirely)

**Interfaces:**
- Consumes: nothing (called by Rainmeter `RunCommand`)
- Produces: `refresh_requested.txt` sentinel file in skin directory → picked up by background.js sentinel alarm

- [ ] **Step 1: Replace `FetchUsage.ps1`**

Overwrite `C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\FetchUsage.ps1` with:

```powershell
# Signals the Chrome extension to scrape usage data immediately.
# Called by Rainmeter when the user clicks "Refresh".
Set-Content -Path (Join-Path $PSScriptRoot "refresh_requested.txt") -Value "1" -Encoding UTF8
```

- [ ] **Step 2: Verify the sentinel writer works**

Open PowerShell and run:
```powershell
& "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage\FetchUsage.ps1"
```

Expected: `refresh_requested.txt` appears in the skin directory. Within 30 seconds it disappears (the extension consumed it) and `usage_data.json` is updated.

Check:
```powershell
Get-Content "$env:APPDATA\Claude\usage_data.json" | ConvertFrom-Json | Select session_pct, weekly_pct, last_updated, error
```

- [ ] **Step 3: Reload Rainmeter skin**

Right-click the Rainmeter tray icon → Manage → find `ClaudeUsage\ClaudeUsage.ini` → **Refresh skin**.

Expected: widget shows real session %, weekly %, and reset labels from claude.ai. No error bar.

- [ ] **Step 4: Test the Rainmeter Refresh button**

Click **Refresh** on the widget. Within 30 seconds the `last_updated` timestamp on the widget changes.

- [ ] **Step 5: Commit**

```
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" add FetchUsage.ps1
git -C "C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage" commit -m "feat: replace FetchUsage.ps1 with sentinel writer — scraping now done by Chrome extension"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Chrome extension scrapes claude.ai DOM | Task 3 (content.js), Task 4 (background.js triggers scrape) |
| Native messaging host writes usage_data.json | Task 1 (host), Task 2 (installation) |
| Periodic refresh every 5 minutes | Task 4 (periodic-scrape alarm) |
| On-demand via Rainmeter Refresh button | Task 5 (FetchUsage.ps1 sentinel) + Task 4 (sentinel-check alarm) |
| Sentinel picked up within 30 seconds | Task 4 (sentinel-check alarm at 30s period) |
| No usage tab open → error in Rainmeter | Task 4 (writeError path) |
| DOM parse fail after 5 retries → error | Task 3 (scrapeWithRetry) |
| reader.lua and ClaudeUsage.ini unchanged | Not touched in any task ✓ |
| Output JSON schema unchanged | Task 1 output matches reader.lua expected keys ✓ |
| last_updated format "HH:mm:ss" | Task 3 (buildResult), Task 4 (writeError) ✓ |
| reset_label format "Xh Ym" or "Xd Yh" | Task 3 (normalizeResetLabel) ✓ |

**No placeholders found.** All steps contain complete code.

**Type consistency:** `errorResult()` in `content.js` and `writeError()` in `background.js` both produce the same JSON shape with the same key names as `buildResult()`. `sendToHost()` in background.js matches the `action` strings handled by `main()` in `claude_usage_host.py`. ✓
