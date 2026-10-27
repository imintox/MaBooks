(() => {
'use strict';
const DB = 'shelf', STORE = 'books', MIRROR = 'shelf-mirror', LASTBK = 'shelf-last-backup', PROFILE_KEY = 'mabooks-profile';
let books = [], page = 'reading', query = '', rangeKey = '6M', deferredPrompt = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : '';
const fmtMD = (s, yr) => new Date(s + 'T12:00:00').toLocaleDateString(undefined, yr ? {month:'short', day:'numeric', year:'numeric'} : {month:'short', day:'numeric'});

/* ---------- profile (name, emoji, color, tagline, goal) ---------- */
const COLORS = {
  pink:['#ff5fae', '#ff8cc6'], violet:['#a78bfa', '#c4b5fd'], blue:['#4da3ff', '#8cc4ff'],
  mint:['#34d399', '#7ee3bd'], amber:['#ffb347', '#ffd08a'], red:['#ff5a6a', '#ff8a95']
};
const COLOR_KEYS = Object.keys(COLORS);
const EMOJIS = ['📚', '🦉', '🐈', '🌙', '🔥', '🌸', '🧠', '☕', '🐉', '🪐', '🦋', '👻'];
const cleanProfile = p => {
  p = p && typeof p === 'object' ? p : {};
  return {
    name: String(p.name || '').slice(0, 30),
    emoji: EMOJIS.includes(p.emoji) ? p.emoji : EMOJIS[0],
    color: COLOR_KEYS.includes(p.color) ? p.color : 'pink',
    tagline: String(p.tagline || '').slice(0, 80),
    goal: Math.min(999, Math.max(0, Math.round(+p.goal) || 0))
  };
};
let profile = cleanProfile({});
const isDefaultProfile = p => JSON.stringify(p) === JSON.stringify(cleanProfile({}));
const loadProfile = () => { try { profile = cleanProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}')); } catch (e) { profile = cleanProfile({}); } };
const saveProfile = () => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) {} };
function applyTheme(key) {
  const [a, b] = COLOR_KEYS.includes(key) ? COLORS[key] : COLORS.pink;
  const n = parseInt(a.slice(1), 16), rgb = `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`;
  const r = document.documentElement.style;
  r.setProperty('--accent', a); r.setProperty('--accent2', b);
  r.setProperty('--glow', `rgba(${rgb},.38)`); r.setProperty('--tint', `rgba(${rgb},.15)`);
}

/* ---------- storage: IndexedDB primary + localStorage mirror ---------- */
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, {keyPath:'id'});
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
};
const idbAll = () => tx('readonly', s => s.getAll());
const idbPut = b => tx('readwrite', s => s.put(b));
const idbDel = id => tx('readwrite', s => s.delete(id));
const idbReplace = list => tx('readwrite', s => { s.clear(); list.forEach(b => s.put(b)); });
const mirror = () => { try { localStorage.setItem(MIRROR, JSON.stringify(books)); } catch (e) {} };

async function load() {
  try { books = await idbAll(); } catch (e) { books = []; }
  if (!books.length) {            // recover from mirror if IndexedDB was wiped
    try {
      const m = JSON.parse(localStorage.getItem(MIRROR) || '[]');
      if (m.length) { books = m; await idbReplace(books); }
    } catch (e) {}
  }
}
async function save(b) {
  const i = books.findIndex(x => x.id === b.id);
  if (i >= 0) books[i] = b; else books.push(b);
  mirror(); await idbPut(b);
}
async function remove(id) { books = books.filter(b => b.id !== id); mirror(); await idbDel(id); }

/* ---------- stats for the profile page ---------- */
const RANGES = {
  '1M':  {months: 0,  name: 'the last month'},
  '3M':  {months: 3,  name: 'the last 3 months'},
  '6M':  {months: 6,  name: 'the last 6 months'},
  '12M': {months: 12, name: 'the last 12 months'}
};
function rangeStats(key) {
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const to = ymd(now);
  const done = books.filter(b => b.status === 'read' && isDate(b.finished));
  const buckets = [];
  if (key === '1M') {                       // last 30 days in six 5-day bars
    const start = new Date(now); start.setDate(start.getDate() - 29);
    for (let i = 0; i < 6; i++) {
      const s = new Date(start); s.setDate(s.getDate() + i * 5);
      const e = new Date(s); e.setDate(e.getDate() + 4);
      buckets.push({lo: ymd(s), hi: ymd(e) < to ? ymd(e) : to, label: `${s.getMonth() + 1}/${s.getDate()}`});
    }
  } else {                                  // last N calendar months, one bar each
    const n = RANGES[key].months;
    for (let i = n - 1; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1, 12);
      const e = new Date(s.getFullYear(), s.getMonth() + 1, 0, 12);
      buckets.push({lo: ymd(s), hi: ymd(e) < to ? ymd(e) : to, label: s.toLocaleDateString(undefined, {month:'short'})});
    }
  }
  const from = buckets[0].lo;
  buckets.forEach(b => { b.count = done.filter(x => x.finished >= b.lo && x.finished <= b.hi).length; });
  const inRange = done.filter(x => x.finished >= from && x.finished <= to);
  return {from, to, buckets, total: inRange.length, rated: inRange.filter(x => x.rating > 0)};
}

function chartSVG(buckets) {
  const W = 320, H = 168, top = 22, base = 138, plotH = base - top;
  const max = Math.max(1, ...buckets.map(b => b.count));
  const n = buckets.length, slot = (W - 20) / n, bw = Math.min(34, slot * 0.58);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Books finished per period">
    <defs><linearGradient id="barg" x1="0" y1="0" x2="0" y2="1"><stop class="g1" offset="0"/><stop class="g2" offset="1"/></linearGradient></defs>`;
  [0, 0.5, 1].forEach(f => { const y = base - plotH * f; s += `<line class="gl" x1="10" x2="${W - 10}" y1="${y}" y2="${y}"/>`; });
  buckets.forEach((b, i) => {
    const cx = 10 + slot * i + slot / 2, h = b.count ? Math.max(4, plotH * b.count / max) : 0;
    if (b.count) {
      s += `<rect class="bar" x="${(cx - bw / 2).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="url(#barg)"/>`;
      s += `<text class="val" x="${cx.toFixed(1)}" y="${(base - h - 6).toFixed(1)}">${b.count}</text>`;
    } else {
      s += `<rect class="bar0" x="${(cx - bw / 2).toFixed(1)}" y="${base - 2}" width="${bw.toFixed(1)}" height="2" rx="1"/>`;
    }
    s += `<text class="lab" x="${cx.toFixed(1)}" y="${H - 12}">${esc(b.label)}</text>`;
  });
  return s + '</svg>';
}

/* ---------- render ---------- */
const TITLES = {reading: 'Reading', read: 'Finished', want: 'Wishlist', profile: 'Profile'};
function render() {
  const reading = books.filter(b => b.status === 'reading');
  const read = books.filter(b => b.status === 'read'), want = books.filter(b => b.status === 'want');
  const y = new Date().getFullYear();
  const thisYear = read.filter(b => String(b.finished).startsWith(String(y))).length;

  document.querySelectorAll('#tabbar [data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  $('title').textContent = TITLES[page];
  $('stats').textContent = ({
    reading: reading.length ? `${reading.length} in progress` : 'What you’re reading now',
    read: read.length ? `${read.length} finished · ${thisYear} in ${y}` : 'Books you’ve finished',
    want: want.length ? `${want.length} to read` : 'Books you want to read',
    profile: 'Your reading year'
  })[page];
  const onProfile = page === 'profile';
  $('fab').hidden = onProfile;
  $('page-list').hidden = onProfile;
  $('page-profile').hidden = !onProfile;

  if (onProfile) renderProfile(reading, read, want, y, thisYear); else renderList(reading, read, want);
  renderNudge();
}

function renderList(reading, read, want) {
  const q = query.trim().toLowerCase();
  const list = ({reading, read, want})[page].filter(b => !q || (b.title + ' ' + b.author + ' ' + b.notes).toLowerCase().includes(q));
  list.sort(page === 'read'
    ? (a, b) => String(b.finished || '').localeCompare(String(a.finished || '')) || b.added - a.added
    : page === 'reading'
      ? (a, b) => String(b.started || '').localeCompare(String(a.started || '')) || b.added - a.added
      : (a, b) => b.added - a.added);

  const dayN = s => Math.max(1, Math.round((new Date(today() + 'T12:00:00') - new Date(s + 'T12:00:00')) / 864e5) + 1);
  const meta = b => page === 'read'
    ? `<div class="m">${b.rating ? `<span class="stars">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>` : ''}
        ${b.finished ? `<span>${fmtDate(b.finished)}</span>` : ''}</div>`
    : page === 'reading'
      ? `<div class="m"><span>${isDate(b.started) ? `Started ${fmtDate(b.started)} · day ${dayN(b.started)}` : `Added ${fmtDate(ymd(new Date(b.added)))}`}</span>
          <button class="mark" data-finish="${esc(b.id)}">Finished</button></div>`
      : `<div class="m"><span>Added ${fmtDate(ymd(new Date(b.added)))}</span>
          <button class="mark" data-start="${esc(b.id)}">Start reading</button></div>`;
  const empty = {
    reading: 'Nothing in progress.<br>Tap + to add the book you’re reading.',
    read: 'No finished books yet.<br>Tap + to log one you’ve finished.',
    want: 'Your wishlist is empty.<br>Tap + to add a book you want to read.'
  }[page];

  $('list').innerHTML = list.length ? list.map(b => `
    <div class="book" data-id="${esc(b.id)}">
      <div class="t">${esc(b.title)}</div>
      ${b.author ? `<div class="a">${esc(b.author)}</div>` : ''}
      ${meta(b)}
      ${page !== 'want' && b.notes ? `<div class="note">${esc(b.notes)}</div>` : ''}
    </div>`).join('')
    : `<div class="empty">${q ? 'No matches.' : empty}</div>`;
}

async function startReading(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  b.status = 'reading'; b.started = today();
  await save(b); setPage('reading');
}

function renderProfile(reading, read, want, y, thisYear) {
  const rs = rangeStats(rangeKey);
  const undated = read.filter(b => !isDate(b.finished)).length;
  const rangeAvg = rs.rated.length ? (rs.rated.reduce((a, b) => a + b.rating, 0) / rs.rated.length).toFixed(1) : '';
  const name = profile.name || 'Reader';
  const tagline = profile.tagline || (profile.name ? '' : 'Tap Edit to make this yours');

  $('page-profile').innerHTML = `
    <div class="pcard">
      <div class="avatar">${esc(profile.emoji)}</div>
      <div class="pinfo"><div class="pname">${esc(name)}</div>${tagline ? `<div class="ptag">${esc(tagline)}</div>` : ''}</div>
      <button class="pill" id="edit-profile">Edit</button>
    </div>
    <div class="tiles">
      <div class="tile"><b>${read.length}</b><span>Finished</span></div>
      <div class="tile"><b>${thisYear}</b><span>${y}</span></div>
      <div class="tile"><b>${reading.length}</b><span>Reading</span></div>
      <div class="tile"><b>${want.length}</b><span>Wishlist</span></div>
    </div>
    ${profile.goal ? `<div class="panel">
      <div class="goalrow"><span>${y} goal</span><b>${thisYear} / ${profile.goal}</b></div>
      <progress class="goal" value="${Math.min(thisYear, profile.goal)}" max="${profile.goal}"></progress>
    </div>` : ''}
    <div class="panel">
      <div class="panel-h">Books finished</div>
      <div class="seg">${Object.keys(RANGES).map(k => `<button data-r="${k}" class="${k === rangeKey ? 'on' : ''}">${k}</button>`).join('')}</div>
      <div class="big">${rs.total}</div>
      <div class="bigsub">${rs.total === 1 ? 'book' : 'books'} finished in ${RANGES[rangeKey].name}</div>
      <div class="range">${fmtMD(rs.from, rangeKey === '12M')} – ${fmtMD(rs.to, rangeKey === '12M')}</div>
      ${chartSVG(rs.buckets)}
      ${rangeAvg ? `<div class="foot">Average rating in this period: <b>${rangeAvg} ★</b></div>` : ''}
      ${undated ? `<div class="foot">${undated} finished book${undated === 1 ? '' : 's'} without a finish date ${undated === 1 ? 'isn’t' : 'aren’t'} counted here.</div>` : ''}
    </div>`;
}

function renderNudge() {
  const last = +localStorage.getItem(LASTBK) || 0;
  const days = (Date.now() - last) / 864e5;
  $('nudge').innerHTML = books.length >= 3 && days > 30
    ? `<div class="nudge"><span>${last ? 'It’s been a while since your last backup.' : 'You haven’t saved a backup yet.'}</span><button id="nudge-go">Back up</button></div>` : '';
  const g = $('nudge-go'); if (g) g.onclick = openSettings;
}

function setPage(p) {
  page = p; query = ''; $('q').value = '';
  render(); window.scrollTo(0, 0);
}

/* ---------- sheet ---------- */
const sheet = $('sheet'), scrim = $('scrim');
const openSheet = html => { sheet.innerHTML = html; scrim.classList.add('show'); sheet.classList.add('show'); };
const closeSheet = () => {
  scrim.classList.remove('show'); sheet.classList.remove('show');
  applyTheme(profile.color);                 // undo any unsaved color preview
  document.activeElement && document.activeElement.blur();
};
scrim.onclick = closeSheet;

function openEditor(b, forceStatus) {
  const isNew = !b;
  const startStatus = ['reading', 'read', 'want'].includes(page) ? page : 'reading';
  b = b ? {...b} : {id: uid(), title:'', author:'', status: startStatus, rating:0, started:'', finished:'', notes:'', added: Date.now()};
  b.started = b.started || '';
  const setStatus = s => {
    b.status = s;
    if (s === 'reading' && !b.started) b.started = today();
    if (s === 'read' && !b.finished) b.finished = today();
  };
  if (isNew) setStatus(startStatus);
  if (forceStatus) setStatus(forceStatus);
  const draw = () => {
    const s = b.status;
    openSheet(`
      <h2>${isNew ? 'Add book' : 'Edit book'}</h2>
      <div class="seg flush">
        <button data-s="reading" class="${s === 'reading' ? 'on' : ''}">Reading</button>
        <button data-s="read" class="${s === 'read' ? 'on' : ''}">Finished</button>
        <button data-s="want" class="${s === 'want' ? 'on' : ''}">Wishlist</button>
      </div>
      <label>Title</label><input type="text" id="f-title" value="${esc(b.title)}" autocomplete="off" autocapitalize="words">
      <label>Author</label><input type="text" id="f-author" value="${esc(b.author)}" autocomplete="off" autocapitalize="words">
      ${s !== 'want' ? `<label>Date started <span class="opt">optional</span></label><input type="date" id="f-start" value="${esc(b.started)}">` : ''}
      ${s === 'read' ? `
        <label>Date finished</label><input type="date" id="f-date" value="${esc(b.finished)}">
        <label>Rating</label>
        <div class="starpick" id="stars">${[1,2,3,4,5].map(n => `<span data-n="${n}" class="${n <= b.rating ? 'on' : ''}">★</span>`).join('')}</div>` : ''}
      ${s !== 'want' ? `<label>Notes</label><textarea id="f-notes">${esc(b.notes)}</textarea>` : ''}
      <div class="row">
        ${isNew ? '' : '<button class="btn danger" id="del">Delete</button>'}
        <button class="btn ghost" id="cancel">Cancel</button>
        <button class="btn" id="ok">Save</button>
      </div>`);
    sheet.querySelectorAll('[data-s]').forEach(el => el.onclick = () => { grab(); setStatus(el.dataset.s); draw(); });
    const st = $('stars');
    if (st) st.onclick = e => { const n = +e.target.dataset.n; if (!n) return; b.rating = b.rating === n ? 0 : n;
      st.querySelectorAll('span').forEach(s => s.classList.toggle('on', +s.dataset.n <= b.rating)); };
    $('cancel').onclick = closeSheet;
    $('ok').onclick = async () => {
      grab();
      if (!b.title.trim()) { $('f-title').focus(); $('f-title').style.borderColor = 'var(--danger)'; return; }
      if (b.status !== 'read') { b.rating = 0; b.finished = ''; }
      if (b.status === 'want') { b.started = ''; }
      await save(b); closeSheet(); setPage(b.status);
    };
    const d = $('del');
    if (d) d.onclick = async () => { if (confirm('Delete this book?')) { await remove(b.id); closeSheet(); render(); } };
  };
  const grab = () => {
    const g = id => $(id) ? $(id).value : undefined;
    if (g('f-title') !== undefined) b.title = g('f-title').trim();
    if (g('f-author') !== undefined) b.author = g('f-author').trim();
    if (g('f-start') !== undefined) b.started = g('f-start');
    if (g('f-date') !== undefined) b.finished = g('f-date');
    if (g('f-notes') !== undefined) b.notes = g('f-notes').trim();
  };
  draw();
}

/* ---------- profile editor ---------- */
function openProfileEditor() {
  const d = {...profile};
  openSheet(`
    <h2>Customize profile</h2>
    <label>Name <span class="opt">optional</span></label>
    <input type="text" id="p-name" maxlength="30" value="${esc(d.name)}" placeholder="Reader" autocomplete="off">
    <label>Tagline <span class="opt">optional</span></label>
    <input type="text" id="p-tag" maxlength="80" value="${esc(d.tagline)}" placeholder="Currently lost in a book" autocomplete="off">
    <label>Avatar</label>
    <div class="emos">${EMOJIS.map(e => `<button class="emo ${e === d.emoji ? 'on' : ''}" data-e="${e}">${e}</button>`).join('')}</div>
    <label>Accent color</label>
    <div class="sws">${COLOR_KEYS.map(k => `<button class="sw ${k} ${k === d.color ? 'on' : ''}" data-c="${k}" aria-label="${k}"></button>`).join('')}</div>
    <label>Yearly reading goal <span class="opt">optional</span></label>
    <input type="text" id="p-goal" inputmode="numeric" maxlength="3" value="${d.goal || ''}" placeholder="e.g. 24" autocomplete="off">
    <div class="row"><button class="btn ghost" id="p-cancel">Cancel</button><button class="btn" id="p-save">Save</button></div>`);
  sheet.querySelectorAll('[data-e]').forEach(el => el.onclick = () => {
    d.emoji = el.dataset.e; sheet.querySelectorAll('[data-e]').forEach(x => x.classList.toggle('on', x === el)); });
  sheet.querySelectorAll('[data-c]').forEach(el => el.onclick = () => {
    d.color = el.dataset.c; applyTheme(d.color); sheet.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === el)); });
  $('p-cancel').onclick = closeSheet;
  $('p-save').onclick = () => {
    d.name = $('p-name').value.trim(); d.tagline = $('p-tag').value.trim(); d.goal = $('p-goal').value.replace(/\D/g, '');
    profile = cleanProfile(d); saveProfile(); closeSheet(); render();
  };
}

/* ---------- backup / restore ---------- */
async function exportBackup() {
  const data = JSON.stringify({app:'mabooks', version:3, exported:new Date().toISOString(), profile, books}, null, 2);
  const name = `mabooks-backup-${today()}.json`;
  const file = new File([data], name, {type:'application/json'});
  try {
    if (navigator.canShare && navigator.canShare({files:[file]})) {
      await navigator.share({files:[file], title:'MaBooks backup'});
      localStorage.setItem(LASTBK, Date.now()); renderNudge(); return openSettings();
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], {type:'application/json'}));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  localStorage.setItem(LASTBK, Date.now()); renderNudge(); openSettings();
}
function importBackup() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const j = JSON.parse(await inp.files[0].text());
      const list = Array.isArray(j) ? j : j.books;
      if (!Array.isArray(list)) throw 0;
      if (list.length > 20000) throw 0;
      const okAdded = n => (+n > 0 && +n < 4102444800000) ? +n : Date.now();
      const clean = list.filter(b => b && typeof b === 'object' && b.title).map(b => ({
        id: /^[A-Za-z0-9_-]{1,40}$/.test(String(b.id)) ? String(b.id) : uid(),
        title: String(b.title).slice(0, 300), author: String(b.author || '').slice(0, 300),
        status: ['want', 'reading'].includes(b.status) ? b.status : 'read', rating: Math.min(5, Math.max(0, Math.round(+b.rating) || 0)),
        started: isDate(b.started) ? String(b.started) : '', finished: isDate(b.finished) ? String(b.finished) : '', notes: String(b.notes || '').slice(0, 5000), added: okAdded(b.added)}));
      const ids = new Set(books.map(b => b.id));
      const fresh = clean.filter(b => !ids.has(b.id) && ids.add(b.id));
      if (!confirm(`Add ${fresh.length} new book${fresh.length === 1 ? '' : 's'} from this backup? Your current books are kept.`)) return;
      for (const b of fresh) books.push(b);
      if (!Array.isArray(j) && j.profile && isDefaultProfile(profile)) {   // fresh install: bring the profile back too
        profile = cleanProfile(j.profile); saveProfile(); applyTheme(profile.color);
      }
      mirror(); await idbReplace(books); render(); openSettings();
    } catch (e) { alert('That file doesn’t look like a MaBooks backup.'); }
  };
  inp.click();
}
async function openSettings() {
  const last = +localStorage.getItem(LASTBK) || 0;
  let persisted = false;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) {}
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  openSheet(`
    <h2>Backup &amp; safety</h2>
    <div class="set-card">
      <p>${books.length} book${books.length === 1 ? '' : 's'} saved on this device.<br>
      Last backup: ${last ? new Date(last).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'never'}</p>
      <p>Saves a file you can keep in iCloud Drive, Files, or email to yourself. This is what protects you if the phone is lost or reset.</p>
      <div class="row flush"><button class="btn" id="exp">Save backup</button><button class="btn ghost" id="imp">Restore</button></div>
    </div>
    <div class="set-card">
      <p>${standalone ? '<span class="ok">✓</span> Installed on Home Screen — iOS protects its storage from the 7-day clean-up.' : 'Add MaBooks to your Home Screen so it opens like a real app and iOS keeps your data safe.'}<br>
      ${persisted ? '<span class="ok">✓</span> Persistent storage granted.' : ''}</p>
      ${standalone ? '' : `<button class="btn" id="a2hs">Add to Home Screen</button>
      <div class="steps" id="a2hs-steps" hidden>
        <ol>
          <li>Open this page in <b>Safari</b> (not inside another app).</li>
          <li>Tap the <b>Share</b> button, the square with an arrow.</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        </ol>
        ${navigator.share ? '<button class="btn ghost" id="a2hs-share">Open share menu</button>' : ''}
      </div>`}
    </div>
    <div class="row"><button class="btn ghost" id="close">Done</button></div>`);
  $('exp').onclick = exportBackup; $('imp').onclick = importBackup; $('close').onclick = closeSheet;
  const a2 = $('a2hs');
  if (a2) a2.onclick = async () => {
    if (deferredPrompt) {            // Android / desktop Chrome: real install prompt
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) {}
      deferredPrompt = null; return openSettings();
    }
    const st = $('a2hs-steps'); st.hidden = !st.hidden;   // iOS: show the steps
  };
  const sh = $('a2hs-share');
  if (sh) sh.onclick = () => { try { navigator.share({title: 'MaBooks', url: location.href.split('#')[0]}).catch(() => {}); } catch (e) {} };
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; });

/* ---------- wire up ---------- */
$('tabbar').onclick = e => { const t = e.target.closest('[data-page]'); if (t) setPage(t.dataset.page); };
$('q').oninput = e => { query = e.target.value; render(); };
$('fab').onclick = () => openEditor();
$('gear').onclick = openSettings;
$('list').onclick = e => {
  const st = e.target.closest('[data-start]');
  if (st) { e.stopPropagation(); startReading(st.dataset.start); return; }
  const m = e.target.closest('[data-finish]');
  if (m) { e.stopPropagation(); openEditor(books.find(b => b.id === m.dataset.finish), 'read'); return; }
  const c = e.target.closest('.book'); if (c) openEditor(books.find(b => b.id === c.dataset.id));
};
$('page-profile').onclick = e => {
  const r = e.target.closest('[data-r]');
  if (r && RANGES[r.dataset.r] && Object.prototype.hasOwnProperty.call(RANGES, r.dataset.r)) { rangeKey = r.dataset.r; render(); return; }
  if (e.target.closest('#edit-profile')) openProfileEditor();
};

(async () => {
  loadProfile(); applyTheme(profile.color);
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  await load(); render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
