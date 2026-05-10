// Ports the two Spotify side-effects of the weekly routine:
//   • updateAllMemberPlaylists  ←  index.html updateAllPlaylists()
//   • createWeeklyDigest        ←  index.html _buildDigestPlaylist()
//
// Member-playlist mapping comes from ~/.vault/member-playlists.json which the
// user populates once via the browser console snippet (see `vault-weekly auth`).

import {
  MEMBER_PLAYLISTS_PATH, STATE_PATH,
  readJsonIfExists, writeJson, sleep, c,
} from './util.js';
import { spotifyFetch, resolveSpotifyUris } from './spotify.js';
import { parseWADate, buildWeekMap, getWeekRange, formatDateShort, latestWeekKey } from './chat.js';

// ── Member playlist mapping ──────────────────────────────────────────────────
// Format on disk:
//   {
//     "Sumit": { "playlistId": "abc...", "updatedAt": "2026-04-01T..." },
//     "Tufan": { "playlistId": "xyz...", "updatedAt": "..." },
//     ...
//   }
//
// We accept either the rich form above or a plain { name: id } map for first
// import, and normalise on read.

export function loadMemberPlaylists() {
  const raw = readJsonIfExists(MEMBER_PLAYLISTS_PATH) || {};
  const out = {};
  for (const [name, val] of Object.entries(raw)) {
    if (typeof val === 'string') {
      out[name] = { playlistId: val, updatedAt: null };
    } else if (val && val.playlistId) {
      out[name] = { playlistId: val.playlistId, updatedAt: val.updatedAt || null };
    }
  }
  return out;
}

export function saveMemberPlaylists(map) {
  writeJson(MEMBER_PLAYLISTS_PATH, map);
}

function setMemberUpdated(map, name, playlistId) {
  map[name] = { playlistId, updatedAt: new Date().toISOString() };
}

// ── Update all member playlists with newly shared Spotify tracks ─────────────

export async function updateAllMemberPlaylists(allData, { onProgress } = {}) {
  const map = loadMemberPlaylists();
  if (!Object.keys(map).length) {
    console.log(c.yellow('  No member playlist mappings found.'));
    console.log(c.dim('  Run: vault-weekly import-playlists  (after pasting the browser snippet output)'));
    return { updated: 0, skipped: 0, failed: 0, missing: 0 };
  }

  const members = Object.keys(allData).filter(m => map[m]);
  const missing = Object.keys(allData).filter(m => !map[m] && (allData[m].spotify || []).length > 0);

  let updated = 0, skipped = 0, failed = 0;

  for (let i = 0; i < members.length; i++) {
    const name = members[i];
    const rec = map[name];
    if (onProgress) onProgress(i + 1, members.length, name);

    const data = allData[name];
    const allSpotify = data.spotify || [];

    // Determine the lookback window. If we have a real updatedAt, use that.
    // For first-run (no updatedAt), the playlist was already populated from
    // the browser app — re-resolving the entire 6-year history would mean
    // tens of thousands of API calls and Spotify will rate-limit hard. So
    // we only look back 14 days and stamp updatedAt = now; subsequent weeks
    // catch new tracks incrementally.
    let sinceDateOnly;
    if (rec.updatedAt) {
      const since = new Date(rec.updatedAt);
      sinceDateOnly = new Date(since.getFullYear(), since.getMonth(), since.getDate());
    } else {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      sinceDateOnly = new Date(fourteenDaysAgo.getFullYear(), fourteenDaysAgo.getMonth(), fourteenDaysAgo.getDate());
    }
    const newTracks = allSpotify.filter(t => {
      const d = parseWADate(t.date);
      return d && d >= sinceDateOnly;
    });

    if (newTracks.length === 0) { skipped++; continue; }

    try {
      const newUris = await resolveSpotifyUris(newTracks.map(t => t.url), null, []);
      if (!newUris.length) { skipped++; continue; }

      const existingUris = new Set();
      let next = `https://api.spotify.com/v1/playlists/${rec.playlistId}/items?limit=100&fields=next,items(track(uri))`;
      while (next) {
        const page = await spotifyFetch(next);
        for (const item of (page?.items || [])) {
          if (item?.track?.uri) existingUris.add(item.track.uri);
        }
        next = page?.next || null;
        if (next) await sleep(150);
      }

      const toAdd = newUris.filter(u => !existingUris.has(u));
      if (!toAdd.length) {
        setMemberUpdated(map, name, rec.playlistId);
        skipped++;
        continue;
      }

      for (let j = 0; j < toAdd.length; j += 100) {
        await spotifyFetch(`https://api.spotify.com/v1/playlists/${rec.playlistId}/items`, {
          method: 'POST',
          body: JSON.stringify({ uris: toAdd.slice(j, j + 100) }),
        });
        await sleep(300);
      }

      setMemberUpdated(map, name, rec.playlistId);
      updated++;
    } catch (e) {
      console.log(c.red(`    ✗ ${name}: ${e.message}`));
      failed++;
    }

    await sleep(300);
  }

  saveMemberPlaylists(map);
  return { updated, skipped, failed, missing: missing.length, missingNames: missing };
}

// ── Create weekly digest Spotify playlist for the most recent ISO week ───────

export async function createWeeklyDigest(allData, { weekKey: explicitKey, onStatus } = {}) {
  const weekMap = buildWeekMap(allData);
  const weekKey = explicitKey || latestWeekKey(weekMap);
  if (!weekKey) throw new Error('No dated music links found in chat data');

  const m = weekKey.match(/(\d{4})-W(\d+)/);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const { monday, sunday } = getWeekRange(year, week);
  const weekLabel = 'W' + week;
  const dateRange = `${formatDateShort(monday)} – ${formatDateShort(sunday)}`;

  const weekData = weekMap[weekKey];
  if (!weekData) throw new Error(`No tracks for ${weekKey}`);

  const spotifyTracks = weekData.tracks.filter(t => t.platform === 'spotify');
  if (!spotifyTracks.length) {
    if (onStatus) onStatus(`No Spotify tracks shared in ${weekLabel}`);
    return { weekKey, weekLabel, dateRange, playlistId: null, playlistUrl: null, trackCount: 0 };
  }

  const playlistName = `The Vault — ${weekLabel} (${dateRange})`;

  if (onStatus) onStatus(`resolving ${spotifyTracks.length} Spotify links…`);
  const skipped = [];
  const uris = await resolveSpotifyUris(spotifyTracks.map(t => t.url), null, skipped);
  if (!uris.length) {
    if (onStatus) onStatus('No valid Spotify track URIs found for this week');
    return { weekKey, weekLabel, dateRange, playlistId: null, playlistUrl: null, trackCount: 0 };
  }

  if (onStatus) onStatus(`creating playlist "${playlistName}" with ${uris.length} tracks…`);
  const pl = await spotifyFetch('https://api.spotify.com/v1/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: playlistName,
      description: `All music shared in The Vault during ${dateRange}`,
      public: true,
    }),
  });

  const BATCH = 100;
  let added = 0;
  for (let i = 0; i < uris.length; i += BATCH) {
    const batch = uris.slice(i, i + BATCH);
    let attempts = 0, success = false;
    while (!success && attempts < 5) {
      try {
        await spotifyFetch(`https://api.spotify.com/v1/playlists/${pl.id}/items`, {
          method: 'POST',
          body: JSON.stringify({ uris: batch }),
        });
        success = true;
      } catch (e) {
        attempts++;
        await sleep(attempts * 2000);
      }
    }
    if (!success) throw new Error(`Failed to add batch at position ${i} after 5 attempts`);
    added += batch.length;
    if (onStatus) onStatus(`added ${added}/${uris.length}`);
    if (i + BATCH < uris.length) await sleep(500);
  }

  try {
    await spotifyFetch(`https://api.spotify.com/v1/playlists/${pl.id}/followers`, {
      method: 'PUT',
      body: JSON.stringify({ public: true }),
    });
  } catch { /* non-fatal */ }

  const playlistUrl = `https://open.spotify.com/playlist/${pl.id}`;

  // Persist the digest URL so the Sanctorum generator can use it without
  // a second round-trip.
  const state = readJsonIfExists(STATE_PATH) || {};
  state.lastDigest = { weekKey, weekLabel, dateRange, playlistId: pl.id, playlistUrl, trackCount: uris.length, createdAt: new Date().toISOString() };
  writeJson(STATE_PATH, state);

  return {
    weekKey, weekLabel, dateRange,
    playlistId: pl.id, playlistUrl,
    trackCount: uris.length,
    sourceLinkCount: spotifyTracks.length,
    skippedCount: skipped.length,
  };
}
