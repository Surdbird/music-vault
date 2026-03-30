import { useState, useCallback, useRef } from "react";

const STYLES = {
  warm: { label: "🎵 Warm community recap", instruction: "Write a warm, celebratory summary as a fellow music lover. Use bold sections: THE WEEK IN MUSIC, HIGHLIGHTS, DEBATES & DISCUSSIONS, MOST ACTIVE MEMBERS. Quote members by name. Keep it celebratory and human." },
  dylan: { label: "📻 Bob Dylan Radio Hour", instruction: "Write this exactly like Bob Dylan presenting his Theme Time Radio Hour. Rambling, poetic, full of unexpected connections between artists and eras. Reference old bluesmen, strange facts, weave the week into a monologue. Start with a philosophical observation. End with a song dedication. Use 'Well...' a lot." },
  bbc: { label: "🎙️ BBC Radio 6 presenter", instruction: "Write this as a BBC Radio 6 Music presenter. Warm, knowledgeable, slightly dry British wit. Reference conversations as if on air. Use phrases like 'quite remarkable', 'rather wonderful', 'and if you haven't heard this yet...'" },
  rolling_stone: { label: "📰 Rolling Stone review", instruction: "Write this as a Rolling Stone feature — punchy lede, cultural context, name-drop the right artists, treat the group like a scene worth documenting. Use bold section headers. End with a member quote as the kicker." },
  hunter: { label: "🌶️ Hunter S. Thompson", instruction: "Write this as Hunter S. Thompson covering a music group for Rolling Stone circa 1972. Gonzo journalism — you're a participant, it's chaotic, the music is urgent. Fear and Loathing energy but about music." },
  plain: { label: "📋 Just the facts", instruction: "Write a concise plain-text summary for pasting into WhatsApp. No formatting, just 3-4 short paragraphs covering what was shared and discussed. Under 200 words." },
};

const MUSIC_DOMAINS = ['spotify.com', 'youtu.be', 'youtube.com', 'music.apple.com', 'bandcamp.com', 'spotify.link'];
const URL_RE = /https?:\/\/[^\s]+/g;
const DATE_RE = /^\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+\d{1,2}:\d{2}/;

function getWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getWeekKey(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.getFullYear() + '-W' + String(getWeekNum(d)).padStart(2, '0');
}

function parseChat(text) {
  const lines = text.split('\n');
  const chatData = {};
  for (const line of lines) {
    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;
    let day = parseInt(dateMatch[1]), month = parseInt(dateMatch[2]), year = parseInt(dateMatch[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    const weekKey = getWeekKey(date);
    const msgMatch = line.match(/\]?\s*~?\s*([^:]+?):\s*(.+)$/);
    if (!msgMatch) continue;
    const member = msgMatch[1].trim();
    const message = msgMatch[2].trim();
    if (member.includes('🎵') || message.startsWith('‎') || message === 'null') continue;
    if (!chatData[weekKey]) chatData[weekKey] = { messages: [], members: new Set(), links: [], date };
    chatData[weekKey].members.add(member);
    const urls = message.match(URL_RE) || [];
    chatData[weekKey].links.push(...urls.filter(u => MUSIC_DOMAINS.some(d => u.includes(d))));
    const cleanMsg = message.replace(URL_RE, '').trim();
    if (cleanMsg && cleanMsg.length > 3 && !cleanMsg.startsWith('<')) {
      chatData[weekKey].messages.push({ member, message: cleanMsg });
    }
  }
  return chatData;
}

function escHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

export default function ChatSummary() {
  const [chatText, setChatText] = useState('');
  const [chatData, setChatData] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [style, setStyle] = useState('warm');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [summary, setSummary] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  const handlePaste = useCallback((text) => {
    if (!text.trim()) return;
    setChatText(text);
    const data = parseChat(text);
    setChatData(data);
    const weeks = Object.keys(data).sort().reverse();
    if (weeks.length > 0) setSelectedWeek(weeks[0]);
    setSummary(null);
    setError('');
  }, []);

  const weeks = chatData ? Object.keys(chatData).sort().reverse() : [];
  const weekData = chatData && selectedWeek ? chatData[selectedWeek] : null;

  const generate = async () => {
    if (!weekData) return;
    setLoading(true);
    setSummary(null);
    setError('');
    const texts = ['Reading the conversations...', 'Finding the highlights...', 'Spotting the debates...', 'Curating the music moments...', 'Almost there...'];
    let i = 0;
    setLoadingText(texts[0]);
    timerRef.current = setInterval(() => setLoadingText(texts[Math.min(++i, texts.length - 1)]), 2500);

    try {
      const msgs = weekData.messages.slice(0, 400);
      const chatText = msgs.map(m => `${m.member}: ${m.message}`).join('\n');
      const prompt = `You are summarising a week of conversations from "Music Only" — a passionate WhatsApp group of music lovers who have been sharing music daily for 6 years.\n\nHere are the conversations from this week (${msgs.length} messages from ${weekData.members.size} members, plus ${weekData.links.length} music links shared):\n\n${chatText}\n\n${STYLES[style].instruction}\n\nImportant: Quote actual members by name where relevant. Only reference music and conversations that actually appear above.`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json();
      setSummary(data.content?.[0]?.text || 'No summary returned.');
    } catch (e) {
      setError('Error: ' + e.message);
    } finally {
      clearInterval(timerRef.current);
      setLoading(false);
    }
  };

  const copy = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── styles ──────────────────────────────────────────────────────────────────
  const s = {
    wrap: { fontFamily: "'DM Mono', 'Courier New', monospace", background: '#0e0c0a', color: '#e8e0d4', minHeight: '100vh', padding: '1.5rem' },
    header: { maxWidth: 720, margin: '0 auto 2rem', borderBottom: '1px solid #2a2420', paddingBottom: '1.25rem' },
    eyebrow: { fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c8943a', marginBottom: '0.4rem' },
    h1: { fontFamily: 'Georgia, serif', fontSize: 'clamp(1.6rem,4vw,2.6rem)', fontWeight: 900, lineHeight: 1.1, color: '#e8e0d4' },
    em: { color: '#c8943a' },
    sub: { fontSize: '0.72rem', color: '#6b5c48', marginTop: '0.4rem' },
    container: { maxWidth: 720, margin: '0 auto' },
    card: { background: '#161310', border: '1px solid #2a2420', borderRadius: 2, padding: '1.25rem', marginBottom: '1.25rem' },
    label: { fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#7a5820', marginBottom: '0.75rem' },
    textarea: { width: '100%', minHeight: 140, background: '#0e0c0a', border: '1px solid #2a2420', color: '#e8e0d4', fontFamily: 'inherit', fontSize: '0.75rem', padding: '0.75rem', borderRadius: 2, resize: 'vertical', lineHeight: 1.5 },
    select: { width: '100%', background: '#0e0c0a', border: '1px solid #2a2420', color: '#e8e0d4', fontFamily: 'inherit', fontSize: '0.82rem', padding: '0.6rem 0.9rem', borderRadius: 2, cursor: 'pointer', marginBottom: '0.75rem' },
    btn: { width: '100%', background: '#c8943a', color: '#0a0806', fontFamily: 'inherit', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.05em', padding: '0.65rem 1.5rem', border: 'none', borderRadius: 2, cursor: 'pointer', marginTop: '0.75rem', opacity: 1 },
    btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
    stats: { display: 'flex', gap: '1.5rem', marginTop: '0.75rem', flexWrap: 'wrap' },
    statNum: { fontFamily: 'Georgia, serif', fontSize: '1.6rem', color: '#c8943a', lineHeight: 1 },
    statLbl: { fontSize: '0.58rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b5c48', marginTop: 2 },
    loading: { textAlign: 'center', padding: '2rem', color: '#6b5c48', fontSize: '0.8rem' },
    spinner: { display: 'inline-block', width: 18, height: 18, border: '2px solid #2a2420', borderTopColor: '#c8943a', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '0.5rem' },
    summaryHeader: { background: 'linear-gradient(135deg,#1a1208 0%,#0e0c0a 100%)', border: '1px solid #7a5820', borderRadius: 4, padding: '1.25rem', marginBottom: '1.25rem', textAlign: 'center' },
    summaryH2: { fontFamily: 'Georgia, serif', fontSize: '1.3rem', color: '#c8943a', marginBottom: '0.25rem' },
    summaryMeta: { fontSize: '0.7rem', color: '#6b5c48' },
    summaryContent: { fontSize: '0.82rem', lineHeight: 1.85, color: '#e8e0d4', whiteSpace: 'pre-wrap' },
    copyBtn: { background: 'none', border: '1px solid #2a2420', color: '#6b5c48', fontFamily: 'inherit', fontSize: '0.62rem', padding: '0.25rem 0.65rem', borderRadius: 2, cursor: 'pointer', float: 'right', marginTop: '-0.15rem' },
    error: { color: '#c8401a', fontSize: '0.78rem', marginTop: '0.5rem' },
    hint: { fontSize: '0.65rem', color: '#6b5c48', marginTop: '0.4rem' },
  };

  const d = weekData?.date;
  const weekLabel = d ? `Week ${getWeekNum(d)} · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';

  return (
    <div style={s.wrap}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} select option{background:#161310}`}</style>
      <div style={s.header}>
        <div style={s.eyebrow}>The Vault · Curator Tools</div>
        <h1 style={s.h1}>Weekly <span style={s.em}>Chat Summary</span></h1>
        <p style={s.sub}>Paste your WhatsApp export, pick a week, and get an AI-generated summary.</p>
      </div>

      <div style={s.container}>
        {/* Paste area */}
        <div style={s.card}>
          <div style={s.label}>01 · Chat Export</div>
          <textarea
            style={s.textarea}
            placeholder="Paste your WhatsApp .txt export here..."
            onChange={e => handlePaste(e.target.value)}
            spellCheck={false}
          />
          <div style={s.hint}>Export from WhatsApp → More → Export Chat → Without Media → copy the .txt contents and paste above.</div>
          {weeks.length > 0 && (
            <div style={{ marginTop: '0.75rem', color: '#1db954', fontSize: '0.75rem' }}>
              ✓ Loaded {weeks.length} week{weeks.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Week picker + generate */}
        {weeks.length > 0 && (
          <div style={s.card}>
            <div style={s.label}>02 · Pick a Week</div>
            <select style={s.select} value={selectedWeek} onChange={e => { setSelectedWeek(e.target.value); setSummary(null); }}>
              {weeks.map(w => {
                const wd = chatData[w];
                const dd = wd.date;
                return (
                  <option key={w} value={w}>
                    W{getWeekNum(dd)} — {dd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {wd.messages.length} msgs · {wd.links.length} links
                  </option>
                );
              })}
            </select>

            {weekData && (
              <div style={s.stats}>
                <div><div style={s.statNum}>{weekData.messages.length}</div><div style={s.statLbl}>Messages</div></div>
                <div><div style={s.statNum}>{weekData.members.size}</div><div style={s.statLbl}>Members</div></div>
                <div><div style={s.statNum}>{weekData.links.length}</div><div style={s.statLbl}>Music links</div></div>
              </div>
            )}

            <div style={s.label} style={{ marginTop: '1rem', fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#7a5820' }}>03 · Style</div>
            <select style={s.select} value={style} onChange={e => setStyle(e.target.value)}>
              {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>

            <button
              style={{ ...s.btn, ...(loading || !weekData ? s.btnDisabled : {}) }}
              onClick={generate}
              disabled={loading || !weekData}
            >
              {loading ? '⏳ Generating...' : '✦ Generate Weekly Summary'}
            </button>
            {error && <div style={s.error}>{error}</div>}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={s.loading}>
            <div style={s.spinner} />
            <div>{loadingText}</div>
          </div>
        )}

        {/* Summary output */}
        {summary && (
          <>
            <div style={s.summaryHeader}>
              <div style={s.summaryH2}>Music Only</div>
              <div style={s.summaryMeta}>{weekLabel} · {weekData.messages.length} messages · {weekData.members.size} members · {weekData.links.length} music links</div>
            </div>
            <div style={s.card}>
              <div style={s.label}>
                Weekly Summary
                <button style={s.copyBtn} onClick={copy}>{copied ? '✓ Copied!' : '⎘ Copy'}</button>
              </div>
              <div style={s.summaryContent} dangerouslySetInnerHTML={{ __html: escHtml(summary) }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
