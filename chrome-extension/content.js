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
  // Each bar has aria-valuenow (used tokens) and aria-valuemax (limit).
  // Session comes first on the page, weekly second.
  const parsed = bars.slice(0, 2).map(bar => ({
    used: parseInt(bar.getAttribute('aria-valuenow') || '0', 10),
    limit: parseInt(bar.getAttribute('aria-valuemax') || '0', 10),
  }));

  const [session, weekly] = parsed;

  if (!session.limit || !weekly.limit) {
    return errorResult('Progress bars found but limits are zero');
  }

  const resets = bars.slice(0, 2).map(bar => extractResetNear(bar));

  return buildResult(
    session.used, session.limit, resets[0],
    weekly.used,  weekly.limit,  resets[1]
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

  // Match "Resets in 2h 14m", "Resets in 4 days", or "Resets Fri 8:00 PM"
  const resetPattern = /reset[s]?\s+(?:in\s+)?([\w\s:]+?)(?:\n|$|\.)/gi;
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
  // Handle absolute day+time: "Fri 8:00 PM", "Mon 12:30 AM"
  const dayTime = raw.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
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

function dayTimeToLabel(dayName, hour12, minute, ampm) {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const targetDay = DAY_NAMES.findIndex(d => d.toLowerCase() === dayName.toLowerCase());

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

function buildResult(sUsed, sLimit, sReset, wUsed, wLimit, wReset) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  return {
    session_pct:         Math.min(100, Math.round(sUsed / sLimit * 100)),
    session_tokens:      sUsed,
    session_limit:       sLimit,
    session_reset_label: sReset,
    weekly_pct:          Math.min(100, Math.round(wUsed / wLimit * 100)),
    weekly_tokens:       wUsed,
    weekly_limit:        wLimit,
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
