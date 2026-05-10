# The Vault — Weekly Admin (Claude Code edition)

This is the single-command alternative to the manual browser-based weekly admin
described in `vault-admin-guide.md`. After a one-time setup, you run one command
each Sunday and answer one or two prompts. Everything else is automated:
parsing the WhatsApp chat, updating member Spotify playlists, creating the
weekly digest, generating all four HTML pages, capturing the chat summary from
Claude.ai, inserting it into `links-summaries.html`, and committing and pushing
to GitHub.

The original browser-based process still works. Use it if anything in this
flow breaks and you need to ship that night — see "Falling back to manual"
at the bottom.

---

## Where everything lives

| Path | What it is |
|------|-----------|
| `~/code/music-vault/` | Local clone of the GitHub repo |
| `~/code/music-vault/scripts/vault-weekly.js` | The CLI entrypoint |
| `~/code/music-vault/scripts/lib/` | Module code (chat parser, Spotify, generators, summary, git) |
| `~/.vault/tokens.json` | Spotify access + refresh tokens |
| `~/.vault/client.json` | Spotify app client_id |
| `~/.vault/member-playlists.json` | Member name → playlist id mapping |
| `~/.vault/state.json` | Last digest playlist info (used by Sanctorum generator) |

Nothing in `~/.vault/` is in the repo. Don't share it — `tokens.json` contains
your Spotify refresh token.

---

## Prerequisites

- **macOS.** The script is macOS-only (uses `pbcopy`/`pbpaste` and `open`).
- **Node.js 18+.** `node --version` to check.
- **Chrome.** Required for the browser-snippet step during one-time setup.
- **A WhatsApp export from your phone.** Mac WhatsApp's export silently
  truncates. Always export from your iPhone — see the note in Step 1 of the
  weekly routine below.

---

## One-time setup (do once, ~5 minutes)

### Step A — Register the redirect URI on your Spotify app

1. Go to https://developer.spotify.com/dashboard.
2. Open your "Music Only" app (client id `05d1e6e31ccf465a84de32fe886550fe`).
3. **Edit Settings** → **Redirect URIs** → add:
   ```
   http://127.0.0.1:8888/callback
   ```
4. Save.

> Spotify is strict about exact match. No trailing slash, no `localhost`
> instead of `127.0.0.1`, no `https`.

### Step B — Add yourself to the app's User Management list

If your app is in Development Mode (no Extended Quota), Spotify requires you
to explicitly add your own account. As of late 2024, owning the app no longer
implicitly grants access.

1. dashboard.spotify.com → your app → **User Management** → **Add User**.
2. Enter your Spotify display name and the **email registered to your Spotify
   account** (check it at spotify.com → Account → Account overview if unsure).
3. Save.

> If you skip this and authorization fails with `error=server_error`, this is
> the cause. Sometimes the auth call also flakes and works on retry — give it
> one retry before assuming it's the user-list issue.

### Step C — Run the Spotify auth flow

```
node ~/code/music-vault/scripts/vault-weekly.js auth
```

What happens:
1. The script prints the redirect URI it expects (sanity check).
2. It opens Spotify's authorization page in your browser.
3. You click **Agree**.
4. Spotify redirects to `http://127.0.0.1:8888/callback`. The script's tiny
   local server catches it.
5. Browser shows a "✓ Connected" page.
6. Terminal shows `✓ Tokens saved to ~/.vault/tokens.json` and `✓ Connected
   as <name>`.

The captured **refresh token** is what makes future runs unattended. It
doesn't expire unless you revoke the app on your Spotify account.

### Step D — Export the member-playlists mapping from the browser

The browser app stores per-member Spotify playlist IDs in `localStorage`. We
need to copy that map to disk one time.

1. Run:
   ```
   node ~/code/music-vault/scripts/vault-weekly.js snippet
   ```
   This copies a small JS snippet to your clipboard and prints it.
2. Open https://surdbird.github.io/music-vault/ in Chrome.
3. DevTools → Console (⌘⌥J).
4. Paste (⌘V), Enter. The console prints `✓ Copied member-playlists JSON to
   clipboard`. Your clipboard now has the JSON, not the snippet.
5. **Don't copy anything else.** Switch to terminal and run:
   ```
   node ~/code/music-vault/scripts/vault-weekly.js import-playlists --from-clipboard
   ```
6. Confirm: `✓ Saved to ~/.vault/member-playlists.json — N new/changed`.

> **Clipboard trap:** the order is one-way. Snippet command copies the
> snippet → console paste runs the snippet, replacing the clipboard with
> JSON → terminal `--from-clipboard` reads it. Re-running the snippet command
> at any point overwrites the JSON with the snippet again. If you mess this
> up, just redo from step 1.

### Step E (optional) — Make `vault-weekly` a one-word command

```
cd ~/code/music-vault/scripts && npm link
```

Then `vault-weekly` works from anywhere. The rest of this guide assumes
you're typing the long form for clarity.

### Step F (optional but worth doing) — Set git author

If you saw `Your name and email address were configured automatically based
on your username and hostname` after a commit, fix it once:

```
git config --global user.name "Sumit Nurpuri"
git config --global user.email "sumit.nurpuri@gmail.com"
```

Otherwise commits show as `sumitnurpuri@Sumits-MacBook-Pro.local`.

---

## The weekly routine

Sunday evening, ~5 minutes plus the time it takes Claude.ai to write the
summary.

### Step 1 — Export the WhatsApp chat from your phone

1. **iPhone, not Mac.** Mac WhatsApp only mirrors recent messages and silently
   truncates the export to a few months. Always export from the phone.
2. Open WhatsApp on iPhone → **Music Only** group → tap the group name at the
   top → scroll all the way down → **Export Chat** → **Without Media**.
3. **Wait.** A 14MB chat takes 30–60s to prepare before the share sheet
   appears. Don't tap or close anything.
4. Share sheet → **AirDrop** to your Mac.
5. The file lands in `~/Downloads/_chat N.txt`.
6. Sanity check: `ls -lh ~/Downloads/_chat*.txt | tail -3`. The newest should
   be ~13–15MB. If it's much smaller, see "Truncated export" in
   Troubleshooting.

### Step 2 — Run the weekly script

```
node ~/code/music-vault/scripts/vault-weekly.js
```

(or just `vault-weekly` if you ran `npm link`.)

It walks 7 steps, pausing only where it needs you:

1. **Locate WhatsApp chat export.** Auto-detects the largest recent file in
   `~/Downloads`. Press Enter to accept the default, or pick a number.
   Files smaller than 5MB show `(small — may be partial)` — usually you
   ignore those.

2. **Parse chat.** No prompt. You'll see a count like `123 members · 24,237
   total links` (with sub-totals by platform) and `Most recent week: W19
   (4–10 May 2026) — N links`. Sanity-check the totals against last week's.

3. **Update all member Spotify playlists.** Iterates 38ish members, adding
   any tracks they shared since `updatedAt` in `member-playlists.json`. For
   the very first run, lookback is capped at 14 days to avoid hammering
   Spotify; subsequent weeks track incrementally. If anything fails it
   continues to the next member; failures retry next week. Expect a few
   minutes.

4. **Create the weekly digest playlist.** One Spotify playlist named
   `The Vault — W## (DD Mon YYYY – DD Mon YYYY)`, all of this week's Spotify
   tracks. The URL is saved to `~/.vault/state.json` for step 5.

5. **Generate HTML pages.** Writes four files into the repo: `links-youtube.html`,
   `links-apple.html`, `links-bandcamp.html`, `links.html`. Pure local
   work, no Spotify calls.

6. **Weekly chat summary (Claude.ai).** Prints up to three suggested voices
   based on themes the script detects (e.g. "39 late-night posts → Ginsberg",
   "5 mentions of loss → Cohen"). Type any voice — confirmed list, free-form,
   or one of the suggestions. Then:
   - The script copies a long prompt to your clipboard.
   - Opens Claude.ai in a new tab.
   - You paste (⌘V), send, copy the response.
   - Back to terminal: paste the response, then type `__END__` on its own
     line and Enter (or press Ctrl-D).
   - The script parses out title/coda/dateline and inserts a fresh
     `<div class="week-block">` into `links-summaries.html`.

   **If your terminal can't take a long paste**, see "Terminal paste limit"
   in Troubleshooting — there's a `--summary-from <file>` flag.

7. **Commit and push to GitHub.** Shows the diff, asks for confirmation,
   creates a commit `Weekly admin: W## (DD Mon YYYY) — <voice>`, and pushes
   to `main`. GitHub Pages updates in ~2 minutes.

At the very end, the summary text is on your clipboard. **Paste it into the
WhatsApp Music Only group.**

### Step 3 — Verify the live site

After ~2 minutes:
- https://surdbird.github.io/music-vault/links-summaries.html — your new
  W## dispatch should be at the top.
- https://surdbird.github.io/music-vault/links.html — Weekly Digest section
  should show the new W## Spotify playlist + this week's YouTube videos.

If the Sanctorum still shows last week, **hard-refresh** with **Cmd+Shift+R**
(plain Cmd+R isn't enough — it doesn't bypass the cache). If still stale,
try Incognito. If still stale, wait another 2–3 min — GitHub Pages CDN can
take longer to propagate.

---

## Flags reference

For partial re-runs and troubleshooting:

| Flag | Effect |
|------|--------|
| `--dry-run` | Do everything except Spotify writes, file writes, and push |
| `--skip-spotify` | Skip both member-playlist update and weekly digest |
| `--skip-update` | Skip member-playlist update only |
| `--skip-digest` | Skip weekly digest only (Sanctorum reads URL from `state.json`) |
| `--skip-generate` | Skip HTML generation |
| `--skip-summary` | Skip the Claude.ai summary step |
| `--skip-push` | Commit but don't push |
| `--chat <path>` | Use this chat export instead of auto-detecting |
| `--summary-from <path>` | Read summary text from a file (use when terminal paste truncates) |
| `--voice <name>` | Skip the voice prompt and use this voice |

Subcommands:

| Subcommand | What it does |
|------------|--------------|
| `auth` | One-time Spotify OAuth (PKCE + refresh token) |
| `snippet` | Print + copy the browser-console snippet |
| `import-playlists` | Read JSON (paste or `--from-clipboard`) → `member-playlists.json` |
| `help` | Print usage |

---

## Troubleshooting

### Truncated WhatsApp export

If `_chat 13.txt` is ~1MB instead of ~14MB:
1. **Force-quit WhatsApp** on your phone (swipe up + flick away). Reopen.
2. Try the export again. Wait the full 30–60s for the share sheet.
3. Check phone storage: **Settings → General → iPhone Storage**. WhatsApp
   needs free space to write the export. Under ~500MB free can break it.
4. As a fallback: **Save to Files → On My iPhone**, sync via iCloud Drive,
   or email it to yourself.
5. Never use Mac WhatsApp's export — it's always truncated.

### Spotify rate-limited me hard

Symptom: `Rate limited — waiting 86225s…` (or any number much larger than 90s).

1. Ctrl-C immediately.
2. Wait 30–60 minutes for Spotify's rate-limit window to decay.
3. Re-run with `--skip-update`. The member-playlist step is the heaviest;
   skipping it lets the rest of the routine finish. Next week's run will
   pick up incrementally.

> The script caps any single rate-limit wait at 90s and aborts beyond that
> rather than sleeping for hours. The first-run lookback is also capped at
> 14 days so it doesn't try to re-resolve the entire 6-year history.

### Terminal paste limit (truncated long pastes)

macOS Terminal.app silently caps the size of a single paste. Long literary
summaries (4–8K chars) can get cut off mid-word. The script may hang waiting
for input that's not coming, or accept a half-summary and produce a broken
dispatch.

Workaround:
1. Ctrl-C the script (or `pkill -f vault-weekly` from another window if it's
   really stuck).
2. In Claude.ai, click the **Copy** button on the response.
3. **Don't copy anything else.** In terminal:
   ```
   pbpaste > /tmp/summary.txt && wc -c /tmp/summary.txt
   ```
   Should be a few thousand chars. If it's tiny, your clipboard was
   overwritten — try again from step 2.
4. Re-run with the file:
   ```
   node ~/code/music-vault/scripts/vault-weekly.js \
     --skip-update --skip-digest \
     --summary-from /tmp/summary.txt --voice "<the voice you picked>"
   ```
   `--skip-digest` reuses the W## URL from `~/.vault/state.json` (assuming
   step 4 already ran), so the second attempt doesn't create a duplicate
   Spotify playlist.

> Long-term fix: switch to iTerm2, which doesn't have this limit.

### Clipboard race during one-time setup

The snippet → import flow only works in one direction:
- `vault-weekly snippet` puts the snippet on your clipboard
- Pasting it into Chrome's console replaces the clipboard with the JSON
- `import-playlists --from-clipboard` reads the JSON

Any extra copy step (e.g. copying a terminal command, copying an unrelated
piece of text) clobbers the clipboard. If the JSON is gone:
- Snippet is still on the clipboard if you ran `snippet` recently — try
  pasting into the console again to refresh the JSON.
- Otherwise, run `vault-weekly snippet` again and start over.

### Stuck terminal during summary paste

If the terminal freezes mid-paste and won't accept Enter or Ctrl-C:
1. Open a new terminal window.
2. `pkill -f vault-weekly` to kill the stuck node process.
3. The original window unfreezes (or close it).
4. Use the file-based workaround (`--summary-from /tmp/summary.txt`) above.

### Sanctorum stuck on last week's W##

If `links-summaries.html` updates but `links.html` (the Sanctorum) still
shows last week:
1. Hard-refresh with **Cmd+Shift+R**.
2. Try Incognito (bypasses cache entirely).
3. Wait 2–3 minutes for GitHub Pages CDN.
4. Verify the committed file is correct:
   ```
   cd ~/code/music-vault && git show HEAD:links.html | grep -o 'W1[89][^"<]*' | head -3
   ```
   Should show the current week. If it shows last week's, the file wasn't
   in the commit — typically a glob mismatch. Stage `links.html` explicitly
   and re-commit:
   ```
   git add links.html && git commit -m "Sanctorum fix" && git push
   ```

> **Glob trap:** `links-*.html` matches `links-apple.html` etc. but **not**
> `links.html` (no dash). The auto-commit in the script uses explicit file
> names and isn't affected, but a hand-written glob can drop the Sanctorum.

### Authorization fails with `server_error`

Spotify's auth endpoint refused the request.
1. Retry once — sometimes Spotify just flakes.
2. If still failing, confirm Step B above (your account is in the app's
   User Management list).
3. Confirm Step A (redirect URI is exactly `http://127.0.0.1:8888/callback`,
   no trailing slash).

### Some members "have Spotify links but no mapped playlist"

Means the browser-snippet export missed them, usually because their playlist
was created after that snapshot. Either:
- Create their Spotify playlist via the browser app (member tab → SP +),
  then re-run `vault-weekly snippet` + `import-playlists --from-clipboard`
  to pick it up.
- Or ignore — their tracks just don't get added until next week.

---

## State files (what to back up)

If you wipe `~/.vault/`, the script needs:
- `tokens.json` — re-create via `vault-weekly auth`. Trivial.
- `member-playlists.json` — re-create via Step D (snippet + import). Easy
  but you'll lose the per-member `updatedAt` timestamps, so first run after
  wipe will re-scan 14 days of history per member.
- `state.json` — only used to skip a freshly-created digest. Lose-able.
- `client.json` — defaults to the hardcoded client id. Lose-able.

Worth keeping a backup of `member-playlists.json` (one snapshot is enough —
you only add to it).

---

## Falling back to manual

If anything in this flow breaks and you need to ship the weekly admin
tonight, the original browser-based process is fully intact:

1. Open https://surdbird.github.io/music-vault/.
2. Follow `vault-admin-guide.md` step by step.
3. Each step ends with a downloaded HTML file you upload to GitHub via the
   web UI.

The two flows are independent — using the manual flow once doesn't break
the Claude Code flow next week. The script reads its own state from
`~/.vault/`, not from the repo.

---

## Updating the script

The `scripts/` directory in the repo is currently untracked. To update or
share the tooling, commit it as a separate PR:

```
cd ~/code/music-vault
git add scripts/
git commit -m "Add vault-weekly admin tooling"
git push
```

If you make changes to `scripts/` between weekly runs, no special action —
the next `vault-weekly` invocation picks up the latest code automatically.
