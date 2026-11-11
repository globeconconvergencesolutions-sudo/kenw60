/* KENW60 Project Hub – front end (no build step) */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Event dates are calendar days (YYYY-MM-DD): read them as local dates, not UTC midnight,
// otherwise anyone west of GMT sees the day before.
const parseDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
const fmtDate = d => d ? parseDay(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtTime = d => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const ICON = { image: '🖼️', video: '🎬', audio: '🎧', pdf: '📕', document: '📄', spreadsheet: '📊', presentation: '📽️', text: '📝', other: '📦' };

let ME = null, SPACES = [];
const canEdit = () => ME && ['admin', 'editor'].includes(ME.role);
const canUp = () => ME && ME.canUpload;
const canDown = () => ME && ME.canDownload;
const ownsFile = f => ME && (ME.role === 'admin' || f.uploadedBy === ME.id);

async function api(url, opts = {}) {
  const o = { headers: {}, ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  if (location.protocol === 'file:') throw new Error('Open the hub at http://localhost:3000 – not by double-clicking index.html');
  let r;
  try { r = await fetch(url, o); }
  catch { throw new Error('Cannot reach the hub server. Check the terminal window is still open and running npm start.'); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Please log in'); }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3200);
}
const fail = e => toast(e.message, true);

// ------------------------------------------------------------ modal
function modal(html, onMount) {
  $('#modalCard').innerHTML = html; $('#modal').classList.remove('hidden');
  $('#modalCard').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  onMount && onMount($('#modalCard'));
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalCard').innerHTML = ''; }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });

const spaceOptions = sel => SPACES.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
async function eventOptions(sel, spaceId) {
  const evs = await api('/api/events' + (spaceId ? '?spaceId=' + spaceId : ''));
  return '<option value="">— not linked to an event —</option>' + evs.map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(fmtDate(e.date))} · ${esc(e.title)}</option>`).join('');
}
function currentContext() {
  const [, kind, idv] = location.hash.split('/');
  if (kind === 'space') return { spaceId: idv };
  if (kind === 'event') return { eventId: idv, spaceId: window._ctxSpace };
  return {};
}

// ------------------------------------------------------------ auth
function showLogin() { $('#shell').classList.add('hidden'); $('#login').classList.remove('hidden'); }
// ---- forgot / reset password
function authMode(m) {
  ['login', 'forgot', 'reset'].forEach(k => $('#' + k + 'Form').classList.toggle('hidden', k !== m));
  ['loginErr', 'forgotErr', 'resetErr'].forEach(i => $('#' + i).textContent = '');
}
function resetToken() {
  if (!location.hash.startsWith('#/reset')) return null;
  return new URLSearchParams(location.hash.split('?')[1] || '').get('token');
}
const clearHash = () => history.replaceState(null, '', location.pathname);
async function openReset(token) {
  ME = null; showLogin(); authMode('reset');
  $('#resetFields').classList.add('hidden'); $('#resetFor').textContent = 'Checking your link…';
  const r = await api('/api/reset/check?token=' + encodeURIComponent(token)).catch(() => ({ valid: false }));
  if (r.valid) { $('#resetFor').textContent = `Choose a new password for ${r.email}.`; $('#resetFields').classList.remove('hidden'); $('#resetForm input').focus(); }
  else {
    $('#resetFor').textContent = 'This reset link is invalid, has already been used, or has expired.';
    $('#resetErr').innerHTML = 'Please request a new one: <a class="link-lime" id="askAgain">Forgot password</a>';
    $('#askAgain').onclick = () => { clearHash(); authMode('forgot'); };
  }
}
document.querySelectorAll('.back-link').forEach(a => a.onclick = () => { if (resetToken()) clearHash(); authMode('login'); });
$('#forgotLink').onclick = () => { $('#forgotEmail').value = $('#loginEmail').value; $('#forgotOk').classList.add('hidden'); authMode('forgot'); $('#forgotEmail').focus(); };
$('#forgotForm').onsubmit = async e => {
  e.preventDefault(); const btn = e.target.querySelector('.btn-login'); btn.disabled = true; btn.textContent = 'Sending…'; $('#forgotErr').textContent = '';
  try { const r = await api('/api/forgot', { method: 'POST', body: { email: $('#forgotEmail').value } });
    $('#forgotOk').textContent = r.message; $('#forgotOk').classList.remove('hidden'); btn.textContent = 'Send again'; }
  catch (err) { $('#forgotErr').textContent = err.message; btn.textContent = 'Send reset link'; }
  finally { btn.disabled = false; }
};
$('#resetForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target);
  if (f.get('password') !== f.get('confirm')) return $('#resetErr').textContent = 'The two passwords do not match.';
  const btn = e.target.querySelector('.btn-login'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/api/reset', { method: 'POST', body: { token: resetToken(), password: f.get('password') } });
    const email = ($('#resetFor').textContent.match(/for (.+)\.$/) || [])[1] || '';
    e.target.reset(); clearHash(); authMode('login'); $('#loginEmail').value = email;
    $('#loginOk').textContent = 'Your password has been updated. Sign in with your new password.'; $('#loginOk').classList.remove('hidden'); $('#pwInput').focus();
  } catch (err) { $('#resetErr').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Save new password'; }
};

$('#pwToggle').onclick =() => { const i = $('#pwInput'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#pwToggle').textContent = show ? 'Hide' : 'Show'; };
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('.btn-login');
  btn.disabled = true; btn.textContent = 'Signing in…'; $('#loginOk').classList.add('hidden');
  try { ME = await api('/api/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }); $('#loginErr').textContent = ''; e.target.reset(); boot(); }
  catch (err) { $('#loginErr').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
};
async function boot() {
  const tk = resetToken(); if (tk) return openReset(tk);
  try { ME = await api('/api/me'); } catch { return; }
  $('#login').classList.add('hidden'); $('#shell').classList.remove('hidden');
  document.body.classList.toggle('admin', ME.role === 'admin');
  document.body.classList.toggle('viewer-role', !canEdit());
  document.body.classList.toggle('no-upload', !canUp());
  document.body.classList.toggle('no-download', !canDown());
  renderMe();
  await loadSpaces(); route();
}
async function loadSpaces() {
  SPACES = await api('/api/spaces');
  $('#spaceNav').innerHTML = SPACES.map(s => `<a href="#/space/${s.id}" data-nav="space-${s.id}"><span class="dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</a>`).join('');
}
const GENERIC_NAME = 'System Administrator';
const firstName = () => (ME.name || '').trim().split(/\s+/)[0];
function renderMe() {
  $('#meBox').innerHTML = `<b>${esc(ME.name)}</b><span class="muted">${esc(ME.role)}${ME.org ? ' · ' + esc(ME.org) : ''}</span><div style="margin-top:6px"><a id="profLink">My profile</a><a id="logoutLink">Sign out</a></div>`;
  $('#logoutLink').onclick = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); ME = null; route.guard = null; authMode('login'); showLogin(); };
  $('#profLink').onclick = profileDialog;
}
function profileDialog() {
  modal(`<h2>My profile</h2><form id="prf">
    <label>Full name<input name="name" value="${esc(ME.name === GENERIC_NAME ? '' : ME.name)}" placeholder="e.g. Patrick Kariri" required></label>
    <label>Organisation<input name="org" value="${esc(ME.org || '')}" placeholder="e.g. GlobeCon, UNODC ROEA, KPS"></label>
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>
    <h3 class="section">Change password</h3><form id="pwf"><label>Current password<input type="password" name="current" required></label>
    <label>New password (min 8)<input type="password" name="next" minlength="8" required></label>
    <div class="row"><span class="spacer"></span><button class="btn">Change password</button></div></form>`, m => {
    m.querySelector('#prf').onsubmit = async e => { e.preventDefault();
      try { ME = await api('/api/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); renderMe(); toast('Profile saved'); route(); } catch (err) { fail(err); } };
    m.querySelector('#pwf').onsubmit = async e => { e.preventDefault();
      try { await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Password changed'); } catch (err) { fail(err); } };
  });
}

// ------------------------------------------------------------ routing
window.addEventListener('hashchange', route);
async function route() {
  const tk = resetToken(); if (tk) return openReset(tk);
  if (!ME) return;
  // Leaving the page editor with unsaved changes? Ask first, and stay put if they cancel.
  if (route.guard) {
    if (!route.guard()) { history.replaceState(null, '', route.lastHash || '#/'); return; }
    route.guard = null; window.onbeforeunload = null;
  }
  route.lastHash = location.hash;
  $('#sidebar').classList.remove('open');
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?'); const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(qs || '');
  document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
  const nav = parts[0] === 'space' ? 'space-' + parts[1] : (parts[0] || 'home');
  document.querySelector(`[data-nav="${nav}"]`)?.classList.add('active');
  const v = $('#view'); v.classList.remove('view-in'); v.innerHTML = skeleton();
  const token = (route._t = (route._t || 0) + 1);
  const views = {
    '': () => viewHome(v), space: () => viewSpace(v, parts[1], q.get('tab') || 'media'), events: () => viewEvents(v),
    event: () => viewEvent(v, parts[1]), media: () => viewMedia(v, q.get('kind') || ''), file: () => viewFile(v, parts[1]),
    page: () => parts[2] === 'edit' ? editPage(v, parts[1]) : viewPage(v, parts[1]), members: () => viewMembers(v),
    search: () => viewSearch(v, q.get('q') || ''), settings: () => viewSettings(v)
  };
  try {
    const fn = views[parts[0] || ''];
    if (fn) await fn(); else v.innerHTML = '<div class="empty">Page not found</div>';
  } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  if (token === route._t) animateIn(v);
}

// ------------------------------------------------------------ motion
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function skeleton() {
  return `<div class="skel skel-title"></div><div class="skel skel-line"></div>
    <div class="grid g4" style="margin-top:22px">${'<div class="skel skel-card"></div>'.repeat(4)}</div>
    <div class="grid g3" style="margin-top:22px">${'<div class="skel skel-block"></div>'.repeat(3)}</div>`;
}
function animateIn(v) {
  void v.offsetWidth; v.classList.add('view-in');
  if (reduceMotion) return;
  const items = v.querySelectorAll('.hero, .stat, .space-card, .tile, .li, .card:not(.list):not(.stat):not(.space-card), .tabs, .toolbar, .editor');
  items.forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 14)); el.classList.add('reveal');
    el.addEventListener('animationend', function done(ev) { if (ev.target === el) { el.classList.remove('reveal'); el.removeEventListener('animationend', done); } });
  });
  v.querySelectorAll('[data-count]').forEach(countUp);
}
function countUp(el) {
  const target = +el.dataset.count, suffix = el.dataset.suffix || '', dur = 900, t0 = performance.now();
  if (!target) { el.textContent = '0' + suffix; return; }
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (target % 1 ? (target * e).toFixed(1) : Math.round(target * e)) + suffix; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function daysUntil(d) { return Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000); }
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
$('#searchForm').onsubmit = e => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent($('#searchInput').value); };
document.querySelector('.top-actions').onclick = e => {
  const a = e.target.dataset.act; const c = currentContext();
  if (a === 'upload') uploadDialog(c); if (a === 'new-event') eventDialog(null, c); if (a === 'new-page') pageDialog(c);
};

// ------------------------------------------------------------ shared renderers
function thumb(f) {
  if (f.kind === 'image') return `<div class="thumb"><img loading="lazy" src="/api/files/${f.id}/raw" alt=""></div>`;
  if (f.kind === 'video') return `<div class="thumb"><video preload="metadata" muted src="/api/files/${f.id}/raw#t=1"></video><span class="play">▶</span></div>`;
  return `<div class="thumb"><span class="ico">${ICON[f.kind] || '📦'}</span></div>`;
}
function tiles(files) {
  if (!files.length) return `<div class="card empty">Nothing here yet.${canUp() ? ' Use <b>Upload</b> to add documents, pictures, audio or video.' : ''}</div>`;
  return `<div class="tiles">${files.map(f => `<a class="tile" href="#/file/${f.id}">${thumb(f)}
    <div class="meta"><div class="t" title="${esc(f.title)}">${esc(f.title)}</div>
    <div class="s"><span class="kind k-${f.kind}">${f.kind}</span> · ${fmtSize(f.size)} · ${fmtDate(f.updatedAt)}</div></div></a>`).join('')}</div>`;
}
function eventList(evs) {
  if (!evs.length) return `<div class="card empty">No events yet.</div>`;
  return `<div class="card list">${evs.map(e => { const d = parseDay(e.date);
    return `<a class="li" href="#/event/${e.id}"><div class="date-badge"><div class="m">${d.toLocaleString('en-GB', { month: 'short' })}</div><div class="d">${d.getDate()}</div></div>
    <div class="grow"><div class="t">${esc(e.title)}</div><div class="muted small">${esc(e.location || '')}${e.location ? ' · ' : ''}${esc(spaceName(e.spaceId))}${e.mediaCount !== undefined ? ' · ' + e.mediaCount + ' files' : ''}</div></div></a>`; }).join('')}</div>`;
}
function pageList(pages) {
  if (!pages.length) return `<div class="card empty">No pages yet.${canEdit() ? ' Use <b>+ Page</b> to write meeting minutes, reports or notes online.' : ''}</div>`;
  return `<div class="card list">${pages.map(p => `<a class="li" href="#/page/${p.id}"><span style="font-size:20px">📝</span>
    <div class="grow"><div class="t">${esc(p.title)}</div><div class="muted small">Edited ${fmtTime(p.updatedAt)} by ${esc(p.updatedByName)}${p.revisions ? ' · ' + p.revisions + ' earlier versions' : ''}</div></div></a>`).join('')}</div>`;
}
const spaceName = sid => (SPACES.find(s => s.id === sid) || {}).name || '';
function comments(targetId, label) {
  const box = document.createElement('div'); box.className = 'card section';
  box.innerHTML = `<h3>Comments</h3><div class="clist"></div>
    <form class="cform" style="margin-top:10px"><textarea rows="2" placeholder="Write a comment…" required></textarea><div class="row" style="margin-top:6px"><span class="spacer"></span><button class="btn primary sm">Post</button></div></form>`;
  const load = async () => {
    const cs = await api('/api/comments/' + targetId);
    box.querySelector('.clist').innerHTML = cs.length ? cs.map(c => `<div class="comment"><b>${esc(c.userName)}</b> <span class="muted small">${fmtTime(c.at)}</span>
      ${(c.userId === ME.id || ME.role === 'admin') ? `<a class="small" data-del="${c.id}" style="float:right;cursor:pointer">delete</a>` : ''}<p>${esc(c.text)}</p></div>`).join('') : '<p class="muted">No comments yet.</p>';
    box.querySelectorAll('[data-del]').forEach(a => a.onclick = async () => { try { await api('/api/comments/' + a.dataset.del, { method: 'DELETE' }); load(); } catch (err) { fail(err); } });
  };
  box.querySelector('.cform').onsubmit = async e => { e.preventDefault(); const ta = e.target.querySelector('textarea');
    try { await api('/api/comments/' + targetId, { method: 'POST', body: { text: ta.value, label } }); ta.value = ''; load(); } catch (err) { fail(err); } };
  load(); return box;
}

// ------------------------------------------------------------ views
async function viewHome(v) {
  const d = await api('/api/dashboard'); const s = d.stats;
  const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const generic = ME.name === GENERIC_NAME;
  v.innerHTML = `${generic ? `<div class="card name-prompt"><div><b>Add your name</b><div class="muted small">So the hub can greet you and show your name on uploads, edits and comments.</div></div><button class="btn primary" id="addName">Add my name</button></div>` : ''}
  <section class="hero">
    <span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span>
    <div class="hero-text">
      <div class="hero-eyebrow">PLEAD II · Project KENW60 · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <h1>${greet}${generic ? '' : ', ' + esc(firstName())}<span class="wave">👋</span></h1>
      <p>Shared workspace for the Digital Learning Centre, National Partner Data Centre, Model Witness Rooms and Rescue Centres.</p>
    </div>
    ${d.upcoming[0] ? (() => { const e = d.upcoming[0], n = daysUntil(e.date);
      return `<a class="next-up" href="#/event/${e.id}"><span class="pulse"></span><div><div class="nu-label">Next up · ${n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days'}</div>
        <div class="nu-title">${esc(e.title)}</div><div class="nu-meta">${fmtDate(e.date)}${e.location ? ' · ' + esc(e.location) : ''}</div></div></a>`; })() : ''}
  </section>
  <div class="grid g4 stats">
    ${(() => { const [sz, su] = fmtSize(s.storageBytes).split(' ');
      return [['Members', s.members, '👥'], ['Files', s.files, '📁'], ['Videos', s.videos, '🎬'], ['Audio', s.audio, '🎧'], ['Pictures', s.images, '🖼️'], ['Events', s.events, '📅'], ['Pages', s.pages, '📝'], ['Storage', +sz, '💾', ' ' + su]]
      .map(([l, n, ic, suf = '']) => `<div class="card stat"><span class="stat-ico">${ic}</span><div class="n" data-count="${n}" data-suffix="${suf}">0${suf}</div><div class="l">${l}</div></div>`).join(''); })()}
  </div>
  <div class="section"><h2>Facilities &amp; workstreams</h2><div class="grid g3">
    ${SPACES.map(sp => `<div class="card space-card" style="--c:${esc(sp.color)}" onclick="location.hash='#/space/${sp.id}'"><h3>${esc(sp.name)}</h3><p>${esc(sp.description)}</p>
      <div class="chips"><span class="chip">${sp.counts.files} files</span><span class="chip">${sp.counts.events} events</span><span class="chip">${sp.counts.pages} pages</span></div></div>`).join('')}
  </div></div>
  <div class="section grid g2">
    <div><h2>Latest pictures &amp; videos</h2>${tiles(d.recentMedia)}</div>
    <div><h2>Upcoming events</h2>${eventList(d.upcoming)}
      <h2 class="section">Recent activity</h2><div class="card">${d.activity.length ? d.activity.map(a => `<div class="act"><b>${esc(a.userName)}</b> ${esc(a.action)} <i>${esc(a.target)}</i><div class="muted small">${fmtTime(a.at)}</div></div>`).join('') : '<p class="muted">No activity yet.</p>'}</div></div>
  </div>`;
  $('#addName') && ($('#addName').onclick = profileDialog);
}

async function viewSpace(v, sid, tab) {
  const sp = SPACES.find(s => s.id === sid); if (!sp) throw new Error('Space not found');
  window._ctxSpace = sid;
  const [files, evs, pages] = await Promise.all([api('/api/files?spaceId=' + sid), api('/api/events?spaceId=' + sid), api('/api/pages?spaceId=' + sid)]);
  const media = files.filter(f => ['image', 'video', 'audio'].includes(f.kind)), docs = files.filter(f => !['image', 'video', 'audio'].includes(f.kind));
  const T = { media: ['Pictures, audio & video', media.length], docs: ['Documents', docs.length], events: ['Events', evs.length], pages: ['Pages', pages.length] };
  v.innerHTML = `<div class="page-head"><div><h1><span class="dot" style="display:inline-block;width:12px;height:12px;background:${esc(sp.color)}"></span> ${esc(sp.name)}</h1><p>${esc(sp.description)}</p></div>
    <button class="btn sm admin-only" id="editSpace">Edit space</button></div>
    <div class="tabs">${Object.entries(T).map(([k, [l, n]]) => `<button class="${k === tab ? 'active' : ''}" onclick="location.hash='#/space/${sid}?tab=${k}'">${l} (${n})</button>`).join('')}</div>
    <div id="tabBody"></div>`;
  $('#tabBody').innerHTML = tab === 'docs' ? tiles(docs) : tab === 'events' ? eventList(evs) : tab === 'pages' ? pageList(pages) : tiles(media);
  $('#editSpace').onclick = () => modal(`<h2>Edit space</h2><form id="sf"><label>Name<input name="name" value="${esc(sp.name)}" required></label>
    <label>Description<textarea name="description" rows="3">${esc(sp.description)}</textarea></label><label>Colour<input type="color" name="color" value="${esc(sp.color)}"></label>
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, m => {
    m.querySelector('#sf').onsubmit = async e => { e.preventDefault();
      try { await api('/api/spaces/' + sid, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Space saved'); await loadSpaces(); route(); } catch (err) { fail(err); } };
  });
}

async function viewEvents(v) {
  const evs = await api('/api/events');
  v.innerHTML = `<div class="page-head"><div><h1>Events</h1><p>Site visits, stakeholder meetings, trainings, validation workshops and handovers – with their pictures, recordings and minutes.</p></div>
    <button class="btn primary editor-only" id="ne">+ New event</button></div>${eventList(evs)}`;
  $('#ne') && ($('#ne').onclick = () => eventDialog(null, {}));
}

async function viewEvent(v, eid) {
  const [e, files, pages] = await Promise.all([api('/api/events/' + eid), api('/api/files?eventId=' + eid), api('/api/pages?eventId=' + eid)]);
  window._ctxSpace = e.spaceId;
  v.innerHTML = `<div class="page-head"><div><div class="muted small"><a href="#/space/${e.spaceId}">${esc(spaceName(e.spaceId))}</a> › Event</div>
    <h1>${esc(e.title)}</h1><p><b>${fmtDate(e.date)}</b>${e.location ? ' · ' + esc(e.location) : ''}</p><p style="white-space:pre-wrap">${esc(e.description)}</p></div>
    <div class="row"><span class="editor-only row"><button class="btn" id="ee">Edit</button><button class="btn" id="ep">+ Page</button></span><button class="btn primary upload-only" id="eu">Upload to this event</button></div></div>
    <h2>Media &amp; files (${files.length})</h2>${tiles(files)}
    <h2 class="section">Minutes, notes &amp; reports</h2>${pageList(pages)}`;
  if (canEdit()) {
    $('#ee').onclick = () => eventDialog(e, {});
    $('#ep').onclick = () => pageDialog({ spaceId: e.spaceId, eventId: e.id });
  }
  if (canUp()) $('#eu').onclick = () => uploadDialog({ spaceId: e.spaceId, eventId: e.id });
  v.appendChild(comments(eid, 'event ' + e.title));
}

async function viewMedia(v, kind) {
  const files = await api('/api/files' + (kind ? '?kind=' + kind : ''));
  const kinds = [['', 'All'], ['image', 'Pictures'], ['video', 'Videos'], ['audio', 'Audio'], ['pdf', 'PDF'], ['document', 'Word'], ['spreadsheet', 'Spreadsheets'], ['presentation', 'Slides']];
  v.innerHTML = `<div class="page-head"><div><h1>Media library</h1><p>Every file shared across all facilities.</p></div></div>
    <div class="tabs">${kinds.map(([k, l]) => `<button class="${k === kind ? 'active' : ''}" onclick="location.hash='#/media${k ? '?kind=' + k : ''}'">${l}</button>`).join('')}</div>${tiles(files)}`;
}

async function viewFile(v, fid) {
  const f = await api('/api/files/' + fid);
  const raw = `/api/files/${f.id}/raw`;
  const mine = ownsFile(f), dl = canDown() || f.uploadedBy === ME.id;   // everyone can download their own uploads
  const mayEdit = mine || canEdit(), mayVersion = canUp() && mayEdit;
  // Without download permission: hide download buttons and the browser's own save controls
  const noSave = dl ? '' : ' controlsList="nodownload noplaybackrate" disablePictureInPicture oncontextmenu="return false"';
  let viewer = '';
  if (f.kind === 'image') viewer = `<img src="${raw}" alt="${esc(f.title)}"${dl ? '' : ' draggable="false" oncontextmenu="return false"'}>`;
  else if (f.kind === 'video') viewer = `<video controls preload="metadata" src="${raw}"${noSave}></video>`;
  else if (f.kind === 'audio') viewer = `<audio controls src="${raw}"${noSave}></audio>`;
  else if (f.kind === 'pdf') viewer = `<iframe src="${raw}${dl ? '' : '#toolbar=0&navpanes=0'}"></iframe>`;
  else viewer = `<div class="docview" id="docview"><p class="muted">Loading preview…</p></div>`;
  v.innerHTML = `<div class="page-head"><div><div class="muted small"><a href="#/space/${f.spaceId}">${esc(spaceName(f.spaceId))}</a> › File</div><h1>${esc(f.title)}</h1></div>
    <div class="row">${dl ? `<a class="btn" href="${raw}?download=1">Download</a>` : '<span class="chip" title="Ask an admin if you need a copy">View only – downloads not allowed</span>'}
    ${mayEdit ? '<button class="btn" id="fe">Edit details</button>' : ''}${mayVersion ? '<button class="btn" id="fv">Upload new version</button>' : ''}${mine ? '<button class="btn danger" id="fd">Delete</button>' : ''}</div></div>
    <div class="grid g2"><div><div class="viewer">${viewer}</div>${f.description ? `<div class="card section"><p style="white-space:pre-wrap;margin:0">${esc(f.description)}</p></div>` : ''}<div id="cm"></div></div>
    <div><div class="card"><dl class="kv"><dt>Type</dt><dd><span class="kind k-${f.kind}">${f.kind}</span></dd><dt>File</dt><dd>${esc(f.originalName)}</dd><dt>Size</dt><dd>${fmtSize(f.size)}</dd>
      <dt>Space</dt><dd>${esc(spaceName(f.spaceId))}</dd>${f.eventId ? `<dt>Event</dt><dd><a href="#/event/${f.eventId}">Open event</a></dd>` : ''}
      <dt>Tags</dt><dd>${(f.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join(' ') || '—'}</dd>
      <dt>Uploaded</dt><dd>${fmtTime(f.createdAt)} by ${esc(f.uploadedByName)}</dd><dt>Updated</dt><dd>${fmtTime(f.updatedAt)} by ${esc(f.updatedByName)}</dd></dl></div>
      <div class="card section"><h3>Versions (${f.versions.length})</h3><div class="list">${f.versions.slice().reverse().map(x => `<div class="li"><div class="grow"><b>v${x.n}</b> · ${esc(x.originalName)}<div class="muted small">${fmtTime(x.at)} · ${esc(x.uploadedByName)} · ${fmtSize(x.size)}${x.note ? ' · ' + esc(x.note) : ''}</div></div>${dl ? `<a class="btn sm" href="${raw}?v=${x.n}&download=1">↓</a>` : ''}</div>`).join('')}</div></div>
    </div></div>`;
  if (!['image', 'video', 'audio', 'pdf'].includes(f.kind)) {
    const p = await api(`/api/files/${f.id}/preview`);
    $('#docview').innerHTML = p.html ? `<div class="prose">${p.html}</div>` : p.text !== undefined ? `<pre>${esc(p.text)}</pre>`
      : `<div class="empty">${ICON[f.kind]} No in-browser preview for this file type.<br><br>${dl ? `<a class="btn primary" href="${raw}?download=1">Download to open</a>` : 'Your account is view-only for downloads. Ask an admin if you need a copy.'}</div>`;
  }
  $('#cm').appendChild(comments(f.id, f.title));
  if (mine) $('#fd').onclick = async () => { if (!confirm('Delete this file and all its versions? This cannot be undone.')) return;
    try { await api('/api/files/' + f.id, { method: 'DELETE' }); toast('Deleted'); location.hash = '#/space/' + f.spaceId; } catch (err) { fail(err); } };
  if (!mayEdit) return;
  $('#fe').onclick = async () => modal(`<h2>Edit details</h2><form id="ff"><label>Title<input name="title" value="${esc(f.title)}" required></label>
    <label>Description<textarea name="description" rows="3">${esc(f.description)}</textarea></label><label>Tags (comma separated)<input name="tags" value="${esc((f.tags || []).join(', '))}"></label>
    <label>Space<select name="spaceId">${spaceOptions(f.spaceId)}</select></label><label>Event<select name="eventId">${await eventOptions(f.eventId)}</select></label>
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, m => {
    m.querySelector('#ff').onsubmit = async e => { e.preventDefault();
      try { await api('/api/files/' + f.id, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Saved'); route(); } catch (err) { fail(err); } };
  });
  if (mayVersion) $('#fv').onclick = () => modal(`<h2>Upload new version</h2><p class="muted">The current file is kept in the version history.</p><form id="vf"><label>File<input type="file" name="file" required></label>
    <label>What changed?<input name="note" placeholder="e.g. Comments from UNODC incorporated"></label><div class="progress hidden"><div></div></div>
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Upload</button></div></form>`, m => {
    m.querySelector('#vf').onsubmit = async e => { e.preventDefault(); try { await xhrUpload(`/api/files/${f.id}/version`, new FormData(e.target), m.querySelector('.progress')); closeModal(); toast('New version uploaded'); route(); } catch (err) { fail(err); } };
  });
}

async function viewPage(v, pid) {
  const p = await api('/api/pages/' + pid);
  v.innerHTML = `<div class="page-head"><div><div class="muted small"><a href="#/space/${p.spaceId}">${esc(spaceName(p.spaceId))}</a>${p.eventId ? ` › <a href="#/event/${p.eventId}">Event</a>` : ''} › Page</div>
    <h1>${esc(p.title)}</h1><p class="small">Last edited ${fmtTime(p.updatedAt)} by ${esc(p.updatedByName)}</p></div>
    <div class="row"><button class="btn" id="hist">History (${p.history.length})</button><button class="btn" onclick="window.print()">Print</button>
    <span class="editor-only row"><a class="btn primary" href="#/page/${p.id}/edit">Edit</a><button class="btn danger" id="pd">Delete</button></span></div></div>
    <div class="card prose">${p.content || '<p class="muted">Empty page.</p>'}</div>`;
  v.appendChild(comments(p.id, p.title));
  $('#hist').onclick = () => modal(`<h2>Page history</h2>${p.history.length ? `<div class="list">${p.history.map((h, i) => `<div class="li"><div class="grow"><b>${esc(h.title)}</b><div class="muted small">${fmtTime(h.at)} · ${esc(h.byName)}</div></div>
    <button class="btn sm" data-view="${i}">View</button>${canEdit() ? `<button class="btn sm" data-restore="${i}">Restore</button>` : ''}</div>`).join('')}</div>` : '<p class="muted">No earlier versions.</p>'}
    <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-close>Close</button></div>`, m => {
    m.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { const h = p.history[b.dataset.view]; modal(`<h2>${esc(h.title)}</h2><p class="muted small">${fmtTime(h.at)} · ${esc(h.byName)}</p><div class="prose">${h.content}</div><div class="row"><span class="spacer"></span><button class="btn" data-close>Close</button></div>`); });
    m.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => { const h = p.history[b.dataset.restore];
      try { await api('/api/pages/' + p.id, { method: 'PUT', body: { title: h.title, content: h.content } }); closeModal(); toast('Version restored'); route(); } catch (err) { fail(err); } });
  });
  $('#pd') && ($('#pd').onclick = async () => { if (!confirm('Delete this page?')) return;
    try { await api('/api/pages/' + p.id, { method: 'DELETE' }); toast('Page deleted'); location.hash = '#/space/' + p.spaceId + '?tab=pages'; } catch (err) { fail(err); } });
}

async function editPage(v, pid) {
  const p = await api('/api/pages/' + pid);
  const tools = [['bold', '<b>B</b>'], ['italic', '<i>I</i>'], ['underline', '<u>U</u>'], ['|'], ['formatBlock:H2', 'H2'], ['formatBlock:H3', 'H3'], ['formatBlock:P', '¶'], ['formatBlock:BLOCKQUOTE', '❝'], ['|'],
    ['insertUnorderedList', '• List'], ['insertOrderedList', '1. List'], ['|'], ['createLink', '🔗 Link'], ['insertTable', '▦ Table'], ['insertImage', '🖼 Image'], ['|'], ['undo', '↶'], ['redo', '↷'], ['removeFormat', 'Clear']];
  v.innerHTML = `<div class="page-head"><div style="flex:1;min-width:260px"><input id="pt" value="${esc(p.title)}" style="font-size:20px;font-weight:600"></div>
    <div class="row"><span class="muted small" id="saveState"></span><a class="btn" href="#/page/${p.id}">Cancel</a><button class="btn primary" id="ps">Save</button></div></div>
    <div class="toolbar">${tools.map(([c, l]) => c === '|' ? '<span style="width:1px;background:#cbd5e1;margin:0 4px"></span>' : `<button type="button" data-cmd="${c}">${l}</button>`).join('')}</div>
    <div class="editor prose" id="ed" contenteditable="true">${p.content}</div>`;
  const ed = $('#ed'); let dirty = false; ed.oninput = () => { dirty = true; $('#saveState').textContent = 'Unsaved changes'; };
  document.querySelector('.toolbar').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return; const [cmd, arg] = b.dataset.cmd.split(':'); ed.focus();
    if (cmd === 'createLink') { const u = prompt('Link URL'); if (u) document.execCommand('createLink', false, u); }
    else if (cmd === 'insertImage') pickImage();
    else if (cmd === 'insertTable') { const r = +prompt('Rows', 3) || 3, c = +prompt('Columns', 3) || 3;
      document.execCommand('insertHTML', false, '<table>' + Array.from({ length: r }, () => '<tr>' + '<td>&nbsp;</td>'.repeat(c) + '</tr>').join('') + '</table><p></p>'); }
    else document.execCommand(cmd, false, arg ? `<${arg}>` : null);
    dirty = true;
  };
  function pickImage() {   // upload picture into the space and embed it
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => { const fd = new FormData(); fd.append('files', inp.files[0]); fd.append('spaceId', p.spaceId); if (p.eventId) fd.append('eventId', p.eventId);
      try { const [f] = await api('/api/files', { method: 'POST', body: fd }); ed.focus(); document.execCommand('insertHTML', false, `<img src="/api/files/${f.id}/raw" alt="">`); } catch (err) { fail(err); } };
    inp.click();
  }
  let base = p.updatedAt;
  const doSave = async () => {
    try { const r = await api('/api/pages/' + p.id, { method: 'PUT', body: { title: $('#pt').value, content: ed.innerHTML, baseUpdatedAt: base } });
      base = r.updatedAt; dirty = false; return true; } catch (err) { fail(err); return false; }
  };
  $('#ps').onclick = async () => { if (await doSave()) { toast('Saved'); location.hash = '#/page/' + p.id; } };
  window.onbeforeunload = () => dirty ? true : undefined;   // closing the tab / reloading
  route.guard = () => !dirty || confirm('You have unsaved changes on this page. Leave without saving?');   // moving elsewhere in the hub
}

async function viewMembers(v) {
  const users = await api('/api/users');
  const yn = b => b ? '<span class="perm yes">✓ Yes</span>' : '<span class="perm no">✕ No</span>';
  v.innerHTML = `<div class="page-head"><div><h1>Members</h1><p><b>Admin</b> manages members and spaces · <b>Editor</b> edits events and pages · <b>Viewer</b> views and comments.
    Upload and download are switched on or off for each member. Everyone can delete the files they uploaded.</p></div>
    <button class="btn primary" id="nu">+ Add member</button></div>
    <div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th>Role</th><th>Upload</th><th>Download</th><th>Status</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.org)}</td><td>${esc(u.role)}</td><td>${yn(u.canUpload)}</td><td>${yn(u.canDownload)}</td><td>${u.active ? 'Active' : '<span class="muted">Disabled</span>'}</td><td><button class="btn sm" data-u="${u.id}">Edit</button></td></tr>`).join('')}
    </tbody></table></div>`;
  const form = (u = {}) => `<form id="uf"><label>Full name<input name="name" value="${esc(u.name || '')}" required></label>
    <label>Email (used to sign in and for password resets)<input type="email" name="email" value="${esc(u.email || '')}" required></label><label>Organisation<input name="org" value="${esc(u.org || '')}" placeholder="e.g. UNODC ROEA, KPS, GlobeCon"></label>
    <label>Role<select name="role">${['viewer', 'editor', 'admin'].map(r => `<option ${u.role === r || (!u.id && r === 'editor') ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <fieldset class="perms"><legend>File permissions</legend>
      <label class="check"><input type="checkbox" name="canUpload" ${(u.id ? u.canUpload : true) ? 'checked' : ''}> Can upload files <span class="muted small">(and delete what they uploaded)</span></label>
      <label class="check"><input type="checkbox" name="canDownload" ${(u.id ? u.canDownload : true) ? 'checked' : ''}> Can download files <span class="muted small">(if off, they can only view/play files inside the hub)</span></label>
      <p class="muted small" style="margin:4px 0 0">Admins can always upload and download.</p></fieldset>
    ${u.id ? `<label>Status<select name="active"><option value="true" ${u.active ? 'selected' : ''}>Active</option><option value="false" ${!u.active ? 'selected' : ''}>Disabled</option></select></label>` : ''}
    <label>${u.id ? 'Reset password (leave blank to keep)' : 'Temporary password'}<input name="password" ${u.id ? '' : 'required minlength="8"'}></label>
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`;
  // unchecked boxes are left out of FormData, so read them explicitly
  const formBody = f => ({ ...Object.fromEntries(new FormData(f)), canUpload: f.canUpload.checked, canDownload: f.canDownload.checked });
  $('#nu').onclick = () => modal('<h2>Add member</h2>' + form(), m => m.querySelector('#uf').onsubmit = async e => { e.preventDefault();
    try { await api('/api/users', { method: 'POST', body: formBody(e.target) }); closeModal(); toast('Member added – share the email and temporary password with them'); route(); } catch (err) { fail(err); } });
  v.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { const u = users.find(x => x.id === b.dataset.u);
    modal('<h2>Edit member</h2>' + form(u), m => m.querySelector('#uf').onsubmit = async e => { e.preventDefault(); const body = formBody(e.target);
      body.active = body.active === 'true'; if (!body.password) delete body.password;
      try { const r = await api('/api/users/' + u.id, { method: 'PUT', body }); if (r.id === ME.id) { ME = r; renderMe(); }
        closeModal(); toast('Saved'); route(); } catch (err) { fail(err); } }); });
}

async function viewSettings(v) {
  const s = await api('/api/settings/email');
  const ready = s.host && s.user && s.passSet;
  v.innerHTML = `<div class="page-head"><div><h1>Email settings</h1>
    <p>The mailbox the hub uses to send password-reset emails to members.</p></div>
    <span class="status-pill ${ready ? 'on' : 'off'}">${ready ? '● Email is set up' : '● Not set up yet'}</span></div>
    <div class="grid g2">
      <form class="card" id="mailForm">
        <div class="settings-grid">
          <label>Mail server (SMTP)<input name="host" value="${esc(s.host)}" placeholder="e.g. mail.globeconcs.com"></label>
          <label>Port<select name="port">${[465, 587, 25, 2525].map(p => `<option ${+s.port === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label>Email username<input name="user" value="${esc(s.user)}" placeholder="e.g. noreply@globeconcs.com" autocomplete="off"></label>
          <label>Email password<input name="pass" type="password" placeholder="${s.passSet ? '•••••••• (saved – leave blank to keep)' : 'Mailbox or app password'}" autocomplete="new-password"></label>
          <label>Send from<input name="from" value="${esc(s.from)}" placeholder="Same as username if blank"></label>
          <label>Website address<input name="siteUrl" value="${esc(s.siteUrl)}" placeholder="e.g. https://kenw60.globeconcs.com"></label>
        </div>
        <p class="muted small" style="margin-top:-4px">The website address is used in the reset link. Leave it blank while testing on this computer; set it once the hub is online.</p>
        ${!s.siteUrl && !/^(localhost|127\.|\[::1\])/.test(location.host) ? '<p class="error">Set the Website address: for security, reset emails are not sent from an online hub until it is filled in.</p>' : ''}
        ${s.library ? '' : '<p class="error">The email library is missing. Close the hub and run <b>npm.cmd install</b> (or double-click start-hub.bat).</p>'}
        <div class="row" style="margin-top:8px"><button class="btn primary">Save settings</button><button type="button" class="btn" id="testMail">Send test email to me</button><span class="muted small" id="mailStatus"></span></div>
      </form>
      <div class="hint"><b>Common settings</b>
        <table>
          <tr><td><b>GlobeCon / cPanel mail</b></td><td>mail.globeconcs.com · port 465 · full email address and its password</td></tr>
          <tr><td><b>Gmail / Google Workspace</b></td><td>smtp.gmail.com · port 465 · use an <b>App Password</b> (Google account → Security → 2-Step Verification → App passwords), not your normal password</td></tr>
          <tr><td><b>Microsoft 365 / Outlook</b></td><td>smtp.office365.com · port 587 · full email address and password (SMTP sending must be allowed for the mailbox)</td></tr>
        </table>
        <p style="margin:10px 0 0">Tip: create a dedicated mailbox such as <b>noreply@globeconcs.com</b> for the hub.</p>
      </div>
    </div>`;
  $('#mailForm').onsubmit = async e => { e.preventDefault();
    try { await api('/api/settings/email', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Email settings saved'); route(); } catch (err) { fail(err); } };
  $('#testMail').onclick = async () => { const b = $('#testMail'); b.disabled = true; $('#mailStatus').textContent = 'Sending…';
    try { const r = await api('/api/settings/email/test', { method: 'POST' }); $('#mailStatus').textContent = ''; toast(r.message); }
    catch (err) { $('#mailStatus').textContent = ''; fail(err); } finally { b.disabled = false; } };
}

async function viewSearch(v, q) {
  $('#searchInput').value = q;
  const r = await api('/api/search?q=' + encodeURIComponent(q));
  v.innerHTML = `<h1>Results for “${esc(q)}”</h1><h2 class="section">Files (${r.files.length})</h2>${tiles(r.files)}
    <h2 class="section">Pages (${r.pages.length})</h2>${pageList(r.pages.map(p => ({ ...p, updatedByName: '' })))}
    <h2 class="section">Events (${r.events.length})</h2>${eventList(r.events)}`;
}

// ------------------------------------------------------------ dialogs
function xhrUpload(url, fd, bar) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('POST', url);
    bar && bar.classList.remove('hidden');
    x.upload.onprogress = e => { if (bar && e.lengthComputable) bar.firstElementChild.style.width = (e.loaded / e.total * 100) + '%'; };
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? res(d) : rej(new Error(d.error || 'Upload failed')); };
    x.onerror = () => rej(new Error('Network error')); x.send(fd);
  });
}
async function uploadDialog(ctx) {
  const sid = ctx.spaceId || SPACES[0]?.id;
  modal(`<h2>Upload files</h2><form id="upf">
    <div class="drop" id="drop">Drag documents, pictures, audio or video here<br>or <b>click to choose</b><input type="file" name="files" multiple hidden></div>
    <div id="picked" class="small muted" style="margin-bottom:10px"></div>
    <label>Space<select name="spaceId" id="upSpace">${spaceOptions(sid)}</select></label>
    <label>Event<select name="eventId" id="upEvent">${await eventOptions(ctx.eventId, sid)}</select></label>
    <label>Description<textarea name="description" rows="2" placeholder="What is this? Who is in it? Where was it taken?"></textarea></label>
    <label>Tags (comma separated)<input name="tags" placeholder="e.g. site visit, training, handover"></label>
    <div class="progress hidden"><div></div></div>
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Upload</button></div></form>`, m => {
    const inp = m.querySelector('input[type=file]'), drop = m.querySelector('#drop');
    const show = () => m.querySelector('#picked').textContent = [...inp.files].map(f => `${f.name} (${fmtSize(f.size)})`).join(' · ');
    drop.onclick = () => inp.click(); inp.onchange = show;
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); inp.files = e.dataTransfer.files; show(); };
    m.querySelector('#upSpace').onchange = async e => m.querySelector('#upEvent').innerHTML = await eventOptions(null, e.target.value);
    m.querySelector('#upf').onsubmit = async e => { e.preventDefault(); if (!inp.files.length) return toast('Choose at least one file', true);
      const btn = e.target.querySelector('.primary'); btn.disabled = true; btn.textContent = 'Uploading…';
      try { const r = await xhrUpload('/api/files', new FormData(e.target), m.querySelector('.progress')); closeModal(); toast(`${r.length} file(s) uploaded`); await loadSpaces(); route(); }
      catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Upload'; } };
  });
}
function eventDialog(ev, ctx) {
  const e0 = ev || { date: new Date().toISOString().slice(0, 10), spaceId: ctx.spaceId };
  modal(`<h2>${ev ? 'Edit event' : 'New event'}</h2><form id="evf"><label>Title<input name="title" value="${esc(e0.title || '')}" placeholder="e.g. Site assessment – PSTC Ruiru" required></label>
    <div class="row" style="align-items:flex-start"><label style="flex:1">Date<input type="date" name="date" value="${esc(e0.date)}" required></label><label style="flex:2">Location<input name="location" value="${esc(e0.location || '')}"></label></div>
    <label>Space<select name="spaceId">${spaceOptions(e0.spaceId)}</select></label>
    <label>Description<textarea name="description" rows="4" placeholder="Purpose, participants, key outcomes">${esc(e0.description || '')}</textarea></label>
    <div class="row">${ev ? '<button type="button" class="btn danger" id="evd">Delete</button>' : ''}<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, m => {
    m.querySelector('#evf').onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
      try { const r = ev ? await api('/api/events/' + ev.id, { method: 'PUT', body }) : await api('/api/events', { method: 'POST', body });
        closeModal(); toast('Event saved'); await loadSpaces(); ev ? route() : location.hash = '#/event/' + r.id; } catch (err) { fail(err); } };
    ev && (m.querySelector('#evd').onclick = async () => { if (!confirm('Delete this event? Its files stay in the space.')) return;
      try { await api('/api/events/' + ev.id, { method: 'DELETE' }); closeModal(); toast('Event deleted'); await loadSpaces(); location.hash = '#/space/' + ev.spaceId + '?tab=events'; } catch (err) { fail(err); } });
  });
}
async function pageDialog(ctx) {
  const sid = ctx.spaceId || SPACES[0]?.id;
  modal(`<h2>New page</h2><p class="muted">Write minutes, reports, checklists or notes that members can edit together online.</p><form id="pf">
    <label>Title<input name="title" placeholder="e.g. Minutes – Inception meeting with UNODC" required></label>
    <label>Space<select name="spaceId" id="pSpace">${spaceOptions(sid)}</select></label><label>Event<select name="eventId" id="pEvent">${await eventOptions(ctx.eventId, sid)}</select></label>
    <div class="row"><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create &amp; edit</button></div></form>`, m => {
    m.querySelector('#pSpace').onchange = async e => m.querySelector('#pEvent').innerHTML = await eventOptions(null, e.target.value);
    m.querySelector('#pf').onsubmit = async e => { e.preventDefault();
      try { const p = await api('/api/pages', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); await loadSpaces(); location.hash = '#/page/' + p.id + '/edit'; } catch (err) { fail(err); } };
  });
}

boot().then(() => { if (!ME) showLogin(); });
