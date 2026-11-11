/**
 * KENW60 Project Hub
 * PLEAD II – Kenya Prisons Service / UNODC
 * Members portal: view, upload and edit documents, pictures, audio and video of project events.
 *
 * Run:  npm install  &&  npm start      ->  http://localhost:3000
 */
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const mammoth = require('mammoth');
const sanitizeHtml = require('sanitize-html');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------- config
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '2048', 10);
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ROLES = ['viewer', 'editor', 'admin'];
const MIN_PASSWORD = 8;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const SESSION_SECRET = process.env.SESSION_SECRET || getOrCreateSecret();

function getOrCreateSecret() {
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

// ---------------------------------------------------------------- tiny JSON database
const id = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();

let db = {
  users: [], spaces: [], events: [], files: [], pages: [], comments: [], activity: []
};
if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };

let saveTimer = null;
function writeDb() {
  saveTimer = null;
  const json = JSON.stringify(db, null, 1);
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    // Windows/OneDrive can lock files during sync – fall back to a direct write, retry if still locked
    try { fs.writeFileSync(DB_FILE, json); }
    catch (e2) { console.error('Could not save database, retrying:', e2.code); setTimeout(save, 1000); }
  }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeDb, 150);
}
// Write any pending change immediately (used on shutdown so a quick Ctrl+C never loses the last edit)
function flushDb() { if (saveTimer) { clearTimeout(saveTimer); writeDb(); } }
function log(user, action, target) {
  db.activity.unshift({ id: id(), at: now(), userId: user.id, userName: user.name, action, target });
  db.activity = db.activity.slice(0, 500);
  save();
}

// ---------------------------------------------------------------- admin reset:  npm run reset-admin
if (process.argv.includes('--reset-admin')) {
  const email = (process.env.ADMIN_EMAIL || 'admin@globeconcs.com').toLowerCase();
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass || pass.length < 12) {
    console.error('Set ADMIN_PASSWORD (at least 12 characters) before resetting an admin.\n' +
      '  PowerShell:  $env:ADMIN_PASSWORD="YourStrongPassword"; npm.cmd run reset-admin\n' +
      '  Linux/macOS: ADMIN_PASSWORD="YourStrongPassword" npm run reset-admin');
    process.exit(1);
  }
  let u = db.users.find(x => x.email === email);
  if (!u) { u = { id: id(), name: 'System Administrator', email, org: 'GlobeCon Convergence Solutions', createdAt: now() }; db.users.push(u); }
  Object.assign(u, { role: 'admin', active: true, passHash: bcrypt.hashSync(pass, 10) });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
  console.log(`\n  Admin reset. Sign in with: ${email} / ${pass}\n  Now run: npm start  (or npm.cmd start)\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- seed (first run)
if (db.users.length === 0) {
  const email = (process.env.ADMIN_EMAIL || 'admin@globeconcs.com').toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
  db.users.push({
    id: id(), name: 'System Administrator', email, org: 'GlobeCon Convergence Solutions',
    role: 'admin', passHash: bcrypt.hashSync(pass, 10), active: true, createdAt: now()
  });
  console.log(`\n  First run: admin account created -> ${email} / ${pass}\n  Change this password after logging in.\n`);
}
if (db.spaces.length === 0) {
  // Facilities and workstreams from the PLEAD II KENW60 Inception Report
  [
    ['PSTC Ruiru – Digital Learning Centre', 'Prison Staff Training College, Ruiru. LMS, e-learning content, connectivity, power resilience and trainer readiness for KPS personnel.', '#2563eb'],
    ['National Partner ICT Data Centre – Nairobi', 'Hosting, network, power, cooling, security, backup and recovery for the national partner data centre.', '#7c3aed'],
    ['Model Witness Rooms – Nakuru & Kisumu', 'Audiovisual quality, remote testimony links, privacy and site-specific functional requirements.', '#0d9488'],
    ['Rescue Centres – Kiambu, Embu & Kisumu', 'ICT needs, connectivity, power, user profiles and support for services delivered at each centre.', '#d97706'],
    ['Nairobi Witness Room – Installation Advisory', 'Installation schedule, testing, commissioning and handover of ICT components.', '#db2777'],
    ['Project Management & Reporting', 'Inception report, work plan, stakeholder engagement, decision and issue logs, progress reports – UNODC ROEA and KPS.', '#475569']
  ].forEach(([name, description, color]) => db.spaces.push({ id: id(), name, description, color, createdAt: now() }));
  save();
}

// Milestones from the Draft Inception Report v0.1 (25 Oct 2026). Added once; edit dates in the app as they are confirmed.
db.meta = db.meta || {};
if (!db.meta.milestonesSeeded) {
  const sp = prefix => (db.spaces.find(s => s.name.startsWith(prefix)) || db.spaces[0]).id;
  const admin = db.users.find(u => u.role === 'admin');
  const TBC = '\n\nDate is provisional (deliverable deadline in the Draft Inception Report). Update once confirmed with UNODC.';
  [
    ['2026-10-12', 'Assignment start', 'Nairobi', 'Project Management', 'Start of the assignment period (12 Oct – 30 Dec 2026, 50 working days).'],
    ['2026-10-25', 'Draft Inception Report v0.1 issued', 'Nairobi', 'Project Management', 'Draft Inception Report prepared by the ICT Infrastructure Specialist. Upload the report and reviewer comments here.'],
    ['2026-11-13', 'Inception meeting – UNODC ROEA & KPS', 'Nairobi', 'Project Management', 'Confirm scope, TOR interpretation, deliverables, roles, schedule, site access and approval routes. Record decisions in the minutes (Table 15 decisions log). Deliverable A1.' + TBC],
    ['2026-11-13', 'Technical assessment – PSTC Ruiru Digital Learning Centre', 'PSTC, Ruiru', 'PSTC Ruiru', 'Baseline, evidence, gap analysis and recommendations: LMS, connectivity, power resilience, devices, trainer readiness. Deliverable A2.' + TBC],
    ['2026-11-13', 'Technical assessment – National Partner ICT Data Centre', 'Nairobi', 'National Partner', 'Baseline of hosting, network, power, cooling, security, backup and recovery. Deliverable A2.' + TBC],
    ['2026-12-04', 'Site visit – Model Witness Room, Nakuru', 'Nakuru', 'Model Witness', 'Audiovisual quality, remote testimony links, privacy and site-specific requirements. Deliverable B1.' + TBC],
    ['2026-12-04', 'Site visit – Model Witness Room, Kisumu', 'Kisumu', 'Model Witness', 'Audiovisual quality, remote testimony links, privacy and site-specific requirements. Deliverable B1.' + TBC],
    ['2026-12-04', 'Site visit – Rescue Centre, Kiambu', 'Kiambu', 'Rescue Centres', 'ICT needs, connectivity, power, user profiles and support arrangements. Deliverable B1.' + TBC],
    ['2026-12-04', 'Site visit – Rescue Centre, Embu', 'Embu', 'Rescue Centres', 'ICT needs, connectivity, power, user profiles and support arrangements. Deliverable B1.' + TBC],
    ['2026-12-04', 'Site visit – Rescue Centre, Kisumu', 'Kisumu', 'Rescue Centres', 'ICT needs, connectivity, power, user profiles and support arrangements. Deliverable B1.' + TBC],
    ['2026-12-04', 'Validation – technical TORs & specifications', 'Nairobi', 'Project Management', 'Validate requirements, specifications, compliance criteria and acceptance approach for the procurement packages. Deliverable B2.' + TBC],
    ['2026-12-30', 'Procurement technical review support', 'Nairobi', 'Project Management', 'Authorised technical review/evaluation support and outstanding matters. Deliverable C1.' + TBC],
    ['2026-12-30', 'Nairobi Witness Room – installation, testing & handover', 'Nairobi', 'Nairobi Witness Room', 'Installation observations, test evidence, commissioning and handover status. Deliverable C2.' + TBC]
  ].forEach(([date, title, location, space, description]) =>
    db.events.push({ id: id(), title, date, location, spaceId: sp(space), description, createdBy: admin && admin.id, createdAt: now() }));
  db.meta.milestonesSeeded = true;
  save();
}

// ---------------------------------------------------------------- email (password reset)
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { console.warn('  nodemailer not installed – run "npm install" to enable password-reset emails.'); }

// Mailbox credentials are stored separately from the project database. Keep DATA_DIR private.
// Environment variables take priority (recommended for production deployments).
const SMTP_SECRET_FILE = path.join(DATA_DIR, '.smtp-password');
function storedSmtpPassword() {
  try { return fs.readFileSync(SMTP_SECRET_FILE, 'utf8').trim(); } catch { return ''; }
}
function saveSmtpPassword(password) {
  fs.writeFileSync(SMTP_SECRET_FILE, password, { mode: 0o600 });
  try { fs.chmodSync(SMTP_SECRET_FILE, 0o600); } catch { /* Windows ACLs differ */ }
}
// Upgrade any existing database-stored SMTP password without losing its configuration.
if (db.meta.smtp && db.meta.smtp.pass) {
  if (!storedSmtpPassword()) saveSmtpPassword(db.meta.smtp.pass);
  delete db.meta.smtp.pass;
  save();
}
function mailConfig() {
  const s = db.meta.smtp || {};
  return {
    host: process.env.SMTP_HOST || s.host || '', port: +(process.env.SMTP_PORT || s.port || 465),
    user: process.env.SMTP_USER || s.user || '', pass: process.env.SMTP_PASS || storedSmtpPassword(),
    from: process.env.MAIL_FROM || s.from || s.user || '', siteUrl: process.env.SITE_URL || s.siteUrl || ''
  };
}
async function sendMail(to, subject, html, text) {
  if (!nodemailer) throw new Error('Email library missing – run npm install');
  const c = mailConfig();
  if (!c.host || !c.user) throw new Error('Email is not set up yet (Administration → Email settings)');
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000 });
  const from = c.from.includes('<') ? c.from : `"KENW60 Project Hub" <${c.from}>`;
  await t.sendMail({ from, to, subject, html, text });
}
const escH = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function emailLayout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#eef2f7;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#13284d;padding:24px 28px">
      <div style="color:#8dc63f;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase">PLEAD II · Project KENW60</div>
      <div style="color:#ffffff;font-size:22px;font-weight:800;margin-top:6px">KENW60 Project Hub</div></td></tr>
    <tr><td style="height:4px;background:#8dc63f"></td></tr>
    <tr><td style="padding:28px">
      <h1 style="font-size:20px;margin:0 0 14px;color:#13284d">${escH(title)}</h1>${bodyHtml}</td></tr>
    <tr><td style="padding:16px 28px;background:#f6f8fb;color:#64748b;font-size:12px">Programme for Legal Empowerment and Aid Delivery, Phase II · Kenya Prisons Service · UNODC<br>Hosted by GlobeCon Convergence Solutions</td></tr>
  </table></td></tr></table></body></html>`;
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// Simple in-memory sliding-window throttle (password-reset requests, failed logins)
function throttle(windowMs, max) {
  const hits = new Map();
  setInterval(() => { const cut = Date.now() - windowMs; for (const [k, t] of hits) { const r = t.filter(x => x > cut); r.length ? hits.set(k, r) : hits.delete(k); } }, 60e3).unref();
  return {
    blocked: k => (hits.get(k) || []).filter(t => Date.now() - t < windowMs).length >= max,
    hit: k => hits.set(k, [...(hits.get(k) || []).filter(t => Date.now() - t < windowMs), Date.now()]),
    clear: k => hits.delete(k)
  };
}
const forgotHits = throttle(15 * 60e3, 3);   // max 3 reset emails per address per 15 minutes
const loginFails = throttle(15 * 60e3, 10);  // max 10 wrong passwords per account per 15 minutes
const loginFailsIp = throttle(15 * 60e3, 50); // higher per-IP limit: whole offices often share one public IP
const isLoopback = host => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i.test(host || '');

// ---------------------------------------------------------------- helpers
function kindOf(mime, name) {
  const ext = path.extname(name || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (['.doc', '.docx', '.odt', '.rtf'].includes(ext)) return 'document';
  if (['.xls', '.xlsx', '.csv', '.ods'].includes(ext)) return 'spreadsheet';
  if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'presentation';
  if (mime.startsWith('text/') || ['.txt', '.md', '.json'].includes(ext)) return 'text';
  return 'other';
}

// HTML sanitiser for rich-text pages and Word previews: an allow-list of formatting tags only,
// so scripts, event handlers and javascript: links can never reach another member's browser.
const SANITIZE_OPTS = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
    'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'font'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start', 'type'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },   // Word previews embed pictures as data: URIs
  allowProtocolRelative: false,
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) }
};
const sanitize = (html = '') => sanitizeHtml(String(html), SANITIZE_OPTS);

// Per-member file permissions (set by an admin on the Members page).
// Admins can always upload and download. If a flag was never set, the role decides:
//   upload   -> editors yes, viewers no
//   download -> everyone yes
const toBool = v => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
const perms = u => ({
  canUpload: u.role === 'admin' || (u.canUpload !== undefined ? !!u.canUpload : u.role === 'editor'),
  canDownload: u.role === 'admin' || (u.canDownload !== undefined ? !!u.canDownload : true)
});
const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, org: u.org, role: u.role, active: u.active, createdAt: u.createdAt, ...perms(u) });
const userName = uid => (db.users.find(u => u.id === uid) || {}).name || 'Unknown';

const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(new Date(d + 'T00:00:00Z'));
const spaceExists = sid => db.spaces.some(s => s.id === sid);
const eventExists = eid => db.events.some(e => e.id === eid);
const activeAdmins = () => db.users.filter(u => u.role === 'admin' && u.active);

// ---------------------------------------------------------------- sessions
// Small file-backed session store: members stay signed in across server restarts, expired sessions are pruned.
// (Express's default MemoryStore loses every session on restart and is not meant for production.)
class FileStore extends session.Store {
  constructor(file) {
    super();
    this.file = file; this.data = {}; this.timer = null;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new or unreadable – start empty */ }
    this.prune();
    setInterval(() => this.prune(), 15 * 60e3).unref();
  }
  expired(s) { return !s || !s.cookie || (s.cookie.expires && new Date(s.cookie.expires) < new Date()); }
  prune() { let n = 0; for (const [k, s] of Object.entries(this.data)) if (this.expired(s)) { delete this.data[k]; n++; } if (n) this.persist(); }
  persist() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 200); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    try { fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 }); } catch (e) { console.error('Could not save sessions:', e.code); }
  }
  get(sid, cb) { const s = this.data[sid]; if (s && this.expired(s)) { delete this.data[sid]; this.persist(); return cb(null, null); } cb(null, s || null); }
  set(sid, s, cb) { this.data[sid] = JSON.parse(JSON.stringify(s)); this.persist(); cb && cb(null); }
  destroy(sid, cb) { delete this.data[sid]; this.persist(); cb && cb(null); }
  touch(sid, s, cb) { if (this.data[sid]) { this.data[sid].cookie = s.cookie; this.persist(); } cb && cb(null); }
  destroyUser(uid, keepSid) { for (const [k, s] of Object.entries(this.data)) if (s.uid === uid && k !== keepSid) delete this.data[k]; this.persist(); }
}
const sessionStore = new FileStore(SESSIONS_FILE);

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.COOKIE_SECURE === 'true') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '5mb' }));
app.use(session({
  store: sessionStore, name: 'kenw60.sid',
  secret: SESSION_SECRET, resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS, secure: process.env.COOKIE_SECURE === 'true' }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => res.json({ ok: true }));

function auth(req, res, next) {
  const u = db.users.find(x => x.id === req.session.uid && x.active);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  req.user = u; next();
}
const canEdit = (req, res, next) => ['admin', 'editor'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Your role is view-only' });
const isAdmin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' });
const canUpload = (req, res, next) => perms(req.user).canUpload ? next() : res.status(403).json({ error: 'You do not have permission to upload files' });
// The uploader of a file (or an admin) manages it: delete, new version, edit details
const ownsFile = (u, f) => u.role === 'admin' || f.uploadedBy === u.id;

// ---- auth
app.post('/api/login', (req, res, next) => {
  const email = String(req.body.email || '').toLowerCase().trim(), password = String(req.body.password || '');
  const ipKey = 'ip:' + req.ip, emailKey = 'em:' + email;
  if (loginFails.blocked(emailKey) || loginFailsIp.blocked(ipKey))
    return res.status(429).json({ error: 'Too many failed sign-in attempts. Wait 15 minutes or use “Forgot password?”.' });
  const u = db.users.find(x => x.email === email);
  if (!u || !u.active || !bcrypt.compareSync(password, u.passHash)) {
    loginFails.hit(emailKey); loginFailsIp.hit(ipKey);
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  loginFails.clear(emailKey);
  // New session id on sign-in (prevents session fixation)
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.uid = u.id;
    res.json(publicUser(u));
  });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.clearCookie('kenw60.sid').json({ ok: true })));
app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));
// ---- forgot / reset password
app.post('/api/forgot', async (req, res) => {
  const generic = { ok: true, message: 'If that email belongs to a member, a reset link has been sent. Please check your inbox and spam folder.' };
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Enter your email address' });
  if (forgotHits.blocked(email)) return res.json(generic);
  forgotHits.hit(email);
  const u = db.users.find(x => x.email === email && x.active);
  if (!u) { await new Promise(r => setTimeout(r, 400)); return res.json(generic); }
  // The reset link must point at a trusted address. Never build it from the request's Host header on a
  // public server – an attacker could forge that header and receive the victim's reset token.
  let base = mailConfig().siteUrl;
  if (!base) {
    if (!isLoopback(req.get('host'))) {
      console.error('[password reset] Not sent: set the Website address (Administration → Email settings) or SITE_URL first.');
      return res.json(generic);
    }
    base = `${req.protocol}://${req.get('host')}`;
  }
  base = base.replace(/\/+$/, '');
  const token = crypto.randomBytes(32).toString('hex');
  u.resetHash = sha256(token); u.resetExpires = Date.now() + 60 * 60e3; save();
  const link = `${base}/#/reset?token=${token}`;
  const html = emailLayout('Reset your password', `
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Hello ${escH(u.name)},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 22px">We received a request to reset the password for your KENW60 Project Hub account (<b>${escH(u.email)}</b>). Click the button below to choose a new password.</p>
    <p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#8dc63f;color:#13284d;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:8px">Reset my password</a></p>
    <p style="font-size:13px;line-height:1.6;color:#475569;margin:0 0 10px">This link expires in <b>1 hour</b> and can only be used once.</p>
    <p style="font-size:13px;line-height:1.6;color:#475569;margin:0 0 10px">If you did not ask for this, you can ignore this email – your password will not change.</p>
    <p style="font-size:12px;line-height:1.6;color:#94a3b8;margin:18px 0 0;word-break:break-all">If the button does not work, copy this link into your browser:<br>${escH(link)}</p>`);
  const text = `Hello ${u.name},\n\nReset your KENW60 Project Hub password using this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`;
  try { await sendMail(u.email, 'Reset your KENW60 Project Hub password', html, text); console.log(`[password reset] Email sent to ${u.email}`); }
  catch (e) {
    // Do not disclose recovery tokens in logs, even when delivery fails.
    if (u.resetHash === sha256(token)) { delete u.resetHash; delete u.resetExpires; save(); }
    console.error(`[password reset] Delivery failed (${e.code || 'mail error'}). Check SMTP settings.`);
  }
  res.json(generic);
});
const findByToken = token => token && db.users.find(u => u.resetHash && u.resetHash === sha256(String(token)) && u.resetExpires > Date.now() && u.active);
app.get('/api/reset/check', (req, res) => {
  const u = findByToken(req.query.token);
  res.json(u ? { valid: true, name: u.name, email: u.email } : { valid: false });
});
app.post('/api/reset', async (req, res) => {
  const u = findByToken(req.body.token);
  if (!u) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  const pw = String(req.body.password || '');
  if (pw.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  u.passHash = bcrypt.hashSync(pw, 10); delete u.resetHash; delete u.resetExpires; save();
  sessionStore.destroyUser(u.id);   // sign out everywhere else after a reset
  loginFails.clear('em:' + u.email);
  log(u, 'reset their password', 'by email link');
  sendMail(u.email, 'Your KENW60 Project Hub password was changed', emailLayout('Password changed', `
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px">Hello ${escH(u.name)},</p>
    <p style="font-size:15px;line-height:1.6;margin:0">Your KENW60 Project Hub password was changed on ${new Date().toLocaleString('en-GB')}. If this was not you, contact the project administrator immediately.</p>`),
    `Your KENW60 Project Hub password was changed. If this was not you, contact the project administrator.`).catch(() => {});
  res.json({ ok: true });
});

// ---- email settings (admin)
app.get('/api/settings/email', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const c = mailConfig(); res.json({ host: c.host, port: c.port, user: c.user, from: c.from, siteUrl: c.siteUrl, passSet: !!c.pass, library: !!nodemailer });
});
app.put('/api/settings/email', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const siteUrl = String(req.body.siteUrl || '').trim().replace(/\/+$/, '');
  if (siteUrl && !/^https?:\/\/[^\s/?#]+$/i.test(siteUrl))
    return res.status(400).json({ error: 'Website address must look like https://kenw60.globeconcs.com (no path)' });
  const s = db.meta.smtp || {};
  ['host', 'user', 'from'].forEach(k => { s[k] = String(req.body[k] || '').trim(); });
  s.siteUrl = siteUrl;
  s.port = +req.body.port || 465;
  if (req.body.pass) saveSmtpPassword(String(req.body.pass));
  delete s.pass;
  db.meta.smtp = s; save(); log(req.user, 'updated', 'email settings');
  res.json({ ok: true });
});
app.post('/api/settings/email/test', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    await sendMail(req.user.email, 'KENW60 Project Hub – test email', emailLayout('Email is working', `<p style="font-size:15px;line-height:1.6;margin:0">This is a test from the KENW60 Project Hub. Password-reset emails will now be delivered to members.</p>`), 'Email is working.');
    res.json({ ok: true, message: `Test email sent to ${req.user.email}` });
  } catch (e) { res.status(400).json({ error: 'Could not send: ' + e.message }); }
});

app.put('/api/me', auth, (req, res) => {
  const name = String(req.body.name || '').trim(), org = String(req.body.org || '').trim();
  if (!name) return res.status(400).json({ error: 'Please enter your name' });
  req.user.name = name.slice(0, 100); req.user.org = org.slice(0, 150); save();
  res.json(publicUser(req.user));
});
app.post('/api/me/password', auth, (req, res) => {
  const { current, next: np } = req.body;
  if (!bcrypt.compareSync(String(current || ''), req.user.passHash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (!np || String(np).length < MIN_PASSWORD) return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters` });
  req.user.passHash = bcrypt.hashSync(String(np), 10); save();
  sessionStore.destroyUser(req.user.id, req.sessionID);   // sign out other devices, keep this one
  res.json({ ok: true });
});

// ---- users (admin)
app.get('/api/users', auth, isAdmin, (req, res) => res.json(db.users.map(publicUser)));
app.post('/api/users', auth, isAdmin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100), org = String(req.body.org || '').trim().slice(0, 150);
  const email = String(req.body.email || '').toLowerCase().trim(), password = String(req.body.password || '');
  const role = req.body.role || 'editor';
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Role must be viewer, editor or admin' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  if (db.users.some(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
  const u = { id: id(), name, email, org, role, passHash: bcrypt.hashSync(password, 10), active: true, createdAt: now(),
    canUpload: toBool(req.body.canUpload), canDownload: toBool(req.body.canDownload) };
  db.users.push(u); log(req.user, 'added member', name);
  res.json(publicUser(u));
});
app.put('/api/users/:id', auth, isAdmin, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const role = b.role !== undefined ? b.role : u.role;
  const active = b.active !== undefined ? toBool(b.active) : u.active;
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Role must be viewer, editor or admin' });
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  if (b.password && String(b.password).length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  if (u.id === req.user.id && (role !== 'admin' || !active)) return res.status(400).json({ error: 'You cannot remove your own admin access' });
  if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && activeAdmins().length <= 1)
    return res.status(400).json({ error: 'The hub must keep at least one active admin' });
  let email = u.email;
  if (b.email !== undefined) {
    email = String(b.email).toLowerCase().trim();
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (db.users.some(x => x.email === email && x.id !== u.id)) return res.status(400).json({ error: 'Another member already uses that email' });
  }
  // all checks passed – apply
  if (email !== u.email) { delete u.resetHash; delete u.resetExpires; u.email = email; }
  if (b.name !== undefined) u.name = String(b.name).trim().slice(0, 100);
  if (b.org !== undefined) u.org = String(b.org).trim().slice(0, 150);
  u.role = role; u.active = active;
  ['canUpload', 'canDownload'].forEach(k => { if (b[k] !== undefined) u[k] = toBool(b[k]); });
  if (b.canUpload !== undefined || b.canDownload !== undefined) log(req.user, 'changed file permissions for', u.name);
  if (b.password) { u.passHash = bcrypt.hashSync(String(b.password), 10); sessionStore.destroyUser(u.id, req.sessionID); }
  if (!active) sessionStore.destroyUser(u.id);
  save(); res.json(publicUser(u));
});

// ---- spaces (facilities / workstreams)
app.get('/api/spaces', auth, (req, res) => res.json(db.spaces.map(s => ({
  ...s,
  counts: {
    files: db.files.filter(f => f.spaceId === s.id).length,
    events: db.events.filter(e => e.spaceId === s.id).length,
    pages: db.pages.filter(p => p.spaceId === s.id).length
  }
}))));
const validColor = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
app.post('/api/spaces', auth, isAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Space name is required' });
  const s = { id: id(), name: name.slice(0, 120), description: String(req.body.description || '').slice(0, 1000),
    color: validColor(req.body.color) ? req.body.color : '#2563eb', createdAt: now() };
  db.spaces.push(s); log(req.user, 'created space', s.name); res.json(s);
});
app.put('/api/spaces/:id', auth, isAdmin, (req, res) => {
  const s = db.spaces.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.body.name !== undefined && !String(req.body.name).trim()) return res.status(400).json({ error: 'Space name is required' });
  if (req.body.color !== undefined && !validColor(req.body.color)) return res.status(400).json({ error: 'Colour must be a hex value such as #2563eb' });
  if (req.body.name !== undefined) s.name = String(req.body.name).trim().slice(0, 120);
  if (req.body.description !== undefined) s.description = String(req.body.description).slice(0, 1000);
  if (req.body.color !== undefined) s.color = req.body.color;
  log(req.user, 'edited space', s.name); res.json(s);
});

// ---- events
app.get('/api/events', auth, (req, res) => {
  let list = db.events;
  if (req.query.spaceId) list = list.filter(e => e.spaceId === req.query.spaceId);
  res.json(list.map(e => ({ ...e, createdByName: userName(e.createdBy), mediaCount: db.files.filter(f => f.eventId === e.id).length }))
    .sort((a, b) => b.date.localeCompare(a.date)));
});
app.get('/api/events/:id', auth, (req, res) => {
  const e = db.events.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  res.json({ ...e, createdByName: userName(e.createdBy) });
});
function eventFields(b, current = {}) {
  const e = {
    title: b.title !== undefined ? String(b.title).trim().slice(0, 200) : current.title,
    date: b.date !== undefined ? String(b.date) : current.date,
    location: b.location !== undefined ? String(b.location).trim().slice(0, 200) : (current.location || ''),
    spaceId: b.spaceId !== undefined ? b.spaceId : current.spaceId,
    description: b.description !== undefined ? String(b.description).slice(0, 10000) : (current.description || '')
  };
  if (!e.title || !e.date || !e.spaceId) return { error: 'Title, date and space are required' };
  if (!validDate(e.date)) return { error: 'Date must be a valid date (YYYY-MM-DD)' };
  if (!spaceExists(e.spaceId)) return { error: 'That space does not exist' };
  return { e };
}
app.post('/api/events', auth, canEdit, (req, res) => {
  const r = eventFields(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  const e = { id: id(), ...r.e, createdBy: req.user.id, createdAt: now() };
  db.events.push(e); log(req.user, 'created event', e.title); res.json(e);
});
app.put('/api/events/:id', auth, canEdit, (req, res) => {
  const e = db.events.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const r = eventFields(req.body, e);
  if (r.error) return res.status(400).json({ error: r.error });
  Object.assign(e, r.e);
  log(req.user, 'edited event', e.title); res.json(e);
});
app.delete('/api/events/:id', auth, canEdit, (req, res) => {
  const e = db.events.find(x => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  db.events = db.events.filter(x => x.id !== e.id);
  db.files.forEach(f => { if (f.eventId === e.id) f.eventId = null; });
  db.pages.forEach(p => { if (p.eventId === e.id) p.eventId = null; });
  db.comments = db.comments.filter(c => c.targetId !== e.id);
  log(req.user, 'deleted event', e.title); res.json({ ok: true });
});

// ---- files (documents, pictures, audio, video)
// Stored names are random ids plus a cleaned extension – never anything from the uploader that could form a path.
const safeExt = name => { const x = path.extname(name || '').toLowerCase(); return /^\.[a-z0-9]{1,10}$/.test(x) ? x : ''; };
// Browsers send their own guess of a file's type; normalise names to valid UTF-8 (multer gives latin1).
const fixName = n => { try { const u = Buffer.from(n, 'latin1').toString('utf8'); return u.includes('�') ? n : u; } catch { return n; } };
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => { file.originalname = fixName(file.originalname); cb(null, id() + safeExt(file.originalname)); }
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });
const removeUploads = req => [].concat(req.files || [], req.file || []).forEach(f => { try { fs.rmSync(f.path, { force: true }); } catch { /* already gone */ } });

const fileOut = f => ({ ...f, uploadedByName: userName(f.uploadedBy), updatedByName: userName(f.updatedBy), versionCount: f.versions.length });

app.get('/api/files', auth, (req, res) => {
  let list = db.files;
  const { spaceId, eventId, kind, q } = req.query;
  if (spaceId) list = list.filter(f => f.spaceId === spaceId);
  if (eventId) list = list.filter(f => f.eventId === eventId);
  if (kind) list = list.filter(f => f.kind === kind);
  if (q) { const s = q.toLowerCase(); list = list.filter(f => [f.title, f.description, f.originalName, (f.tags || []).join(' ')].join(' ').toLowerCase().includes(s)); }
  res.json(list.map(fileOut).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});
app.get('/api/files/:id', auth, (req, res) => {
  const f = db.files.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  res.json({ ...fileOut(f), versions: f.versions.map(v => ({ ...v, uploadedByName: userName(v.uploadedBy) })) });
});
app.post('/api/files', auth, canUpload, upload.array('files', 50), (req, res) => {
  const { spaceId, eventId = null, description = '', tags = '' } = req.body;
  if (!spaceId || !spaceExists(spaceId)) { removeUploads(req); return res.status(400).json({ error: 'Choose a space' }); }
  if (eventId && !eventExists(eventId)) { removeUploads(req); return res.status(400).json({ error: 'That event does not exist' }); }
  if (!(req.files || []).length) return res.status(400).json({ error: 'Choose at least one file' });
  const created = req.files.map(up => {
    const v = { n: 1, stored: up.filename, size: up.size, mime: up.mimetype, originalName: up.originalname, uploadedBy: req.user.id, at: now() };
    const f = {
      id: id(), title: path.parse(up.originalname).name, description, tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      spaceId, eventId: eventId || null, kind: kindOf(up.mimetype, up.originalname),
      stored: up.filename, originalName: up.originalname, mime: up.mimetype, size: up.size,
      uploadedBy: req.user.id, updatedBy: req.user.id, createdAt: now(), updatedAt: now(), versions: [v]
    };
    db.files.push(f); return f;
  });
  if (created.length) log(req.user, `uploaded ${created.length} file(s)`, created.map(f => f.originalName).join(', '));
  res.json(created);
});
// Replace with a new version (keeps history)
app.post('/api/files/:id/version', auth, canUpload, upload.single('file'), (req, res) => {
  const f = db.files.find(x => x.id === req.params.id);
  if (!f || !req.file) { removeUploads(req); return res.status(f ? 400 : 404).json({ error: f ? 'File missing' : 'Not found' }); }
  if (!ownsFile(req.user, f) && req.user.role !== 'editor') { removeUploads(req); return res.status(403).json({ error: 'Only the person who uploaded this file can replace it' }); }
  const up = req.file;
  f.versions.push({ n: f.versions.length + 1, stored: up.filename, size: up.size, mime: up.mimetype, originalName: up.originalname, uploadedBy: req.user.id, at: now(), note: req.body.note || '' });
  Object.assign(f, { stored: up.filename, originalName: up.originalname, mime: up.mimetype, size: up.size, kind: kindOf(up.mimetype, up.originalname), updatedBy: req.user.id, updatedAt: now() });
  log(req.user, 'uploaded new version of', f.title); res.json(fileOut(f));
});
app.put('/api/files/:id', auth, (req, res) => {
  const f = db.files.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (!ownsFile(req.user, f) && req.user.role !== 'editor') return res.status(403).json({ error: 'Only the person who uploaded this file can edit it' });
  const b = req.body;
  if (b.title !== undefined && !String(b.title).trim()) return res.status(400).json({ error: 'Title cannot be empty' });
  if (b.spaceId !== undefined && !spaceExists(b.spaceId)) return res.status(400).json({ error: 'That space does not exist' });
  if (b.eventId && !eventExists(b.eventId)) return res.status(400).json({ error: 'That event does not exist' });
  if (b.title !== undefined) f.title = String(b.title).trim().slice(0, 200);
  if (b.description !== undefined) f.description = String(b.description || '').slice(0, 10000);
  if (b.spaceId !== undefined) f.spaceId = b.spaceId;
  if (b.eventId !== undefined) f.eventId = b.eventId || null;
  if (req.body.tags !== undefined) f.tags = String(req.body.tags).split(',').map(t => t.trim()).filter(Boolean);
  f.updatedBy = req.user.id; f.updatedAt = now();
  log(req.user, 'edited details of', f.title); res.json(fileOut(f));
});
app.delete('/api/files/:id', auth, (req, res) => {
  const f = db.files.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (!ownsFile(req.user, f)) return res.status(403).json({ error: 'You can only delete files you uploaded' });
  f.versions.forEach(v => fs.rm(path.join(UPLOAD_DIR, v.stored), () => {}));
  db.files = db.files.filter(x => x.id !== f.id);
  db.comments = db.comments.filter(c => c.targetId !== f.id);
  log(req.user, 'deleted file', f.title); res.json({ ok: true });
});
// Stream / view (supports HTTP range requests so video & audio can seek)
app.get('/api/files/:id/raw', auth, (req, res) => {
  const f = db.files.find(x => x.id === req.params.id);
  if (!f) return res.status(404).end();
  const v = req.query.v ? f.versions.find(x => String(x.n) === req.query.v) : null;
  const stored = v ? v.stored : f.stored;
  const name = v ? v.originalName : f.originalName;
  if (req.query.v && !v) return res.status(404).json({ error: 'Version not found' });
  // Members without download permission can still view/play the current file in the hub,
  // but cannot save it or open earlier versions. The uploader can always download their own file.
  const mayDownload = perms(req.user).canDownload || f.uploadedBy === req.user.id;
  if (!mayDownload && (req.query.download || v)) return res.status(403).json({ error: 'You do not have permission to download files' });
  const full = path.join(UPLOAD_DIR, stored);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'The stored file is missing on the server' });
  res.setHeader('Cache-Control', 'private, ' + (mayDownload ? 'max-age=0' : 'no-store'));
  // Uploaded content is untrusted: run it in a sandbox so an uploaded HTML/SVG file can never execute script
  // with a member's session. Types that browsers would render as active content are always downloaded instead.
  // (PDFs are exempt: Chrome refuses to show sandboxed PDFs, and its PDF viewer is already isolated from the page.)
  const mime = String(v ? v.mime : f.mime || '').toLowerCase();
  if (mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
  const active = /(html|xml|svg|javascript|ecmascript)/.test(mime) || /\.(html?|xhtml|svg|xml|js|mjs)$/i.test(name);
  if (req.query.download || active) {
    if (active && !mayDownload) return res.status(403).json({ error: 'This file type cannot be previewed. Ask an admin for a copy.' });
    res.attachment(name);
    res.type(active ? 'application/octet-stream' : (mime || 'application/octet-stream'));
  } else {
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.type(mime || 'application/octet-stream');
  }
  res.sendFile(full, err => { if (err && !res.headersSent) res.status(err.status || 500).end(); });
});
// Word document preview in the browser
app.get('/api/files/:id/preview', auth, async (req, res) => {
  const f = db.files.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const p = path.join(UPLOAD_DIR, f.stored);
  try {
    if (f.originalName.toLowerCase().endsWith('.docx')) {
      const r = await mammoth.convertToHtml({ path: p });
      return res.json({ html: sanitize(r.value) });
    }
    if (f.kind === 'text') {   // read only the first 500 KB – a huge log file must not stall the server
      const fd = fs.openSync(p, 'r'), buf = Buffer.alloc(Math.min(500000, fs.fstatSync(fd).size));
      try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
      return res.json({ text: buf.toString('utf8') });
    }
    res.json({});
  } catch (e) { res.json({ error: 'Preview not available for this file' }); }
});

// ---- pages (rich-text content edited online, with history)
const pageOut = p => ({ ...p, updatedByName: userName(p.updatedBy), createdByName: userName(p.createdBy) });
app.get('/api/pages', auth, (req, res) => {
  let list = db.pages;
  if (req.query.spaceId) list = list.filter(p => p.spaceId === req.query.spaceId);
  if (req.query.eventId) list = list.filter(p => p.eventId === req.query.eventId);
  res.json(list.map(p => { const { history, content, ...rest } = pageOut(p); return { ...rest, revisions: history.length }; })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});
app.get('/api/pages/:id', auth, (req, res) => {
  const p = db.pages.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  // sanitise again on the way out, so content saved by an older version of the hub is also safe
  res.json({ ...pageOut(p), content: sanitize(p.content), history: p.history.map(h => ({ ...h, content: sanitize(h.content), byName: userName(h.by) })) });
});
app.post('/api/pages', auth, canEdit, (req, res) => {
  const { spaceId, eventId = null, content = '' } = req.body;
  const title = String(req.body.title || '').trim().slice(0, 200);
  if (!title || !spaceId) return res.status(400).json({ error: 'Title and space are required' });
  if (!spaceExists(spaceId)) return res.status(400).json({ error: 'That space does not exist' });
  if (eventId && !eventExists(eventId)) return res.status(400).json({ error: 'That event does not exist' });
  const p = { id: id(), title, spaceId, eventId: eventId || null, content: sanitize(content), createdBy: req.user.id, updatedBy: req.user.id, createdAt: now(), updatedAt: now(), history: [] };
  db.pages.push(p); log(req.user, 'created page', title); res.json(p);
});
app.put('/api/pages/:id', auth, canEdit, (req, res) => {
  const p = db.pages.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.body.baseUpdatedAt && req.body.baseUpdatedAt !== p.updatedAt)
    return res.status(409).json({ error: `${userName(p.updatedBy)} saved changes while you were editing. Reload to see them before saving.` });
  const b = req.body;
  if (b.title !== undefined && !String(b.title).trim()) return res.status(400).json({ error: 'Title cannot be empty' });
  if (b.spaceId && !spaceExists(b.spaceId)) return res.status(400).json({ error: 'That space does not exist' });
  if (b.eventId && !eventExists(b.eventId)) return res.status(400).json({ error: 'That event does not exist' });
  p.history.unshift({ at: p.updatedAt, by: p.updatedBy, title: p.title, content: p.content });
  p.history = p.history.slice(0, 50);
  if (b.title !== undefined) p.title = String(b.title).trim().slice(0, 200);
  if (b.spaceId) p.spaceId = b.spaceId;
  if (b.eventId !== undefined) p.eventId = b.eventId || null;
  if (req.body.content !== undefined) p.content = sanitize(req.body.content);
  p.updatedBy = req.user.id; p.updatedAt = now();
  log(req.user, 'edited page', p.title); res.json(pageOut(p));
});
app.delete('/api/pages/:id', auth, canEdit, (req, res) => {
  const p = db.pages.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.pages = db.pages.filter(x => x.id !== p.id);
  db.comments = db.comments.filter(c => c.targetId !== p.id);
  log(req.user, 'deleted page', p.title); res.json({ ok: true });
});

// ---- comments (any logged-in member)
app.get('/api/comments/:targetId', auth, (req, res) =>
  res.json(db.comments.filter(c => c.targetId === req.params.targetId).map(c => ({ ...c, userName: userName(c.userId) }))));
app.post('/api/comments/:targetId', auth, (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'Empty comment' });
  const c = { id: id(), targetId: req.params.targetId, userId: req.user.id, text, at: now() };
  db.comments.push(c); log(req.user, 'commented on', req.body.label || 'an item');
  res.json({ ...c, userName: req.user.name });
});
app.delete('/api/comments/:id', auth, (req, res) => {
  const c = db.comments.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  db.comments = db.comments.filter(x => x.id !== c.id); save(); res.json({ ok: true });
});

// ---- dashboard + search
app.get('/api/dashboard', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    stats: {
      members: db.users.filter(u => u.active).length, files: db.files.length,
      videos: db.files.filter(f => f.kind === 'video').length, audio: db.files.filter(f => f.kind === 'audio').length,
      images: db.files.filter(f => f.kind === 'image').length, events: db.events.length, pages: db.pages.length,
      storageBytes: db.files.reduce((s, f) => s + f.versions.reduce((a, v) => a + v.size, 0), 0)
    },
    upcoming: db.events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5),
    recentMedia: db.files.filter(f => ['image', 'video'].includes(f.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(fileOut),
    activity: db.activity.slice(0, 20)
  });
});
app.get('/api/search', auth, (req, res) => {
  const s = String(req.query.q || '').toLowerCase().trim();
  if (!s) return res.json({ files: [], pages: [], events: [] });
  const has = (...v) => v.join(' ').toLowerCase().includes(s);
  res.json({
    files: db.files.filter(f => has(f.title, f.description, f.originalName, (f.tags || []).join(' '))).slice(0, 30).map(fileOut),
    pages: db.pages.filter(p => has(p.title, p.content.replace(/<[^>]+>/g, ' '))).slice(0, 30).map(p => ({ id: p.id, title: p.title, spaceId: p.spaceId, updatedAt: p.updatedAt })),
    events: db.events.filter(e => has(e.title, e.description, e.location)).slice(0, 30)
  });
});

// ---- unknown API routes, single-page app fallback, errors
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  removeUploads(req);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (limit ${MAX_UPLOAD_MB} MB)` });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload problem: ' + err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request data' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err); res.status(500).json({ error: 'Server error' });
});

const server = app.listen(PORT, () => console.log(`KENW60 Project Hub running on http://localhost:${PORT}`));
server.requestTimeout = 0;            // large video uploads on slow links must not be cut off
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use – the hub may already be running in another window.\n  Close it, or start on another port (PowerShell: $env:PORT=3001; npm.cmd start).\n`);
  else console.error(e);
  process.exit(1);
});
// Save everything before exiting (Ctrl+C, docker stop, pm2 restart)
const shutdown = sig => { console.log(`\n${sig} received – saving and shutting down.`); flushDb(); sessionStore.flush(); server.close(); process.exit(0); };
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => shutdown(s)));
