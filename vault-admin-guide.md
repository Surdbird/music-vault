# The Vault — Weekly Admin Guide

## Overview

The Vault is a music archive for the Music Only WhatsApp group. Every week you export the chat, update playlists, and upload a few HTML files to GitHub. Takes about 20-25 minutes.

---

## Prerequisites

- The Vault app: https://surdbird.github.io/music-vault/
- GitHub repo: github.com/Surdbird/music-vault
- Spotify connected (sumit.nurpuri)
- Chrome browser (not Safari)

---

## Weekly Routine

### Step 1 — Export WhatsApp Chat
1. Open WhatsApp → Music Only group
2. Tap group name → **Export Chat** → Without Media
3. Send the .txt file to your Mac (AirDrop or email)

### Step 2 — Load into The Vault
1. Go to https://surdbird.github.io/music-vault/
2. Drop the .txt file onto the drop zone (or paste into the text area)
3. Click **BUILD PLAYLISTS**
4. Wait for all 125 members to load

### Step 3 — Update Member Spotify Playlists
1. Make sure Spotify is connected (green ✓ in the toolbar)
2. Click **↑ Update All Member Playlists** in the generate buttons row
3. Wait for it to complete — the button shows progress (e.g. `↑ 14/89 — Ravi`)
4. A toast at the end confirms how many were updated vs skipped

> Members with no playlist yet still need to be created individually: click their name → **◎ Spotify Playlist**.

### Step 4 — Create Weekly Digest Playlist
1. Click **DIGESTS** in the toolbar
2. Find the current week (e.g. W12) at the top
3. Click **SP +** to create the weekly Spotify playlist
4. Wait for it to complete — playlist appears on your Spotify profile

### Step 5 — Generate Weekly Chat Summary
1. Open Terminal and run:
   ```bash
   cd ~/Downloads
   python3 strip_chat.py "_chat 5.txt"
   ```
2. Pick the current week from the menu (or press Enter for most recent)
3. It saves a small file e.g. `week_2026-W13.txt` in Downloads
4. Open that file, Select All, Copy
5. Come back to **this Claude.ai conversation** (bookmark it!)
6. Paste the text and say: **"give me a weekly chat summary [style] style"**
   - Styles: warm community recap, Bob Dylan Radio Hour, BBC Radio 6, Rolling Stone, Hunter S. Thompson, plain text
7. Copy the summary and paste into the WhatsApp group

> Note: Runs on your Max plan — no API key needed. The strip_chat.py script extracts just one week so the paste is small enough for Claude to handle.

### Step 6 — Regenerate HTML Pages
Click each button below the stats and save the downloaded files:
1. **▶ Generate YouTube Links Page** → saves `links-youtube.html`
2. **♪ Generate Apple Music Links Page** → saves `links-apple.html`
3. **◈ Generate Bandcamp Links Page** → saves `links-bandcamp.html`
4. **✦ Generate The Vault Sanctorum** → saves `links.html`

### Step 7 — Upload to GitHub
1. Go to github.com/Surdbird/music-vault
2. Click **Add file → Upload files**
3. Upload all four files: `links-youtube.html`, `links-apple.html`, `links-bandcamp.html`, `links.html`
4. Commit — GitHub Pages updates in ~2 minutes

---

## One-Time or Occasional Tasks

### Creating Artist Spotify Playlists
1. Click **ARTISTS** in the toolbar
2. Find an artist (search works)
3. Click **SP +** on their card
4. After creating several: click **◎ Generate Spotify by Artist Page** → upload `links-spotify-artists.html` to GitHub

### Genre Fetch (runs automatically, takes ~2 hours)
- Click **GENRES** → data loads from cache instantly
- If cache is empty, let it run overnight — don't close the tab

### Updating The Vault Sanctorum with new weekly playlist
- The Sanctorum auto-detects the latest weekly playlist when generated
- Just regenerate `links.html` each week

### Credits Tool — Producer/Label/Songwriter Playlists
URL: https://surdbird.github.io/music-vault/producer-tool.html
1. Enter Discogs token (saved automatically)
2. Connect Spotify
3. Type producer/songwriter/label name, select role
4. Click **Fetch Credits** → creates Spotify playlist automatically

### Genre Cache Transfer (Dev → Prod)
```javascript
// In dev console:
copy(localStorage.getItem('vault_artist_genres'))
// In prod console:
localStorage.setItem('vault_artist_genres', '<paste>')
```

---

## The Vault Sanctorum — Links to Share

Pin this one URL to the WhatsApp group:
**https://surdbird.github.io/music-vault/links.html**

Direct links:
- YouTube by member: https://surdbird.github.io/music-vault/links-youtube.html
- YouTube by artist: https://surdbird.github.io/music-vault/links-artists.html
- YouTube by genre: https://surdbird.github.io/music-vault/links-genres.html
- Apple Music: https://surdbird.github.io/music-vault/links-apple.html
- Bandcamp: https://surdbird.github.io/music-vault/links-bandcamp.html
- Spotify by member: https://open.spotify.com/user/sumit.nurpuri
- Spotify complete: https://open.spotify.com/playlist/1TPwsBGSmdsQOxFB6wqbjw

---

## Important Notes

- **Never click "Clear cached data"** — it wipes the genre cache (76 min to rebuild)
- **Don't close the tab** while genre fetch or playlist creation is running
- **Keep Mac awake** during long operations (System Settings → Battery → Never sleep)
- **Chrome only** — Safari has caching issues with this app
- Genre playlists are approximate — YouTube videos are from genre-associated members, not exclusively that genre

---

## Troubleshooting

**Chat won't load:** Try Cmd+Shift+R hard reload, then upload again

**Spotify 403 error:** Click "✕ Disconnect & reconnect" in the modal and reconnect

**Rate limited (429):** Wait 2-3 minutes then retry

**Genre view empty:** Run in console: `genreFetchDone=false;genreData={};loadGenreView()`

**Update Playlist says "no new tracks":** The date comparison may have an issue — check that your chat export includes recent dates
