import http from 'node:http';
import crypto from 'node:crypto';
import { TOKEN_PATH, CLIENT_PATH, readJsonIfExists, writeJson, openUrl, sleep, ask, c } from './util.js';

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const DEFAULT_CLIENT_ID = '05d1e6e31ccf465a84de32fe886550fe';
const SCOPES = 'playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative';

// ── Token storage ────────────────────────────────────────────────────────────

export function loadTokens() {
  return readJsonIfExists(TOKEN_PATH);
}

function saveTokens(tokens) {
  writeJson(TOKEN_PATH, tokens);
}

export function loadClientId() {
  const rec = readJsonIfExists(CLIENT_PATH);
  return rec?.client_id || DEFAULT_CLIENT_ID;
}

export function saveClientId(client_id) {
  writeJson(CLIENT_PATH, { client_id });
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateVerifier() {
  return b64url(crypto.randomBytes(64));
}

function generateChallenge(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier).digest());
}

// ── One-time browser auth — captures access + refresh tokens ─────────────────

export async function runAuthFlow({ clientId } = {}) {
  const useId = clientId || loadClientId();
  saveClientId(useId);

  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = b64url(crypto.randomBytes(16));

  const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
    client_id: useId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  })}`;

  console.log(c.dim('\nMake sure this redirect URI is registered on your Spotify app:'));
  console.log(c.cyan('  ' + REDIRECT_URI));
  console.log(c.dim('  → https://developer.spotify.com/dashboard → your app → Edit Settings → Redirect URIs\n'));

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:8888`);
      if (url.pathname !== '/callback') {
        res.writeHead(404); res.end('Not found'); return;
      }
      const gotCode = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Auth failed</h1><p>${err}</p>`);
        server.close();
        reject(new Error(err));
        return;
      }
      if (gotState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>State mismatch — possible CSRF</h1>');
        server.close();
        reject(new Error('state mismatch'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><meta charset="utf-8"><title>The Vault</title>
<body style="font-family:system-ui;background:#0e0c0a;color:#e8e0d4;padding:48px;text-align:center">
<h1 style="color:#d4845a">✓ Connected</h1>
<p>You can close this tab and return to the terminal.</p>
</body>`);
      server.close();
      resolve(gotCode);
    });
    server.listen(8888, '127.0.0.1', () => {
      console.log(c.cyan('Opening Spotify authorization in your browser…'));
      openUrl(authUrl).catch(() => {
        console.log(c.yellow('Could not open browser automatically. Visit this URL:'));
        console.log('  ' + authUrl);
      });
    });
    server.on('error', reject);
  });

  // Exchange code for tokens.
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: useId,
      code_verifier: verifier,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error('Token exchange failed: ' + (tokenJson.error_description || JSON.stringify(tokenJson)));
  }

  const tokens = {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    expires_at: Date.now() + (tokenJson.expires_in - 60) * 1000,
    scope: tokenJson.scope,
  };
  saveTokens(tokens);
  console.log(c.green('✓ Tokens saved to ~/.vault/tokens.json'));

  // Verify by fetching profile.
  const profile = await spotifyFetch('https://api.spotify.com/v1/me');
  console.log(c.green(`✓ Connected as ${profile.display_name || profile.id}`));
  return profile;
}

// ── Refresh ──────────────────────────────────────────────────────────────────

async function refreshAccessToken() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error('No refresh token. Run: vault-weekly auth');
  }
  const clientId = loadClientId();
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    }),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Token refresh failed: ' + (json.error_description || JSON.stringify(json)));
  }
  const next = {
    ...tokens,
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  };
  // Spotify rotates refresh tokens occasionally — update if returned.
  if (json.refresh_token) next.refresh_token = json.refresh_token;
  saveTokens(next);
  return next;
}

async function getValidAccessToken() {
  let tokens = loadTokens();
  if (!tokens) throw new Error('Not authenticated. Run: vault-weekly auth');
  if (Date.now() > tokens.expires_at) tokens = await refreshAccessToken();
  return tokens.access_token;
}

// ── API wrapper ──────────────────────────────────────────────────────────────

export async function spotifyFetch(url, options = {}, _retried = false) {
  const token = await getValidAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && !_retried) {
    await refreshAccessToken();
    return spotifyFetch(url, options, true);
  }
  if (res.status === 429 && !_retried) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
    const MAX_WAIT_S = 90;
    if (retryAfter > MAX_WAIT_S) {
      const e = new Error(`Spotify rate-limited us hard (Retry-After: ${retryAfter}s ≈ ${(retryAfter / 3600).toFixed(1)}h). Try again later — the limit decays over time.`);
      e.status = 429;
      throw e;
    }
    console.log(c.yellow(`  ⏳ Rate limited — waiting ${retryAfter}s…`));
    await sleep((retryAfter + 1) * 1000);
    return spotifyFetch(url, options, true);
  }
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch { err = {}; }
    const msg = err.error?.message || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  if (res.status === 204) return {};
  return res.json();
}

// ── Resolve URLs to track URIs (expands albums, playlists, episodes) ─────────

export async function resolveSpotifyUris(urls, onProgress, skipped) {
  const uris = [];
  let done = 0;
  const total = urls.length;

  for (let url of urls) {
    try {
      if (url.includes('spotify.link')) {
        try {
          const resolved = await spotifyFetch(`https://api.spotify.com/v1/resolve?url=${encodeURIComponent(url)}`);
          if (resolved?.external_urls?.spotify) {
            url = resolved.external_urls.spotify;
          } else if (resolved?.uri) {
            uris.push(resolved.uri);
            done++; if (onProgress) onProgress(done, total);
            continue;
          }
        } catch (e) {
          if (skipped) skipped.push({ url, reason: e.message });
          done++; if (onProgress) onProgress(done, total);
          continue;
        }
      }

      const albumMatch = url.match(/\/album\/([a-zA-Z0-9]+)/);
      const playlistMatch = url.match(/\/playlist\/([a-zA-Z0-9]+)/);
      const episodeMatch = url.match(/\/episode\/([a-zA-Z0-9]+)/);
      const trackMatch = !albumMatch && !playlistMatch && !episodeMatch && url.match(/\/track\/([a-zA-Z0-9]+)/);

      if (albumMatch) {
        const albumId = albumMatch[1];
        let offset = 0; const limit = 50; let totalT = 1;
        while (offset < totalT) {
          const data = await spotifyFetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`);
          if (data.items) {
            for (const t of data.items) uris.push(`spotify:track:${t.id}`);
            totalT = data.total;
            offset += data.items.length;
          } else break;
          if (offset < totalT) await sleep(150);
        }
      } else if (playlistMatch) {
        const playlistId = playlistMatch[1];
        let next = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,type))`;
        while (next) {
          const data = await spotifyFetch(next);
          if (data.items) {
            for (const item of data.items) {
              if (item.track && item.track.type === 'track') uris.push(`spotify:track:${item.track.id}`);
            }
          }
          next = data.next || null;
          if (next) await sleep(150);
        }
      } else if (episodeMatch) {
        uris.push(`spotify:episode:${episodeMatch[1]}`);
      } else if (trackMatch) {
        uris.push(`spotify:track:${trackMatch[1]}`);
      }
    } catch (e) {
      if (skipped) skipped.push({ url, reason: e.message });
    }
    done++;
    if (onProgress) onProgress(done, total);
  }

  return uris;
}

// ── List playlists owned/followed by the user ────────────────────────────────

export async function listAllUserPlaylists() {
  const out = [];
  let next = 'https://api.spotify.com/v1/me/playlists?limit=50';
  while (next) {
    const page = await spotifyFetch(next);
    for (const p of (page.items || [])) out.push(p);
    next = page.next || null;
    if (next) await sleep(120);
  }
  return out;
}
