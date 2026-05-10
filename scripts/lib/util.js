import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..');
export const STATE_DIR = path.join(os.homedir(), '.vault');
export const TOKEN_PATH = path.join(STATE_DIR, 'tokens.json');
export const CLIENT_PATH = path.join(STATE_DIR, 'client.json');
export const MEMBER_PLAYLISTS_PATH = path.join(STATE_DIR, 'member-playlists.json');
export const STATE_PATH = path.join(STATE_DIR, 'state.json');

export function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function readJsonIfExists(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

export function writeJson(p, obj) {
  ensureStateDir();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pbcopy(text) {
  return new Promise((resolve, reject) => {
    const p = spawn('pbcopy');
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`pbcopy exited ${code}`)));
    p.stdin.end(text);
  });
}

export function openUrl(url) {
  return new Promise((resolve, reject) => {
    const p = spawn('open', [url], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`open exited ${code}`)));
  });
}

let _rl = null;
function rl() {
  if (!_rl) _rl = createInterface({ input: stdin, output: stdout });
  return _rl;
}
export function closeRl() { if (_rl) { _rl.close(); _rl = null; } }

export async function ask(prompt) {
  return (await rl().question(prompt)).trim();
}

export async function confirm(prompt, def = true) {
  const suffix = def ? ' [Y/n] ' : ' [y/N] ';
  const answer = (await ask(prompt + suffix)).toLowerCase();
  if (!answer) return def;
  return answer === 'y' || answer === 'yes';
}

// Read multi-line input from stdin until either Ctrl-D (EOF) or a single line
// containing "__END__". Closes the shared readline interface for the duration.
export async function readMultiline(prompt) {
  process.stdout.write(prompt);
  closeRl();
  const tmp = createInterface({ input: stdin, output: stdout, terminal: false });
  const lines = [];
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      tmp.close();
      resolve(lines.join('\n'));
    };
    tmp.on('line', line => {
      if (line.trim() === '__END__') finish();
      else lines.push(line);
    });
    tmp.once('close', finish);
  });
}

export function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

export function color(s, code) {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
export const c = {
  dim: s => color(s, '2'),
  bold: s => color(s, '1'),
  red: s => color(s, '31'),
  green: s => color(s, '32'),
  yellow: s => color(s, '33'),
  blue: s => color(s, '34'),
  magenta: s => color(s, '35'),
  cyan: s => color(s, '36'),
};

export function step(n, total, msg) {
  console.log(`\n${c.bold(`[${n}/${total}]`)} ${c.cyan(msg)}`);
}
