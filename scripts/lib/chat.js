// Ports the chat-parsing + week-math from index.html (parseChat, parseWADate,
// getISOWeek, getWeekRange, buildWeekMap). Behaviour-preserving — the only
// changes are environmental (no DOM, no toast, no localStorage).

export const PLATFORMS = {
  youtube: {
    name: 'YouTube',
    patterns: [
      /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s<>"'\])]*/gi,
      /https?:\/\/youtu\.be\/[^\s<>"'\])]*/gi,
      /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[^\s<>"'\])]*/gi,
      /https?:\/\/music\.youtube\.com\/[^\s<>"'\])]*/gi,
    ],
  },
  spotify: {
    name: 'Spotify',
    patterns: [
      /https?:\/\/open\.spotify\.com\/[^\s<>"'\])]*/gi,
      /https?:\/\/spotify\.link\/[^\s<>"'\])]*/gi,
    ],
  },
  applemusic: {
    name: 'Apple Music',
    patterns: [
      /https?:\/\/music\.apple\.com\/[^\s<>"'\])]*/gi,
      /https?:\/\/itunes\.apple\.com\/[^\s<>"'\])]*/gi,
    ],
  },
  bandcamp: {
    name: 'Bandcamp',
    patterns: [
      /https?:\/\/[a-zA-Z0-9-]+\.bandcamp\.com\/[^\s<>"'\])]*/gi,
    ],
  },
};

const MUSIC_DOMAINS = [
  'youtube.com', 'youtu.be', 'spotify.com', 'spotify.link',
  'music.apple.com', 'itunes.apple.com', 'bandcamp.com', 'music.youtube.com',
];

const LINE_RES = [
  /^\[(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}),\s*(\d{1,2}:\d{2}:\d{2}\s*[AP]M|\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}\s*[AP]M|\d{1,2}:\d{2})\]\s*(~?\s*[^:]+?):\s*([\s\S]*)/i,
  /^(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s*[-–]\s*(~?\s*[^:]+?):\s*([\s\S]*)/i,
];

export function parseChat(text) {
  const allLines = text.split('\n');
  const lines = [];
  for (let i = 0; i < allLines.length; i++) {
    const windowEnd = Math.min(i + 3, allLines.length);
    let hasMusic = false;
    for (let j = i; j < windowEnd; j++) {
      if (MUSIC_DOMAINS.some(d => allLines[j].includes(d))) { hasMusic = true; break; }
    }
    if (hasMusic) lines.push(allLines[i]);
  }

  const members = {};
  let totalLinks = 0;
  let currentSender = null, currentDate = '', currentTime = '';
  let messageBuffer = [];

  const processBuffer = () => {
    if (!currentSender || !messageBuffer.length) return;
    const msgText = messageBuffer.join(' ');
    for (const [platform, cfg] of Object.entries(PLATFORMS)) {
      for (const pat of cfg.patterns) {
        const matches = [...msgText.matchAll(new RegExp(pat.source, 'gi'))];
        for (const m of matches) {
          const url = m[0].replace(/[).,;'">\]\[]+$/, '');
          if (!members[currentSender]) {
            members[currentSender] = { youtube: [], spotify: [], applemusic: [], bandcamp: [] };
          }
          const existing = members[currentSender][platform];
          if (!existing.find(e => e.url === url)) {
            existing.push({ url, date: currentDate, time: currentTime, title: null });
            totalLinks++;
          }
        }
      }
    }
    messageBuffer = [];
  };

  for (const line of lines) {
    let matched = false;
    for (const re of LINE_RES) {
      const m = line.match(re);
      if (m) {
        processBuffer();
        currentDate = m[1]; currentTime = m[2];
        currentSender = m[3].trim().replace(/^~\s*/, '').trim();
        const msgBody = m[4] || '';
        const isSystem = (
          line.includes('‎') ||
          /end-to-end encrypted/i.test(msgBody) ||
          /created this group/i.test(msgBody) ||
          /Messages to this group/i.test(msgBody) ||
          currentSender.includes('changed') ||
          currentSender.includes('added') ||
          currentSender.includes('left')
        );
        if (isSystem) { currentSender = null; }
        else { messageBuffer = [msgBody]; }
        matched = true;
        break;
      }
    }
    if (!matched && currentSender) messageBuffer.push(line);
  }
  processBuffer();

  const totalLinks_ = m => m.youtube.length + m.spotify.length + m.applemusic.length + m.bandcamp.length;
  const sorted = {};
  Object.entries(members)
    .sort(([, a], [, b]) => totalLinks_(b) - totalLinks_(a))
    .forEach(([k, v]) => { sorted[k] = v; });

  return { members: sorted, totalLinks };
}

export function parseWADate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split(/[\/\.\-]/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);
  if (year < 100) year += 2000;
  return new Date(year, month, day);
}

export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { week: weekNo, year: d.getUTCFullYear() };
}

export function getWeekRange(isoYear, isoWeek) {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1) + (isoWeek - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { monday, sunday };
}

export function formatDateShort(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateRange(monday, sunday) {
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth();
  const sameYear = monday.getUTCFullYear() === sunday.getUTCFullYear();
  const monthName = d => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  if (sameMonth && sameYear) {
    return `${monday.getUTCDate()}–${sunday.getUTCDate()} ${monthName(monday)} ${monday.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${monday.getUTCDate()} ${monthName(monday)} – ${sunday.getUTCDate()} ${monthName(sunday)} ${monday.getUTCFullYear()}`;
  }
  return `${monday.getUTCDate()} ${monthName(monday)} ${monday.getUTCFullYear()} – ${sunday.getUTCDate()} ${monthName(sunday)} ${sunday.getUTCFullYear()}`;
}

export function buildWeekMap(allData) {
  const weekMap = {};
  for (const [memberName, platformData] of Object.entries(allData)) {
    for (const [platform, tracks] of Object.entries(platformData)) {
      for (const track of tracks) {
        const date = parseWADate(track.date);
        if (!date) continue;
        const { week, year } = getISOWeek(date);
        const key = `${year}-W${String(week).padStart(2, '0')}`;
        if (!weekMap[key]) weekMap[key] = { year, week, tracks: [] };
        weekMap[key].tracks.push({ ...track, platform, sender: memberName, sortDate: date });
      }
    }
  }
  return weekMap;
}

// Returns the most recent week key in the data (e.g. "2026-W18").
export function latestWeekKey(weekMap) {
  const keys = Object.keys(weekMap).sort();
  return keys[keys.length - 1];
}

// Slice one week's worth of *raw chat lines* from the full export.
// Used when building the prompt for Claude.ai — same logic as strip_chat.py.
export function extractWeekText(rawText, weekKey) {
  const allLines = rawText.split('\n');
  const targetMatch = weekKey.match(/(\d{4})-W(\d+)/);
  if (!targetMatch) return '';
  const targetYear = parseInt(targetMatch[1], 10);
  const targetWeek = parseInt(targetMatch[2], 10);
  const out = [];
  let inTargetWeek = false;
  for (const line of allLines) {
    const m = line.match(/^\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+\d{1,2}:\d{2}/);
    if (m) {
      let y = parseInt(m[3], 10); if (y < 100) y += 2000;
      const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      const { week, year } = getISOWeek(d);
      inTargetWeek = (year === targetYear && week === targetWeek);
    }
    if (inTargetWeek) out.push(line);
  }
  return out.join('\n');
}
