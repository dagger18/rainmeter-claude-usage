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
  // claude.ai usage bars use role="meter" with aria-valuenow as percentage (0-100).
  const bars = Array.from(document.querySelectorAll('[role="meter"]'));

  if (bars.length >= 2) {
    return parseFromBars(bars);
  }

  return errorResult('Could not find usage meters');
}

function parseFromBars(bars) {
  // Session meter is first on the page; "All models" weekly meter is second.
  // aria-valuenow is already the percentage (0-100); aria-valuemax is always 100.
  const sessionPct = parseInt(bars[0].getAttribute('aria-valuenow') || '0', 10);
  const weeklyPct  = parseInt(bars[1].getAttribute('aria-valuenow') || '0', 10);

  const resets = [bars[0], bars[1]].map(bar => extractResetNear(bar));

  return buildResult(
    sessionPct, 0, resets[0],
    weeklyPct,  0, resets[1]
  );
}

function extractResetNear(el) {
  // Walk up DOM tree up to 6 levels to find a container with reset text.
  // Handles both "Resets in 2h 14m" and "Resets Fri 8:00 PM" formats.
  let node = el;
  for (let i = 0; i < 6; i++) {
    node = node.parentElement;
    if (!node) break;
    const text = node.innerText || '';
    const match = text.match(/reset[s]?\s+(?:in\s+)?([\w\s:]+?)(?:\n|$|\.)/i);
    if (match) return normalizeResetLabel(match[1].trim());
  }
  return '--';
}


function normalizeResetLabel(raw) {
  // Handle "at TIME" (today, no day name): "at 8:00 PM"
  const todayTime = raw.match(/^at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (todayTime) return todayTimeToLabel(parseInt(todayTime[1], 10), parseInt(todayTime[2], 10), todayTime[3]);

  // Handle absolute day+time with full or abbreviated names: "Wednesday 6:00 PM", "Fri 8:00 PM"
  const dayTime = raw.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (dayTime) return dayTimeToLabel(dayTime[1], parseInt(dayTime[2], 10), parseInt(dayTime[3], 10), dayTime[4]);

  // Handle duration: "2 hours 14 minutes", "2h 14m", "4 days 7 hours"
  const days  = raw.match(/(\d+)\s*d(?:ay[s]?)?/i);
  const hours = raw.match(/(\d+)\s*h(?:our[s]?)?/i);
  const mins  = raw.match(/(\d+)\s*m(?:in(?:ute[s]?)?)?/i);

  const d  = days  ? parseInt(days[1],  10) : 0;
  const h  = hours ? parseInt(hours[1], 10) : 0;
  const mn = mins  ? parseInt(mins[1],  10) : 0;

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mn}m`;
  if (mn > 0) return `${mn}m`;
  return 'now';
}

function todayTimeToLabel(hour12, minute, ampm) {
  let hour24 = hour12 % 12;
  if (ampm.toUpperCase() === 'PM') hour24 += 12;

  const now = new Date();
  const target = new Date(now);
  target.setHours(hour24, minute, 0, 0);

  const diffMs = target - now;
  if (diffMs <= 0) return 'now';

  const totalMins = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;

  if (totalHours > 0) return `${totalHours}h ${remMins}m`;
  return `${totalMins}m`;
}

function dayTimeToLabel(dayName, hour12, minute, ampm) {
  const DAY_NAMES      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let targetDay = DAY_NAMES.findIndex(d => d.toLowerCase() === dayName.toLowerCase());
  if (targetDay === -1) targetDay = FULL_DAY_NAMES.findIndex(d => d.toLowerCase() === dayName.toLowerCase());

  let hour24 = hour12 % 12;
  if (ampm.toUpperCase() === 'PM') hour24 += 12;

  const now = new Date();
  const target = new Date(now);
  target.setHours(hour24, minute, 0, 0);

  // Find next occurrence of targetDay, advancing by whole days
  let daysUntil = (targetDay - now.getDay() + 7) % 7;
  if (daysUntil === 0 && target <= now) daysUntil = 7;
  target.setDate(target.getDate() + daysUntil);

  const diffMs = target - now;
  const totalMins = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMins / 60);
  const diffDays = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  const remMins = totalMins % 60;

  if (diffDays > 0) return `${diffDays}d ${remHours}h`;
  if (totalHours > 0) return `${totalHours}h ${remMins}m`;
  return `${totalMins}m`;
}

function buildResult(sPct, _sLimit, sReset, wPct, _wLimit, wReset) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return {
    session_pct:         Math.min(100, sPct),
    session_tokens:      0,
    session_limit:       0,
    session_reset_label: sReset,
    weekly_pct:          Math.min(100, wPct),
    weekly_tokens:       0,
    weekly_limit:        0,
    weekly_reset_label:  wReset,
    last_updated:        `${hh}:${mm}:${ss}`,
    last_updated_ts:     Math.floor(Date.now() / 1000),
    error:               '',
  };
}

function errorResult(msg) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return {
    session_pct: 0, session_tokens: 0, session_limit: 0, session_reset_label: '--',
    weekly_pct:  0, weekly_tokens:  0, weekly_limit:  0, weekly_reset_label:  '--',
    last_updated:    `${hh}:${mm}:${ss}`,
    last_updated_ts: Math.floor(Date.now() / 1000),
    error: msg,
  };
}
