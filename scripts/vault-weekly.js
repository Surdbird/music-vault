#!/usr/bin/env node
// vault-weekly — single-command weekly admin for The Vault.
//
//   vault-weekly                   run the full weekly routine
//   vault-weekly auth              one-time Spotify OAuth (PKCE + refresh token)
//   vault-weekly import-playlists  paste browser-snippet output → member-playlists.json
//   vault-weekly snippet           print the browser-console snippet to copy
//   vault-weekly --dry-run         do everything except create Spotify playlists,
//                                  write files, or git push
//   vault-weekly --skip-spotify    skip Spotify steps (still parse + generate HTML)
//   vault-weekly --skip-summary    skip the chat-summary step
//   vault-weekly --skip-push       run everything but don't push to GitHub
//   vault-weekly --chat <path>     specify chat export explicitly

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ensureStateDir, MEMBER_PLAYLISTS_PATH, STATE_PATH,
  ask, confirm, closeRl, pbcopy, c, step, readJsonIfExists, readMultiline,
} from './lib/util.js';
import { runAuthFlow } from './lib/spotify.js';
import { parseChat, buildWeekMap, latestWeekKey, getWeekRange, formatDateRange } from './lib/chat.js';
import {
  loadMemberPlaylists, saveMemberPlaylists,
  updateAllMemberPlaylists, createWeeklyDigest,
} from './lib/playlists.js';
import { generateAndWriteAll } from './lib/generators.js';
import { runSummaryStep } from './lib/summary.js';
import { statusShort, commitAndPush } from './lib/git.js';

// ── arg parsing ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
// Flags that take a following value — exclude that value from positionals
// so it isn't misread as a subcommand.
const VALUE_FLAGS = new Set(['--chat', '--summary-from', '--voice']);
const flags = new Set();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    flags.add(a);
    if (VALUE_FLAGS.has(a)) i++; // skip its value
  } else {
    positional.push(a);
  }
}
const subcommand = positional[0];

function getOpt(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

const DRY_RUN = flags.has('--dry-run');
const SKIP_SPOTIFY = flags.has('--skip-spotify');
const SKIP_SUMMARY = flags.has('--skip-summary');
const SKIP_PUSH = flags.has('--skip-push');
const SKIP_GENERATE = flags.has('--skip-generate');
const SKIP_UPDATE = flags.has('--skip-update');
const SKIP_DIGEST = flags.has('--skip-digest');
const explicitChat = getOpt('--chat');
const summaryFromFile = getOpt('--summary-from');
const voiceOverride = getOpt('--voice');

// ── helpers ──────────────────────────────────────────────────────────────────

// WhatsApp's "Export Chat" always exports the full history — for the Music
// Only group that's ~13–15M. A small file in ~/Downloads (≪10M) is almost
// certainly a partial or unrelated export, so we prefer the largest file
// within the last 30 days. If there are multiple plausible candidates we
// show a small menu rather than guessing silently.
function findChatExportCandidates() {
  const downloads = path.join(os.homedir(), 'Downloads');
  const RECENT_MS = 30 * 24 * 3600 * 1000;
  const now = Date.now();
  return fs.readdirSync(downloads)
    .filter(n => /^_chat( \d+)?\.txt$/.test(n))
    .map(n => {
      const full = path.join(downloads, n);
      const st = fs.statSync(full);
      return { name: n, full, mtime: st.mtime.getTime(), size: st.size };
    })
    .filter(e => (now - e.mtime) < RECENT_MS)
    .sort((a, b) => b.size - a.size); // largest first
}

function fmtMtime(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function pickChatExport() {
  const all = findChatExportCandidates();
  if (!all.length) return null;

  // Show up to 6 most-recent files (newest first), but pre-select the
  // largest as the default — that's almost always the right one because
  // WhatsApp's "Export Chat" produces the full history each time. Small
  // files (< 5M) get a warning marker; the user can still pick them.
  const byMtime = [...all].sort((a, b) => b.mtime - a.mtime).slice(0, 6);
  const largest = [...byMtime].sort((a, b) => b.size - a.size)[0];
  const defaultIdx = byMtime.indexOf(largest);

  console.log(c.dim('  Recent _chat*.txt exports (newest first):'));
  byMtime.forEach((e, i) => {
    const mb = (e.size / 1024 / 1024).toFixed(1);
    const marker = i === defaultIdx ? c.green('▸') : ' ';
    const sizeWarn = e.size < 5 * 1024 * 1024 ? c.yellow(' (small — may be partial)') : '';
    console.log(`  ${marker} [${i}] ${e.name.padEnd(15)} ${mb.padStart(5)}M  ${fmtMtime(e.mtime)}${sizeWarn}`);
  });
  const ans = await ask(`  Pick a number (Enter for [${defaultIdx}] = ${largest.name}): `);
  if (!ans) return largest;
  const idx = parseInt(ans, 10);
  if (Number.isNaN(idx) || !byMtime[idx]) {
    console.log(c.red('  Invalid choice.'));
    return null;
  }
  return byMtime[idx];
}

const SNIPPET = `// ─── The Vault — member-playlists exporter ───
// Open https://surdbird.github.io/music-vault/ in Chrome, open DevTools
// (Cmd+Opt+I) → Console, paste this whole block, hit Enter. Result is on
// your clipboard — paste into the next prompt of \`vault-weekly\`.
copy(JSON.stringify(Object.fromEntries(
  Object.entries(localStorage)
    .filter(([k]) => k.startsWith('vault_pl_'))
    .map(([k, v]) => {
      let name;
      try { name = decodeURIComponent(escape(atob(k.slice(9)))); }
      catch { name = k.slice(9); }
      let id;
      try { id = JSON.parse(v).playlistId; } catch { id = v; }
      return [name, id];
    })
), null, 2));
console.log('✓ Copied member-playlists JSON to clipboard');`;

// ── subcommands ──────────────────────────────────────────────────────────────

async function cmdAuth() {
  ensureStateDir();
  await runAuthFlow();
  console.log('\n' + c.bold('Next:') + ' if you haven\'t yet, run ' + c.cyan('vault-weekly snippet') + ' to set up the member-playlists mapping.');
}

async function cmdSnippet() {
  console.log('\n' + c.bold('Member-playlists exporter snippet:') + '\n');
  console.log(SNIPPET);
  console.log('\n' + c.dim('Then run:  ') + c.cyan('vault-weekly import-playlists') + c.dim('  and paste the JSON.\n'));
  await pbcopy(SNIPPET);
  console.log(c.green('✓ Snippet copied to clipboard'));
}

async function cmdImportPlaylists() {
  ensureStateDir();
  let raw;
  if (flags.has('--from-clipboard') || flags.has('--clip')) {
    const { spawnSync } = await import('node:child_process');
    raw = spawnSync('pbpaste').stdout.toString().trim();
    console.log(c.dim(`Read ${raw.length} chars from clipboard.`));
  } else {
    console.log(c.dim('Paste the JSON output from the browser snippet, then __END__ on its own line (or Ctrl-D).'));
    console.log(c.dim('(Or re-run with --from-clipboard to read it directly.)\n'));
    raw = (await readMultiline('')).trim();
  }
  if (!raw) { console.log(c.red('No input received.')); return; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    console.log(c.red('Invalid JSON: ' + e.message));
    console.log(c.dim('First 80 chars of input: ' + JSON.stringify(raw.slice(0, 80))));
    return;
  }
  const existing = loadMemberPlaylists();
  let added = 0, kept = 0;
  for (const [name, val] of Object.entries(parsed)) {
    if (!val) continue;
    const id = typeof val === 'string' ? val : val.playlistId;
    if (!id) continue;
    if (existing[name]?.playlistId === id) { kept++; continue; }
    existing[name] = { playlistId: id, updatedAt: existing[name]?.updatedAt || null };
    added++;
  }
  saveMemberPlaylists(existing);
  console.log(c.green(`✓ Saved to ${MEMBER_PLAYLISTS_PATH}`));
  console.log(c.dim(`  ${added} new/changed · ${kept} unchanged · ${Object.keys(existing).length} total`));
}

// ── the main weekly routine ─────────────────────────────────────────────────

async function cmdWeekly() {
  ensureStateDir();
  const STEPS = 7;
  let n = 0;

  // Step 1 — locate chat export
  step(++n, STEPS, 'Locate WhatsApp chat export');
  let chatPath = explicitChat ? explicitChat.replace(/^~/, os.homedir()) : null;
  if (!chatPath) {
    const pick = await pickChatExport();
    if (!pick) {
      console.log(c.red('  No suitable _chat*.txt found in ~/Downloads.'));
      console.log(c.dim('  Export from WhatsApp → Music Only → Export Chat → Without Media → AirDrop to Mac.'));
      return;
    }
    chatPath = pick.full;
    const mb = (pick.size / 1024 / 1024).toFixed(1);
    console.log('  ' + c.cyan(pick.name) + c.dim(`  (${mb}M, modified ${fmtMtime(pick.mtime)})`));
  }
  const rawChatText = fs.readFileSync(chatPath, 'utf8');

  // Step 2 — parse
  step(++n, STEPS, 'Parse chat into member playlists');
  const parsed = parseChat(rawChatText);
  const memberCount = Object.keys(parsed.members).length;
  if (!memberCount) { console.log(c.red('  No music links found in this chat.')); return; }
  const totals = { yt: 0, sp: 0, am: 0, bc: 0 };
  for (const m of Object.values(parsed.members)) {
    totals.yt += m.youtube.length; totals.sp += m.spotify.length;
    totals.am += m.applemusic.length; totals.bc += m.bandcamp.length;
  }
  console.log(`  ${c.bold(memberCount)} members · ${parsed.totalLinks} total links`);
  console.log(c.dim(`    YouTube ${totals.yt} · Spotify ${totals.sp} · Apple ${totals.am} · Bandcamp ${totals.bc}`));

  const weekMap = buildWeekMap(parsed.members);
  const wkKey = latestWeekKey(weekMap);
  if (!wkKey) { console.log(c.red('  No dated tracks — can\'t identify a week.')); return; }
  const wkMatch = wkKey.match(/(\d{4})-W(\d+)/);
  const wkYear = parseInt(wkMatch[1], 10);
  const wkNum = parseInt(wkMatch[2], 10);
  const { monday, sunday } = getWeekRange(wkYear, wkNum);
  const weekLabel = `W${wkNum}`;
  const dateRange = formatDateRange(monday, sunday);
  console.log(c.dim(`  Most recent week: ${weekLabel} (${dateRange}) — ${weekMap[wkKey].tracks.length} links`));

  // Step 3 — update member playlists
  step(++n, STEPS, 'Update all member Spotify playlists');
  if (SKIP_SPOTIFY || SKIP_UPDATE) {
    console.log(c.dim('  (skipped)'));
  } else if (DRY_RUN) {
    const map = loadMemberPlaylists();
    const candidates = Object.keys(parsed.members).filter(m => map[m]);
    console.log(c.dim(`  (dry-run) would scan ${candidates.length} member playlists for new tracks`));
  } else {
    const res = await updateAllMemberPlaylists(parsed.members, {
      onProgress: (i, total, name) => {
        process.stdout.write(`\r  ${c.dim(`[${i}/${total}]`)} ${name}                              `);
      },
    });
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
    console.log(`  ${c.green('✓')} ${res.updated} updated · ${res.skipped} skipped · ${res.failed} failed`);
    if (res.missing > 0) {
      console.log(c.yellow(`  ${res.missing} member${res.missing === 1 ? '' : 's'} have Spotify links but no mapped playlist:`));
      console.log(c.dim('    ' + res.missingNames.slice(0, 8).join(', ') + (res.missingNames.length > 8 ? '…' : '')));
      console.log(c.dim('    Create their playlist in the browser app, then re-run snippet+import-playlists.'));
    }
  }

  // Step 4 — weekly digest
  step(++n, STEPS, `Create weekly digest playlist (${weekLabel})`);
  let digestInfo = null;
  if (SKIP_SPOTIFY || SKIP_DIGEST) {
    console.log(c.dim('  (skipped)'));
    // Still try to load any previous digest from state for the Sanctorum.
    const state = readJsonIfExists(STATE_PATH);
    if (state?.lastDigest?.weekKey === wkKey) digestInfo = state.lastDigest;
  } else if (DRY_RUN) {
    const tracks = weekMap[wkKey].tracks.filter(t => t.platform === 'spotify');
    console.log(c.dim(`  (dry-run) would create "The Vault — ${weekLabel} (${dateRange})" with ${tracks.length} SP links`));
  } else {
    digestInfo = await createWeeklyDigest(parsed.members, {
      weekKey: wkKey,
      onStatus: msg => { process.stdout.write(`\r  ${c.dim(msg)}                              `); },
    });
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
    if (digestInfo.playlistUrl) {
      console.log(`  ${c.green('✓')} ${digestInfo.trackCount} tracks → ${c.cyan(digestInfo.playlistUrl)}`);
    } else {
      console.log(c.yellow('  No Spotify tracks this week — skipped.'));
    }
  }

  // Step 5 — generate HTML pages
  step(++n, STEPS, 'Generate HTML pages');
  let written = [];
  if (SKIP_GENERATE) {
    console.log(c.dim('  (skipped)'));
  } else if (DRY_RUN) {
    console.log(c.dim('  (dry-run) would write: links-youtube.html, links-apple.html, links-bandcamp.html, links.html'));
  } else {
    written = await generateAndWriteAll(parsed.members, digestInfo);
    for (const w of written) console.log(`  ${c.green('✓')} ${w.file}  ${c.dim(`(${(w.bytes / 1024).toFixed(1)}K)`)}`);
  }

  // Step 6 — chat summary
  step(++n, STEPS, 'Weekly chat summary (Claude.ai)');
  let summaryResult = null;
  if (SKIP_SUMMARY) {
    console.log(c.dim('  (skipped)'));
  } else {
    summaryResult = await runSummaryStep({
      rawChatText, weekKey: wkKey,
      weekLabel, dateRange,
      digestInfo,
      summaryFromFile, voiceOverride,
    });
  }

  // Step 7 — commit + push
  step(++n, STEPS, 'Commit and push to GitHub');
  const filesToCommit = [];
  for (const w of written) filesToCommit.push(w.file);
  if (summaryResult) filesToCommit.push('links-summaries.html');

  if (!filesToCommit.length) {
    console.log(c.dim('  Nothing to commit.'));
  } else {
    const status = await statusShort();
    if (!status) {
      console.log(c.dim('  Working tree clean (no changes detected).'));
    } else {
      console.log(c.dim('  Changes:'));
      for (const line of status.split('\n')) console.log('    ' + line);
      const voiceBit = summaryResult ? ` — ${summaryResult.voice}` : '';
      const message = `Weekly admin: ${weekLabel} (${dateRange})${voiceBit}`;
      const ok = DRY_RUN || await confirm(`\n  Commit and push as "${message}"?`);
      if (ok) {
        await commitAndPush({
          files: filesToCommit, message,
          push: !SKIP_PUSH, dryRun: DRY_RUN,
        });
      } else {
        console.log(c.yellow('  Skipped.'));
      }
    }
  }

  // Final clipboard — the summary text for the WhatsApp paste.
  if (summaryResult) {
    await pbcopy(summaryResult.summaryText);
    console.log('\n' + c.green('✓ Summary text copied to clipboard') + c.dim(' — paste into the WhatsApp group.'));
  }

  console.log('\n' + c.green('Done.') + c.dim(' Live in ~2 min: https://surdbird.github.io/music-vault/links.html'));
}

// ── help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`vault-weekly — single-command weekly admin for The Vault

USAGE
  vault-weekly                  Run the full weekly routine
  vault-weekly auth             One-time Spotify OAuth (PKCE + refresh token)
  vault-weekly snippet          Print the browser-console snippet (also copied)
  vault-weekly import-playlists Paste the snippet output → member-playlists.json

FLAGS
  --dry-run        Do everything except Spotify writes, file writes, and push
  --skip-spotify   Skip both member-playlist update and weekly digest
  --skip-update    Skip member-playlist update only
  --skip-digest    Skip weekly digest only
  --skip-generate  Skip HTML generation
  --skip-summary   Skip the Claude.ai summary step
  --skip-push      Commit but don't push
  --chat <path>    Use this chat export instead of auto-detecting newest
  --summary-from <path>  Read summary text from a file (use when terminal paste truncates)
  --voice <name>   Skip the voice prompt and use this voice

STATE
  ~/.vault/tokens.json            Spotify access + refresh tokens
  ~/.vault/client.json            Spotify client_id
  ~/.vault/member-playlists.json  member name → playlist id mapping
  ~/.vault/state.json             last digest info (for Sanctorum)
`);
}

// ── entry ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    if (subcommand === 'auth') await cmdAuth();
    else if (subcommand === 'snippet') await cmdSnippet();
    else if (subcommand === 'import-playlists') await cmdImportPlaylists();
    else if (subcommand === 'help' || flags.has('--help') || flags.has('-h')) printHelp();
    else if (subcommand && !subcommand.startsWith('--')) {
      console.log(c.red(`Unknown subcommand: ${subcommand}`));
      printHelp();
      process.exit(1);
    } else {
      await cmdWeekly();
    }
  } catch (e) {
    console.error('\n' + c.red('Error: ') + e.message);
    if (process.env.VAULT_DEBUG) console.error(e.stack);
    process.exit(1);
  } finally {
    closeRl();
  }
})();
