// Voice picker + clipboard prompt + open Claude.ai + capture summary +
// insert into links-summaries.html.
//
// The user's Max plan is on claude.ai; the API would bill separately. So we
// stage the prompt on the clipboard, open Claude.ai, and ask the user to
// paste the result back here when done.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, pbcopy, openUrl, ask, readMultiline, c, escapeHtml } from './util.js';
import { extractWeekText } from './chat.js';

// Voices known to work, from vault-admin-guide.md and the project state doc.
export const CONFIRMED_VOICES = [
  'Bob Dylan Radio Hour', 'Hunter S. Thompson', 'Allen Ginsberg',
  'Gabriel García Márquez', 'David Foster Wallace', 'Leonard Cohen',
  'Woody Guthrie', 'Arthur C. Clarke', 'C.L.R. James', 'David Attenborough',
  'Michael Ondaatje', 'V.S. Naipaul', 'Lee Child', 'Joan Baez',
  'Salman Rushdie', 'The Onion', 'Greil Marcus', 'John le Carré',
  'BBC Radio 6', 'Rolling Stone', 'Lester Bangs', 'Nick Hornby',
  'Hemingway', 'plain text',
];

// Heuristic theme detection → suggested voices. Returns up to 2 picks with
// a one-line reason for each. The user always has the final word.
export function suggestVoices(weekText) {
  const t = weekText.toLowerCase();
  const signals = [];

  const hits = (...needles) => needles.reduce((n, w) => n + (t.split(w).length - 1), 0);

  const death = hits('rip ', ' rip\n', 'passed away', 'died', 'obituary', ' obit ', 'dead at', 'gone too soon');
  const jazz = hits('jazz', 'coltrane', 'miles davis', 'monk', 'blue note', 'brubeck', 'mingus');
  const cosmic = hits('space', 'cosmic', 'galaxy', 'universe', 'planet', 'voyager', 'eclipse', 'telescope');
  const political = hits('trump', 'modi', 'putin', 'gaza', 'ukraine', 'election', 'protest', 'war ');
  const memory = hits('childhood', 'years ago', 'remember when', 'used to ', 'when i was', 'grew up', 'father', 'mother');
  const nightowl = (t.match(/3:\d{2}\s?am|4:\d{2}\s?am|2:\d{2}\s?am/gi) || []).length;
  const indianMusic = hits('hindustani', 'carnatic', 'raga', 'raag', 'tabla', 'sitar', 'qawwali');
  const longThreads = (weekText.match(/\n/g) || []).length > 1500;
  const british = hits('bbc', 'london', 'glasgow', 'manchester', 'liverpool', 'mersey', 'scottish');

  if (death >= 2) signals.push({ voice: 'Leonard Cohen', why: `${death} mentions of loss/passing — Cohen for grief` });
  if (death >= 2 && memory >= 4) signals.push({ voice: 'Gabriel García Márquez', why: 'loss + memory threads — Márquez for elegy' });
  if (jazz >= 5) signals.push({ voice: 'Lester Bangs', why: `${jazz} jazz mentions — Bangs gets jazz` });
  if (cosmic >= 3) signals.push({ voice: 'Arthur C. Clarke', why: `${cosmic} cosmic/space mentions — Clarke fits` });
  if (political >= 3) signals.push({ voice: 'Hunter S. Thompson', why: `${political} political mentions — HST for the riff` });
  if (nightowl >= 3) signals.push({ voice: 'Allen Ginsberg', why: `${nightowl} late-night posts — Ginsberg for the frenetic week` });
  if (longThreads) signals.push({ voice: 'David Foster Wallace', why: 'high message volume — DFW for sprawling weeks' });
  if (indianMusic >= 3) signals.push({ voice: 'Salman Rushdie', why: `${indianMusic} Indian-music threads — Rushdie` });
  if (british >= 3 && jazz < 3) signals.push({ voice: 'John le Carré', why: 'British/transatlantic week — le Carré' });

  if (!signals.length) signals.push({ voice: 'Bob Dylan Radio Hour', why: 'no strong signals — Dylan as a safe default' });

  // Dedupe by voice, cap at 3.
  const seen = new Set();
  const out = [];
  for (const s of signals) {
    if (seen.has(s.voice)) continue;
    seen.add(s.voice);
    out.push(s);
    if (out.length >= 3) break;
  }
  return out;
}

// Build the prompt that gets put on the clipboard + sent to Claude.ai.
// We include explicit format instructions so the result is easy to insert
// into the dispatches HTML.
export function buildClaudePrompt({ voice, weekLabel, dateRange, weekText }) {
  return `Give me a weekly chat summary in the manner of ${voice}.

This is the WhatsApp music-community chat for ${weekLabel} (${dateRange}). The group is "Music Only" — 125 members, six years of history. Write in a literary voice that captures what actually happened in the chat: the music shared, the threads people wove, the small dramas, the in-jokes, the deaths and birthdays, the late-night posts.

Style requirements:
- Open with a short evocative title on its own line, formatted as: TITLE: <your title>
- 4–8 short sections separated by a single line containing only: ---
- End with a coda line on its own: CODA: The Claude works in mysterious ways.
- Then a dateline on its own line: DATELINE: ${weekLabel} · ${dateRange} · — after ${voice}
- Use *italics* (asterisks) for emphasis — I'll convert these to <em>.
- Plain prose paragraphs only — no bullet points, no headers, no markdown other than asterisk italics.

Here is the week's chat:

${weekText}`;
}

// Parse Claude's output back into structured sections.
// Tolerant: missing markers fall back to sensible defaults.
function parseSummary(raw) {
  const lines = raw.split('\n');
  let title = '';
  let coda = 'The Claude works in mysterious ways.';
  let dateline = '';
  const bodyLines = [];

  for (const line of lines) {
    const tm = line.match(/^TITLE:\s*(.+)$/i);
    const cm = line.match(/^CODA:\s*(.+)$/i);
    const dm = line.match(/^DATELINE:\s*(.+)$/i);
    if (tm && !title) { title = tm[1].trim().replace(/^["“]|["”]$/g, ''); continue; }
    if (cm) { coda = cm[1].trim(); continue; }
    if (dm) { dateline = dm[1].trim(); continue; }
    bodyLines.push(line);
  }

  // Split body into sections on lines that are just "---".
  const text = bodyLines.join('\n').trim();
  const sections = text.split(/\n\s*---\s*\n/).map(s => s.trim()).filter(Boolean);

  // First non-empty paragraph of section 1 → preview.
  const firstSection = sections[0] || '';
  const firstPara = firstSection.split(/\n\s*\n/)[0].trim();
  const preview = firstPara.length > 320 ? firstPara.slice(0, 317).trim() + '…' : firstPara;

  return { title, coda, dateline, sections, preview };
}

function emToHtml(s) {
  return escapeHtml(s).replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

function paragraphsHtml(text) {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `      <p>${emToHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n\n');
}

// Build the <div class="week-block">…</div> blob to insert into links-summaries.html.
export function buildWeekBlock({ weekNum, dateRange, voice, parsed, digestInfo }) {
  const sectionsHtml = parsed.sections.map((sec, idx) => {
    const inner = paragraphsHtml(sec);
    return idx === 0 ? inner : `      <div class="ornament">— ✦ —</div>\n\n${inner}`;
  }).join('\n\n');

  const playlistLink = digestInfo?.playlistUrl
    ? `      <a class="pl-link" href="${digestInfo.playlistUrl}" target="_blank">◎ Spotify W${weekNum}</a>\n`
    : '';

  return `  <!-- WEEK ${weekNum} -->
  <div class="week-block">
    <div class="week-meta">
      <span class="week-num">Week ${weekNum}</span>
      <span class="week-dates">${escapeHtml(dateRange)}</span>
    </div>
    <div class="week-title">${emToHtml(parsed.title || `Week ${weekNum}`)}</div>
    <div class="voice-tag">In the manner of ${escapeHtml(voice)}</div>

    <div class="playlist-links">
${playlistLink}      <a class="pl-link" href="https://surdbird.github.io/music-vault/links.html" target="_blank">✦ Sanctorum</a>
    </div>

    <div class="summary-preview">"${emToHtml(parsed.preview)}"</div>

    <button class="expand-btn" onclick="toggleExpand(this)">Read Full Dispatch ↓</button>
    <div class="full-text">

${sectionsHtml}

      <p class="coda">${emToHtml(parsed.coda)}</p>
      <p class="dateline">${emToHtml(parsed.dateline || `Week ${weekNum} · ${dateRange} · — after ${voice}`)}</p>
    </div>
  </div>

`;
}

// Insert the new block into links-summaries.html, right after the
// <div class="container"> opening tag (so newest week appears first).
export function insertIntoSummariesHtml(blockHtml) {
  const filePath = path.join(REPO_ROOT, 'links-summaries.html');
  const original = fs.readFileSync(filePath, 'utf8');
  const marker = '<div class="container">\n';
  const idx = original.indexOf(marker);
  if (idx < 0) throw new Error('Could not find <div class="container"> insertion point in links-summaries.html');
  const insertAt = idx + marker.length;
  const next = original.slice(0, insertAt) + '\n' + blockHtml + original.slice(insertAt);
  fs.writeFileSync(filePath, next);
  return filePath;
}

// ── Orchestrate the whole summary step ───────────────────────────────────────
//
// Returns { summaryText, voice, parsed, weekLabel, dateRange } — caller can
// pbcopy the final text for the WhatsApp paste.
//
// Options:
//   summaryFromFile  — path to a file containing the Claude response, used
//                      when terminal-paste truncates long input
//   voiceOverride    — skip the voice prompt entirely
export async function runSummaryStep({
  rawChatText, weekKey, weekLabel, dateRange, digestInfo,
  summaryFromFile = null, voiceOverride = null,
}) {
  const weekText = extractWeekText(rawChatText, weekKey);
  if (!weekText.trim()) throw new Error(`No chat lines found for ${weekKey}`);

  let voice;
  if (voiceOverride) {
    voice = voiceOverride;
    console.log(`\nVoice → ${c.cyan(voice)} ${c.dim('(from --voice flag)')}`);
  } else {
    const suggestions = suggestVoices(weekText);
    console.log('\n' + c.bold('Voice suggestions for this week:'));
    for (const s of suggestions) {
      console.log('  ' + c.cyan('• ' + s.voice) + c.dim('  — ' + s.why));
    }
    console.log(c.dim('\nConfirmed voices: ' + CONFIRMED_VOICES.join(', ')));
    console.log(c.dim('Type any voice (free-form). Press Enter to accept the first suggestion.\n'));
    voice = await ask('Voice → ');
    if (!voice) voice = suggestions[0].voice;
  }

  let summaryText;
  if (summaryFromFile) {
    const fs = await import('node:fs');
    summaryText = fs.readFileSync(summaryFromFile, 'utf8').trim();
    console.log(c.dim(`Read summary from ${summaryFromFile} (${summaryText.length.toLocaleString()} chars)`));
    if (!summaryText) throw new Error(`Summary file ${summaryFromFile} is empty`);
  } else {
    const prompt = buildClaudePrompt({ voice, weekLabel, dateRange, weekText });
    await pbcopy(prompt);
    console.log(c.green(`\n✓ Prompt copied to clipboard (${prompt.length.toLocaleString()} chars)`));
    console.log(c.cyan('Opening Claude.ai — paste with ⌘V, send, then copy the response back.'));
    await openUrl('https://claude.ai/new');

    console.log(c.dim('\nWhen you have the summary, paste it below.'));
    console.log(c.dim('Tip: long pastes can truncate in macOS Terminal — if so, save the response to a'));
    console.log(c.dim('     file and re-run with --summary-from <path>.'));
    console.log(c.dim('When done, type a line containing only __END__ and press Enter, or press Ctrl-D.\n'));
    summaryText = (await readMultiline('')).trim();
    if (!summaryText) throw new Error('No summary captured');
  }

  const parsed = parseSummary(summaryText);
  if (!parsed.title) {
    const t = await ask(`\nNo TITLE: line found. Enter a title (or Enter for "Week ${weekKey}"): `);
    parsed.title = t || `Week ${weekKey}`;
  }

  const weekNum = parseInt(weekKey.match(/W(\d+)/)?.[1] || '0', 10);
  const block = buildWeekBlock({ weekNum, dateRange, voice, parsed, digestInfo });
  const filePath = insertIntoSummariesHtml(block);
  console.log(c.green(`✓ Inserted into ${path.relative(REPO_ROOT, filePath)}`));

  return { summaryText, voice, parsed, weekLabel, dateRange, filePath };
}
