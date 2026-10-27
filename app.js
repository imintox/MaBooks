(() => {
'use strict';
const DB = 'shelf', STORE = 'books', MIRROR = 'shelf-mirror', LASTBK = 'shelf-last-backup';
let books = [], tab = 'read', query = '';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : '';

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

/* ---------- render ---------- */
function render() {
  const read = books.filter(b => b.status === 'read'), want = books.filter(b => b.status === 'want');
  $('n-read').textContent = read.length; $('n-want').textContent = want.length;
  const y = new Date().getFullYear();
  const thisYear = read.filter(b => (b.finished || '').startsWith(y)).length;
  $('stats').textContent = read.length ? `${read.length} read · ${thisYear} in ${y}` : 'Your physical library';
  $('tab-read').classList.toggle('on', tab === 'read');
  $('tab-want').classList.toggle('on', tab === 'want');

  const q = query.trim().toLowerCase();
  let list = (tab === 'read' ? read : want).filter(b => !q || (b.title + ' ' + b.author + ' ' + b.notes).toLowerCase().includes(q));
  list.sort(tab === 'read'
    ? (a, b) => (b.finished || '').localeCompare(a.finished || '') || b.added - a.added
    : (a, b) => b.added - a.added);

  $('list').innerHTML = list.length ? list.map(b => `
    <div class="book" data-id="${esc(b.id)}">
      <div class="t">${esc(b.title)}</div>
      ${b.author ? `<div class="a">${esc(b.author)}</div>` : ''}
      ${tab === 'read' ? `<div class="m">
          ${b.rating ? `<span class="stars">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>` : ''}
          ${b.finished ? `<span>${fmtDate(b.finished)}</span>` : ''}</div>`
        : `<div class="m"><span>Added ${fmtDate(new Date(b.added).toISOString().slice(0,10))}</span>
            <button class="mark" data-mark="${esc(b.id)}">Mark as read</button></div>`}
      ${tab === 'read' && b.notes ? `<div class="note">${esc(b.notes)}</div>` : ''}
    </div>`).join('')
    : `<div class="empty">${q ? 'No matches.' : tab === 'read' ? 'No books logged yet.<br>Tap + to add one you’ve read.' : 'Nothing on your list.<br>Tap + to add a book you want to read.'}</div>`;

  renderNudge();
}
function renderNudge() {
  const last = +localStorage.getItem(LASTBK) || 0;
  const days = (Date.now() - last) / 864e5;
  $('nudge').innerHTML = books.length >= 3 && days > 30
    ? `<div class="nudge"><span>${last ? 'It’s been a while since your last backup.' : 'You haven’t saved a backup yet.'}</span><button id="nudge-go">Back up</button></div>` : '';
  const g = $('nudge-go'); if (g) g.onclick = openSettings;
}

/* ---------- sheet ---------- */
const sheet = $('sheet'), scrim = $('scrim');
const openSheet = html => { sheet.innerHTML = html; scrim.classList.add('show'); sheet.classList.add('show'); };
const closeSheet = () => { scrim.classList.remove('show'); sheet.classList.remove('show'); document.activeElement && document.activeElement.blur(); };
scrim.onclick = closeSheet;

function openEditor(b, forceStatus) {
  const isNew = !b;
  b = b ? {...b} : {id: uid(), title:'', author:'', status: tab, rating:0, finished:'', notes:'', added: Date.now()};
  if (forceStatus) { b.status = forceStatus; if (forceStatus === 'read' && !b.finished) b.finished = today(); }
  const draw = () => {
    const read = b.status === 'read';
    openSheet(`
      <h2>${isNew ? 'Add book' : 'Edit book'}</h2>
      <div class="seg flush">
        <button data-s="read" class="${read ? 'on' : ''}">Read</button>
        <button data-s="want" class="${!read ? 'on' : ''}">Want to read</button>
      </div>
      <label>Title</label><input type="text" id="f-title" value="${esc(b.title)}" autocomplete="off" autocapitalize="words">
      <label>Author</label><input type="text" id="f-author" value="${esc(b.author)}" autocomplete="off" autocapitalize="words">
      ${read ? `
        <label>Date finished</label><input type="date" id="f-date" value="${esc(b.finished)}">
        <label>Rating</label>
        <div class="starpick" id="stars">${[1,2,3,4,5].map(n => `<span data-n="${n}" class="${n <= b.rating ? 'on' : ''}">★</span>`).join('')}</div>
        <label>Notes</label><textarea id="f-notes">${esc(b.notes)}</textarea>` : ''}
      <div class="row">
        ${isNew ? '' : '<button class="btn danger" id="del">Delete</button>'}
        <button class="btn ghost" id="cancel">Cancel</button>
        <button class="btn" id="ok">Save</button>
      </div>`);
    sheet.querySelectorAll('[data-s]').forEach(el => el.onclick = () => { grab(); b.status = el.dataset.s;
      if (b.status === 'read' && !b.finished) b.finished = today(); draw(); });
    const st = $('stars');
    if (st) st.onclick = e => { const n = +e.target.dataset.n; if (!n) return; b.rating = b.rating === n ? 0 : n;
      st.querySelectorAll('span').forEach(s => s.classList.toggle('on', +s.dataset.n <= b.rating)); };
    $('cancel').onclick = closeSheet;
    $('ok').onclick = async () => {
      grab();
      if (!b.title.trim()) { $('f-title').focus(); $('f-title').style.borderColor = 'var(--danger)'; return; }
      if (b.status === 'want') { b.rating = 0; }
      await save(b); closeSheet(); tab = b.status; $('q').value = ''; query = ''; render();
    };
    const d = $('del');
    if (d) d.onclick = async () => { if (confirm('Delete this book?')) { await remove(b.id); closeSheet(); render(); } };
  };
  const grab = () => {
    const g = id => $(id) ? $(id).value : undefined;
    if (g('f-title') !== undefined) b.title = g('f-title').trim();
    if (g('f-author') !== undefined) b.author = g('f-author').trim();
    if (g('f-date') !== undefined) b.finished = g('f-date');
    if (g('f-notes') !== undefined) b.notes = g('f-notes').trim();
  };
  draw();
}

/* ---------- backup / restore ---------- */
async function exportBackup() {
  const data = JSON.stringify({app:'mabooks', version:1, exported:new Date().toISOString(), books}, null, 2);
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
      const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s) : '';
      const okAdded = n => (+n > 0 && +n < 4102444800000) ? +n : Date.now();
      const clean = list.filter(b => b && typeof b === 'object' && b.title).map(b => ({
        id: /^[A-Za-z0-9_-]{1,40}$/.test(String(b.id)) ? String(b.id) : uid(),
        title: String(b.title).slice(0, 300), author: String(b.author || '').slice(0, 300),
        status: b.status === 'want' ? 'want' : 'read', rating: Math.min(5, Math.max(0, Math.round(+b.rating) || 0)),
        finished: okDate(b.finished), notes: String(b.notes || '').slice(0, 5000), added: okAdded(b.added)}));
      const ids = new Set(books.map(b => b.id));
      const fresh = clean.filter(b => !ids.has(b.id) && ids.add(b.id));
      if (!confirm(`Add ${fresh.length} new book${fresh.length === 1 ? '' : 's'} from this backup? Your current books are kept.`)) return;
      for (const b of fresh) books.push(b);
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

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; });

/* ---------- wire up ---------- */
$('tab-read').onclick = () => { tab = 'read'; render(); };
$('tab-want').onclick = () => { tab = 'want'; render(); };
$('q').oninput = e => { query = e.target.value; render(); };
$('fab').onclick = () => openEditor();
$('gear').onclick = openSettings;
$('list').onclick = e => {
  const m = e.target.closest('[data-mark]');
  if (m) { e.stopPropagation(); openEditor(books.find(b => b.id === m.dataset.mark), 'read'); return; }
  const c = e.target.closest('.book'); if (c) openEditor(books.find(b => b.id === c.dataset.id));
};

(async () => {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  await load(); render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
})();
