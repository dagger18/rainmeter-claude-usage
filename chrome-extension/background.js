const NATIVE_HOST = 'claude.silkwires.usage';
const USAGE_TAB_PATTERN = /claude\.ai\/.*(?:usage|settings)/i;
const DISCORD_WEBHOOK = 'https://discordapp.com/api/webhooks/1519181400761303150/NvTTnPc6verdRdz5axcPa-TP2B5B4RWL7olzIOEhSkfex6DclwLRx_bxWI24aOBMTDvs';
const RESET_THRESHOLD = 94;  // % — start watching above this

// Register alarms on install and browser startup.
chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);

function setupAlarms() {
  chrome.alarms.create('periodic-scrape', { periodInMinutes: 2 });
  // 0.5 minutes = 30 seconds (works for unpacked/dev extensions).
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
    console.warn('[ClaudeUsage] no usage tab open - skipping scrape');
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
  await checkSessionReset(data);
  await checkWeekReset(data);
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
        weekly_pct:  0, weekly_tokens:  0, weekly_limit:  0, weekly_reset_label:  '--',
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

async function checkSessionReset(data) {
  if (data.error || data.session_pct == null) return;

  const { watchingForReset } = await chrome.storage.local.get('watchingForReset');

  // Arm the watch when session crosses the threshold.
  if (data.session_pct >= RESET_THRESHOLD && !watchingForReset) {
    await chrome.storage.local.set({ watchingForReset: true });
    console.log(`[ClaudeUsage] session at ${data.session_pct}% — watching for reset`);
    return;
  }

  // Fire once when it drops back to ~0 (session window expired and renewed).
  if (watchingForReset && data.session_pct <= 5) {
    await chrome.storage.local.set({ watchingForReset: false });
    console.log('[ClaudeUsage] session reset detected — sending notification');
    await sendDiscord('🔄 Claude session reset — new 5h window has started.');
    try {
      const r = await sendToHost({ action: 'write_continue' });
      console.log('[ClaudeUsage] write_continue result:', r);
    } catch (e) {
      console.error('[ClaudeUsage] write_continue failed:', e.message);
    }
  }
}

async function checkWeekReset(data) {
  if (data.error || data.weekly_pct == null) return;

  const { lastWeeklyPct } = await chrome.storage.local.get('lastWeeklyPct');
  const last = typeof lastWeeklyPct === 'number' ? lastWeeklyPct : null;

  // Detect reset: pct dropped significantly from last reading
  if (last !== null && data.weekly_pct < last - 10) {
    // Only record if the completed week had actual usage (not 0 or error)
    if (last > 0) {
      const weekEnd = new Date().toISOString().slice(0, 10);
      try {
        const r = await sendToHost({ action: 'record_week', pct: last, week_end: weekEnd });
        console.log(`[ClaudeUsage] week recorded: ${last}% on ${weekEnd} — lifetime avg: ${r.lifetime_avg_pct}% over ${r.weeks_recorded} weeks`);
      } catch (e) {
        console.error('[ClaudeUsage] record_week failed:', e.message);
      }
    }
  }

  await chrome.storage.local.set({ lastWeeklyPct: data.weekly_pct });
}

async function sendDiscord(content) {
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) console.error('[ClaudeUsage] Discord error:', await res.text());
  } catch (e) {
    console.error('[ClaudeUsage] Discord fetch failed:', e);
  }
}
