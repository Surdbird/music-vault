// Ports the four "Generate" browser buttons from index.html to Node:
//   generateYTLinksPage      → links-youtube.html
//   generatePlatformLinksPage('applemusic')  → links-apple.html
//   generatePlatformLinksPage('bandcamp')    → links-bandcamp.html
//   generateSanctorum        → links.html
//
// Output HTML is byte-for-byte equivalent to what the browser app produces
// (modulo the live "Updated" date), so the GitHub Pages site looks identical.

import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml as escHtml, REPO_ROOT } from './util.js';
import { parseWADate, getISOWeek, getWeekRange, formatDateShort } from './chat.js';
import { listAllUserPlaylists } from './spotify.js';

function extractYTId(url) {
  try {
    const u = new URL(url);
    if (u.pathname === '/playlist' || u.pathname.endsWith('/playlist/')) return null;
    const id = u.searchParams.get('v') || u.pathname.split('/').pop() || null;
    return (id && /^[A-Za-z0-9_-]{11}$/.test(id)) ? id : null;
  } catch { return null; }
}

function todayLong() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── YouTube links page ───────────────────────────────────────────────────────

export function generateYouTubePage(allData) {
  const members = Object.entries(allData)
    .map(([name, data]) => ({ name, ytTracks: data.youtube || [], ytCount: (data.youtube || []).length }))
    .filter(m => m.ytCount > 0)
    .sort((a, b) => b.ytCount - a.ytCount);

  if (!members.length) throw new Error('No YouTube links found in chat data');

  const rows = members.map((m, rowIdx) => {
    const ids = m.ytTracks.map(t => extractYTId(t.url)).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

    const firstUrl = `https://www.youtube.com/watch_videos?video_ids=${chunks[0].join(',')}`;
    const playBtn = `<a href="${firstUrl}" target="_blank" rel="noopener"
      style="display:inline-block;background:#ff0000;color:white;padding:0.35rem 0.9rem;border-radius:3px;text-decoration:none;font-size:0.85rem;font-weight:600">
      ▶ Play
    </a>`;

    let moreBtn = '';
    if (chunks.length > 1) {
      const moreParts = chunks.slice(1).map((chunk, idx) => {
        const url = `https://www.youtube.com/watch_videos?video_ids=${chunk.join(',')}`;
        return `<a href="${url}" target="_blank" rel="noopener"
          style="display:inline-block;background:#cc0000;color:white;padding:0.3rem 0.7rem;border-radius:3px;text-decoration:none;font-size:0.78rem;font-weight:600;margin-right:0.25rem">
          Part ${idx + 2} <span style="opacity:0.8;font-size:0.85em">${(idx + 1) * 50 + 1}–${(idx + 1) * 50 + chunk.length}</span>
        </a>`;
      }).join('');
      moreBtn = `
        <button onclick="var el=document.getElementById('more-${rowIdx}');el.style.display=el.style.display==='none'?'block':'none';this.textContent=el.style.display==='none'?'+ more':'− less'"
          style="background:none;border:1px solid #ccc;color:#666;padding:0.3rem 0.6rem;border-radius:3px;cursor:pointer;font-size:0.78rem;margin-left:0.4rem">
          + more
        </button>
        <div id="more-${rowIdx}" style="display:none;margin-top:0.4rem">${moreParts}</div>`;
    }

    return `
      <tr>
        <td>${escHtml(m.name)}</td>
        <td style="color:#888">${m.ytCount}</td>
        <td>${playBtn}${moreBtn}</td>
      </tr>`;
  }).join('');

  const now = todayLong();

  // Note: this matches index.html literally — including the title "Artists",
  // the 4-column thead with empty "Shared by", and the inline filter/sort JS.
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>The Vault — Artists</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f5;color:#1a1a1a}header{background:#1a1a1a;color:white;padding:2rem}header h1{font-size:2rem;font-weight:800;letter-spacing:-.02em}header h1 span{color:#c8a84b}header p{color:#999;font-size:.85rem;margin-top:.4rem}.container{max-width:1000px;margin:0 auto;padding:2rem}.search-bar{margin-bottom:1.5rem}.search-bar input{width:100%;max-width:400px;padding:.5rem 1rem;border:1px solid #ddd;border-radius:4px;font-size:.9rem}table{width:100%;border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}th{background:#1a1a1a;color:white;padding:.75rem 1rem;text-align:left;font-size:.78rem;letter-spacing:.05em;text-transform:uppercase}td{padding:.6rem 1rem;border-bottom:1px solid #eee;vertical-align:middle}tr:last-child td{border-bottom:none}tr:hover td{background:#f9f9f9}footer{text-align:center;padding:2rem;color:#999;font-size:.75rem}</style></head><body>'
    + '<header><h1>THE <span>VAULT</span></h1><p>♬ YouTube by Member · Generated ' + now + ' · ' + members.length + ' members</p></header>'
    + '<div class="container"><div class="search-bar" style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem"><input type="search" placeholder="Search artist..." oninput="filterArtists(this.value)" id="artistSearch" style="flex:1;min-width:200px;max-width:400px;padding:.5rem 1rem;border:1px solid #ddd;border-radius:4px;font-size:.9rem"><button onclick="sortArtists(this.dataset.s)" data-s="count" style="background:none;border:1px solid #ccc;padding:.4rem .9rem;border-radius:4px;cursor:pointer;font-size:.8rem" id="sortCount">↓ Most tracks</button><button onclick="sortArtists(this.dataset.s)" data-s="alpha" style="background:none;border:1px solid #ccc;padding:.4rem .9rem;border-radius:4px;cursor:pointer;font-size:.8rem" id="sortAlpha">A–Z</button></div>'
    + '<table id="artistTable"><thead><tr><th>Artist</th><th>Tracks</th><th>Play</th><th>Shared by</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<footer>Generated by The Vault · <a href="https://surdbird.github.io/music-vault/" style="color:#999">Open The Vault</a></footer>'
    + '<script>function filterArtists(q){var rows=document.querySelectorAll("#artistTable tbody tr");q=q.toLowerCase();for(var i=0;i<rows.length;i++)rows[i].style.display=rows[i].cells[0].textContent.toLowerCase().indexOf(q)>=0?"":"none";}function sortArtists(by){var tb=document.querySelector("#artistTable tbody");var rows=Array.from(tb.querySelectorAll("tr"));rows.sort(function(a,b){if(by==="alpha")return a.cells[0].textContent.localeCompare(b.cells[0].textContent);return parseInt(b.cells[1].textContent)-parseInt(a.cells[1].textContent);});rows.forEach(function(r){tb.appendChild(r);});document.getElementById("sortCount").style.background=by==="count"?"#1a1a1a":"";document.getElementById("sortCount").style.color=by==="count"?"white":"";document.getElementById("sortAlpha").style.background=by==="alpha"?"#1a1a1a":"";document.getElementById("sortAlpha").style.color=by==="alpha"?"white":"";}<\/script>'
    + '</body></html>';
}

// ── Apple Music / Bandcamp links page ────────────────────────────────────────

export function generatePlatformPage(platform, allData) {
  const isApple = platform === 'applemusic';
  const platformName = isApple ? 'Apple Music' : 'Bandcamp';
  const platformIcon = isApple ? '♪' : '◈';
  const platformColor = isApple ? '#fc3c44' : '#1da0c3';

  const members = Object.entries(allData)
    .map(([name, data]) => ({ name, tracks: data[platform] || [], count: (data[platform] || []).length }))
    .filter(m => m.count > 0)
    .sort((a, b) => b.count - a.count);

  if (!members.length) throw new Error(`No ${platformName} links found in chat data`);

  const rows = members.map((m, idx) => {
    const links = m.tracks.map(t => t.url);
    const visibleLinks = m.tracks.slice(0, 5).map(t =>
      `<div style="margin:0.2rem 0"><a href="${t.url}" target="_blank" rel="noopener"
        style="color:${platformColor};font-size:0.78rem;word-break:break-all">${t.url.replace(/^https?:\/\//, '').slice(0, 60)}${t.url.length > 63 ? '…' : ''}</a></div>`
    ).join('');

    const hiddenLinks = m.tracks.length > 5 ? m.tracks.slice(5).map(t =>
      `<div style="margin:0.2rem 0"><a href="${t.url}" target="_blank" rel="noopener"
        style="color:${platformColor};font-size:0.78rem;word-break:break-all">${t.url.replace(/^https?:\/\//, '').slice(0, 60)}${t.url.length > 63 ? '…' : ''}</a></div>`
    ).join('') : '';

    const moreSection = m.tracks.length > 5 ? `
      <div id="more-${idx}" style="display:none">${hiddenLinks}</div>
      <button onclick="var el=document.getElementById('more-${idx}');el.style.display=el.style.display==='none'?'block':'none';this.textContent=el.style.display==='none'?'+ ${m.tracks.length - 5} more':'− less'"
        style="background:none;border:none;color:#999;cursor:pointer;font-size:0.78rem;padding:0.2rem 0;margin-top:0.2rem">
        + ${m.tracks.length - 5} more
      </button>` : '';

    return `
      <tr>
        <td style="vertical-align:top;padding-top:1rem">
          <strong>${m.name}</strong>
          <div style="color:#888;font-size:0.78rem">${m.count} link${m.count !== 1 ? 's' : ''}</div>
        </td>
        <td style="vertical-align:top;padding-top:1rem">
          <button onclick="navigator.clipboard.writeText(this.dataset.links).then(()=>this.textContent='✓ Copied!').catch(()=>this.textContent='Failed')" data-links="${links.join('\n').replace(/"/g, '&quot;')}"
            style="background:${platformColor};color:white;border:none;padding:0.35rem 0.9rem;border-radius:3px;cursor:pointer;font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;display:block">
            ⎘ Copy All Links
          </button>
          ${visibleLinks}
          ${moreSection}
        </td>
      </tr>`;
  }).join('');

  const now = todayLong();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Vault — ${platformName} Links</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #1a1a1a; min-height: 100vh; }
  header { background: #1a1a1a; color: white; padding: 2rem 2rem 1.5rem; }
  header h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; }
  header h1 span { color: ${platformColor}; }
  header p { color: #999; font-size: 0.85rem; margin-top: 0.4rem; }
  .container { max-width: 900px; margin: 0 auto; padding: 2rem; }
  .note { background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; padding: 0.75rem 1rem; font-size: 0.85rem; margin-bottom: 1.5rem; color: #666; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  th { background: #1a1a1a; color: white; padding: 0.75rem 1rem; text-align: left; font-size: 0.78rem; letter-spacing: 0.05em; text-transform: uppercase; }
  td { padding: 0.7rem 1rem; border-bottom: 1px solid #eee; font-size: 0.9rem; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  footer { text-align: center; padding: 2rem; color: #999; font-size: 0.75rem; }
</style>
</head>
<body>
<header>
  <h1>THE <span>VAULT</span></h1>
  <p>${platformIcon} ${platformName} Links by Member · Generated ${now} · ${members.length} members</p>
</header>
<div class="container">
  <div class="note">Click "⎘ Copy All Links" to copy a member's links to clipboard, then paste into ${platformName}.</div>
  <table>
    <thead>
      <tr>
        <th>Member</th>
        <th>Links</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>
<footer>Generated by The Vault · <a href="https://surdbird.github.io/music-vault/" style="color:#999">Open The Vault</a></footer>
</body>
</html>`;
}

// ── The Vault Sanctorum (links.html) ─────────────────────────────────────────

// allData    — parsed chat data
// digestInfo — { weekKey, weekLabel, dateRange, playlistUrl, playlistName }
//              from createWeeklyDigest. If null, we look up the most recent
//              "The Vault — W##" playlist from Spotify directly.
export async function generateSanctorum(allData, digestInfo) {
  const base = 'https://surdbird.github.io/music-vault';
  const spotifyProfile = 'https://open.spotify.com/user/sumit.nurpuri';
  const now = todayLong();

  // Curated playlists — same hardcoded URLs as index.html.
  const jazzAlbumsUrl = 'https://open.spotify.com/playlist/7LO6P19aJEQossTlwJYWnh';
  const jazzHighlightsUrl = 'https://open.spotify.com/playlist/33B5CNx0DvOc0WA4EgAbZQ';
  const completeVaultUrl = 'https://open.spotify.com/playlist/1TPwsBGSmdsQOxFB6wqbjw';

  // Determine the latest weekly digest playlist.
  let latestWeeklyName = '';
  let latestWeeklyUrl = spotifyProfile;
  if (digestInfo?.playlistUrl) {
    latestWeeklyName = `The Vault — ${digestInfo.weekLabel} (${digestInfo.dateRange})`;
    latestWeeklyUrl = digestInfo.playlistUrl;
  } else {
    // Fall back to scanning Spotify for the highest W## playlist.
    try {
      const all = await listAllUserPlaylists();
      const vaultWeekly = all
        .filter(p => p.name && /The Vault.*W\d+/i.test(p.name))
        .sort((a, b) => {
          const wa = parseInt(a.name.match(/W(\d+)/)?.[1] || 0, 10);
          const wb = parseInt(b.name.match(/W(\d+)/)?.[1] || 0, 10);
          return wb - wa;
        });
      if (vaultWeekly[0]) {
        latestWeeklyName = vaultWeekly[0].name;
        latestWeeklyUrl = vaultWeekly[0].external_urls?.spotify || spotifyProfile;
      }
    } catch { /* leave defaults */ }
  }

  // Compute current ISO week's YouTube IDs from chat data.
  const nowDate = new Date();
  const { week: currentWeek, year: currentYear } = getISOWeek(nowDate);
  const _weekStart = (() => {
    const d = new Date(nowDate);
    const dow = d.getDay();
    const monOff = (dow === 0 ? -6 : 1 - dow);
    d.setDate(d.getDate() + monOff);
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const weekYTIds = [];
  for (const [, pd] of Object.entries(allData || {})) {
    for (const t of (pd.youtube || [])) {
      if (!t.date) continue;
      const td = parseWADate(t.date);
      if (td && td >= _weekStart && td <= nowDate) {
        const id = extractYTId(t.url);
        if (id && !weekYTIds.includes(id)) weekYTIds.push(id);
      }
    }
  }
  const ytChunks = [];
  for (let i = 0; i < weekYTIds.length; i += 50) ytChunks.push(weekYTIds.slice(i, i + 50));
  const ytCards = weekYTIds.length > 0
    ? ytChunks.map((chunk, i) =>
        '<a class="card" href="https://www.youtube.com/watch_videos?video_ids=' + chunk.join(',') + '" target="_blank" rel="noopener">'
        + '<div class="card-icon">▶</div>'
        + '<div class="card-title">This Week on YouTube' + (ytChunks.length > 1 ? ' · Part ' + (i + 1) : '') + '</div>'
        + '<div class="card-desc">W' + currentWeek + ' · ' + weekYTIds.length + ' videos</div>'
        + '<span class="card-platform yt">YouTube</span>'
        + '</a>').join('')
    : '<div class="card" style="opacity:0.5;cursor:default"><div class="card-icon">▶</div><div class="card-title">This Week on YouTube</div><div class="card-desc">No YouTube links yet this week.</div><span class="card-platform yt">YouTube</span></div>';

  const head = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>The Vault Sanctorum</title>'
    + '<link rel="manifest" href="manifest.json">'
    + '<meta name="apple-mobile-web-app-capable" content="yes">'
    + '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    + '<meta name="apple-mobile-web-app-title" content="The Vault">'
    + '<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">'
    + '<link rel="icon" type="image/png" sizes="32x32" href="favicon.ico">'
    + '<meta name="theme-color" content="#d4845a">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0e0c0a;color:#e8e0d4;min-height:100vh}'
    + 'header{padding:3rem 2rem 2rem;border-bottom:1px solid #2a2420;text-align:center}'
    + 'h1{font-size:clamp(2.5rem,8vw,5rem);font-weight:800;letter-spacing:-0.03em;line-height:1}'
    + 'h1 span{color:#d4845a}'
    + '.sub{color:#6b5f52;font-size:0.85rem;margin-top:0.75rem;letter-spacing:0.1em;text-transform:uppercase}'
    + '.date{color:#6b5f52;font-size:0.75rem;margin-top:0.4rem}'
    + '.container{max-width:900px;margin:0 auto;padding:2rem}'
    + '.section{margin-bottom:3rem}'
    + '.section-title{font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase;color:#6b5f52;margin-bottom:1.25rem;padding-bottom:0.5rem;border-bottom:1px solid #2a2420}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem}'
    + '.card{background:#161310;border:1px solid #2a2420;border-radius:4px;padding:1.25rem;text-decoration:none;color:#e8e0d4;display:block;transition:border-color .15s}'
    + '.card:hover{border-color:#d4845a}'
    + '.card-icon{font-size:1.5rem;margin-bottom:0.75rem}'
    + '.card-title{font-weight:700;font-size:1rem;margin-bottom:0.3rem}'
    + '.card-desc{font-size:0.75rem;color:#6b5f52;line-height:1.5}'
    + '.card-platform{display:inline-block;font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;padding:0.15rem 0.4rem;border-radius:2px;margin-top:0.5rem}'
    + '.yt{background:#1a0f0f;color:#ff4444}'
    + '.sp{background:#0a1a0f;color:#1db954}'
    + '.multi{background:#1a1510;color:#d4845a}'
    + 'footer{text-align:center;padding:2rem;color:#3d3530;font-size:0.72rem;border-top:1px solid #2a2420}'
    + '@media(max-width:600px){.container{padding:1rem}.grid{grid-template-columns:1fr}}'
    + '</style></head><body>'
    + '<header>'
    + '<h1>THE <span>VAULT</span><br>SANCTORUM</h1>'
    + '<p class="sub">A community music archive · 6 years of sharing</p>'
    + '<p class="date">Updated ' + now + '</p>'
    + '</header>'
    + '<div class="container">';

  const weeklySection = '<div class="section">'
    + '<div class="section-title">Weekly Digest</div>'
    + '<div class="grid">'
    + '<a class="card" href="' + latestWeeklyUrl + '" target="_blank" rel="noopener">'
    + '<div class="card-icon">📅</div>'
    + '<div class="card-title">' + (latestWeeklyName || 'Weekly Digest') + '</div>'
    + '<div class="card-desc">' + (latestWeeklyName ? 'The latest weekly digest playlist — all music shared this week in one place.' : 'A new Spotify playlist every week with all the music shared that week.') + '</div>'
    + '<span class="card-platform sp">Spotify</span>'
    + '</a>'
    + ytCards
    + '</div>'
    + '<p style="font-size:0.72rem;color:#3d3530;margin-top:0.75rem">** Spotify digest is created at the end of each week — YouTube shows the current week live.</p>'
    + '</div>';

  const dispatchesSection = '<div class="section">'
    + '<div class="section-title">Weekly Dispatches</div>'
    + '<div class="grid">'
    + '<a class="card" href="' + base + '/links-summaries.html">'
    + '<div class="card-icon">✦</div>'
    + '<div class="card-title">Weekly Dispatches</div>'
    + '<div class="card-desc">Six years of music, narrated in borrowed voices. Hunter S. Thompson, García Márquez, Ginsberg, DFW and more.</div>'
    + '<span class="card-platform multi">Archive</span>'
    + '</a>'
    + '</div></div>';

  const staticSections = ''
    + '<div class="section">'
    + '<div class="section-title">By Member</div>'
    + '<div class="grid">'
    + '<a class="card" href="' + base + '/links-youtube.html">'
    + '<div class="card-icon">▶</div>'
    + '<div class="card-title">YouTube Playlists</div>'
    + '<div class="card-desc">Every member\'s YouTube shares as a playlist. First 50 videos per member, with more parts available.</div>'
    + '<span class="card-platform yt">YouTube</span>'
    + '</a>'
    + '<a class="card" href="' + spotifyProfile + '" target="_blank" rel="noopener">'
    + '<div class="card-icon">◎</div>'
    + '<div class="card-title">Spotify Playlists</div>'
    + '<div class="card-desc">Individual Spotify playlists for each member. Follow to get updates as new music is added.</div>'
    + '<span class="card-platform sp">Spotify</span>'
    + '</a>'
    + '<a class="card" href="' + base + '/links-apple.html">'
    + '<div class="card-icon">♪</div>'
    + '<div class="card-title">Apple Music Links</div>'
    + '<div class="card-desc">Copy any member\'s Apple Music links to your clipboard.</div>'
    + '<span class="card-platform" style="background:#1a0a0f;color:#fc3c44">Apple Music</span>'
    + '</a>'
    + '<a class="card" href="' + base + '/links-bandcamp.html">'
    + '<div class="card-icon">◈</div>'
    + '<div class="card-title">Bandcamp Links</div>'
    + '<div class="card-desc">Copy any member\'s Bandcamp links to your clipboard.</div>'
    + '<span class="card-platform" style="background:#0a131a;color:#1da0c3">Bandcamp</span>'
    + '</a>'
    + '</div></div>'
    + '<div class="section">'
    + '<div class="section-title">By Artist</div>'
    + '<div class="grid">'
    + '<a class="card" href="' + base + '/links-artists.html">'
    + '<div class="card-icon">♬</div>'
    + '<div class="card-title">Artist Playlists</div>'
    + '<div class="card-desc">945+ artists — search and play YouTube playlists by artist. Sorted by most shared.</div>'
    + '<span class="card-platform yt">YouTube</span>'
    + '</a>'
    + '<a class="card" href="' + base + '/links-spotify-artists.html">'
    + '<div class="card-icon">◎</div>'
    + '<div class="card-title">Artist Playlists on Spotify</div>'
    + '<div class="card-desc">Spotify playlists curated by artist — search and listen directly.</div>'
    + '<span class="card-platform sp">Spotify</span>'
    + '</a>'
    + '</div></div>'
    + '<div class="section">'
    + '<div class="section-title">By Genre</div>'
    + '<div class="grid">'
    + '<a class="card" href="' + base + '/links-genres.html">'
    + '<div class="card-icon">◉</div>'
    + '<div class="card-title">Genre Playlists</div>'
    + '<div class="card-desc">Jazz, Rock, Blues, Folk and more — YouTube playlists curated by genre across all members.*</div>'
    + '<span class="card-platform multi">YouTube · MusicBrainz</span>'
    + '</a>'
    + '<a class="card" href="' + completeVaultUrl + '" target="_blank" rel="noopener">'
    + '<div class="card-icon">◎</div>'
    + '<div class="card-title">The Vault — Complete</div>'
    + '<div class="card-desc">Every Spotify track ever shared in The Vault — 6500+ tracks, 546+ hours.</div>'
    + '<span class="card-platform sp">Spotify</span>'
    + '</a>'
    + '</div></div>'
    + '<div class="section">'
    + '<div class="section-title">Curated Playlists</div>'
    + '<div class="grid">'
    + '<a class="card" href="' + jazzAlbumsUrl + '" target="_blank" rel="noopener">'
    + '<div class="card-icon">♪</div>'
    + '<div class="card-title">No Excuse for Jazz — Full Albums</div>'
    + '<div class="card-desc">50 gateway jazz albums, up to 60 min each. ~417 tracks. Via headphonesty.com</div>'
    + '<span class="card-platform sp">Spotify</span>'
    + '</a>'
    + '<a class="card" href="' + jazzHighlightsUrl + '" target="_blank" rel="noopener">'
    + '<div class="card-icon">♪</div>'
    + '<div class="card-title">No Excuse for Jazz — Highlights</div>'
    + '<div class="card-desc">One gateway track from each of 50 essential jazz albums.</div>'
    + '<span class="card-platform sp">Spotify</span>'
    + '</a>'
    + '</div></div>';

  const tail = '</div>'
    + '<footer>* Genre playlists are approximate — YouTube videos shown are from members who share that genre, not exclusively that genre.<br><br>'
    + 'Built with ♥ by Sumit &amp; Claude · <a href="' + base + '/" style="color:#3d3530">Open The Vault</a></footer>'
    + '</body></html>';

  return head + weeklySection + dispatchesSection + staticSections + tail;
}

// ── Convenience: write all four files into the repo ──────────────────────────

export async function generateAndWriteAll(allData, digestInfo) {
  const written = [];
  const writeOne = (name, html) => {
    const p = path.join(REPO_ROOT, name);
    fs.writeFileSync(p, html);
    written.push({ file: name, bytes: Buffer.byteLength(html) });
  };

  writeOne('links-youtube.html', generateYouTubePage(allData));
  writeOne('links-apple.html', generatePlatformPage('applemusic', allData));
  writeOne('links-bandcamp.html', generatePlatformPage('bandcamp', allData));
  const sanctorum = await generateSanctorum(allData, digestInfo);
  writeOne('links.html', sanctorum);

  return written;
}
