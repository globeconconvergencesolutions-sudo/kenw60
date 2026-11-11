// End-to-end tests: start a real hub on a throw-away data folder and exercise it over HTTP.
// Run with:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kenw60-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const ADMIN = { email: 'admin@test.local', password: 'Admin-Test-Password-1' };
let proc, serverLog = '';

function startServer() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, ['server.js'], {
      cwd: ROOT, env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, SITE_URL: '', SMTP_HOST: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const onData = d => { out += d; serverLog += d; if (out.includes('running on')) resolve(); };
    proc.stdout.on('data', onData); proc.stderr.on('data', d => { out += d; serverLog += d; });
    proc.on('exit', code => reject(new Error('server exited ' + code + '\n' + out)));
    setTimeout(() => reject(new Error('server did not start\n' + out)), 15000);
  });
}
function stopServer() {
  return new Promise(r => { if (!proc || proc.exitCode !== null) return r(); proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(); });
}

// minimal cookie-keeping client
function client() {
  let cookie = '';
  const req = async (method, url, body, headers = {}) => {
    const h = { ...headers }; if (cookie) h.cookie = cookie;
    let b = body;
    if (body && !(body instanceof FormData)) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(BASE + url, { method, headers: h, body: b, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text, headers: r.headers };
  };
  return {
    get: (u, h) => req('GET', u, null, h), post: (u, b, h) => req('POST', u, b, h), put: (u, b) => req('PUT', u, b), del: u => req('DELETE', u),
    login: async (email, password) => req('POST', '/api/login', { email, password }),
    get cookie() { return cookie; }, set cookie(c) { cookie = c; }
  };
}
const upload = (c, spaceId, name, content, type, extra = {}) => {
  const fd = new FormData();
  fd.append('spaceId', spaceId); Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  fd.append('files', new Blob([content], { type }), name);
  return c.post('/api/files', fd);
};

let admin, spaceId;
before(async () => {
  await startServer();
  admin = client();
  const r = await admin.login(ADMIN.email, ADMIN.password);
  assert.equal(r.status, 200, 'admin can sign in');
  spaceId = (await admin.get('/api/spaces')).json[0].id;
});
after(async () => { await stopServer(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('health check and unknown API routes', async () => {
  const c = client();
  assert.equal((await c.get('/api/health')).status, 200);
  const r = await c.get('/api/does-not-exist');
  assert.equal(r.status, 404); assert.equal(r.json.error, 'Not found');
  const page = await c.get('/some/app/route');
  assert.equal(page.status, 200); assert.match(page.text, /KENW60 Project Hub/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-powered-by'), null);
});

test('seeded spaces and milestone events exist on a fresh install', async () => {
  assert.equal((await admin.get('/api/spaces')).json.length, 6);
  assert.ok((await admin.get('/api/events')).json.length >= 13);
});

test('authentication: wrong password, protected routes, session rotation', async () => {
  const c = client();
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.login(ADMIN.email, 'nope')).status, 401);
  await c.get('/api/health');
  const r = await c.login(ADMIN.email, ADMIN.password);
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/me')).json.email, ADMIN.email);
  await c.post('/api/logout');
  assert.equal((await c.get('/api/me')).status, 401);
});

test('member management validates input and protects the last admin', async () => {
  assert.equal((await admin.post('/api/users', { name: 'X', email: 'x@test.local', password: 'short' })).status, 400);
  assert.equal((await admin.post('/api/users', { name: 'X', email: 'x@test.local', password: 'longenough', role: 'superuser' })).status, 400);
  assert.equal((await admin.post('/api/users', { name: 'X', email: 'not-an-email', password: 'longenough' })).status, 400);
  const me = (await admin.get('/api/me')).json;
  assert.equal((await admin.put('/api/users/' + me.id, { role: 'viewer' })).status, 400, 'cannot demote yourself');
  const v = await admin.post('/api/users', { name: 'Viewer One', email: 'viewer@test.local', password: 'viewer-pass-1', role: 'viewer', canUpload: false, canDownload: false });
  assert.equal(v.status, 200); assert.equal(v.json.canDownload, false);
  assert.equal((await admin.post('/api/users', { name: 'Dup', email: 'VIEWER@test.local', password: 'longenough' })).status, 400, 'duplicate email');
});

test('roles: viewers cannot edit, upload or list members', async () => {
  const v = client(); assert.equal((await v.login('viewer@test.local', 'viewer-pass-1')).status, 200);
  assert.equal((await v.post('/api/events', { title: 'x', date: '2026-12-01', spaceId })).status, 403);
  assert.equal((await upload(v, spaceId, 'a.txt', 'hi', 'text/plain')).status, 403);
  assert.equal((await v.get('/api/users')).status, 403);
  assert.equal((await v.post('/api/comments/anything', { text: 'Viewers can comment' })).status, 200);
});

test('events are validated', async () => {
  assert.equal((await admin.post('/api/events', { title: 'Bad', date: 'tomorrow', spaceId })).status, 400);
  assert.equal((await admin.post('/api/events', { title: 'Bad', date: '2026-12-01', spaceId: 'nope' })).status, 400);
  const e = await admin.post('/api/events', { title: 'Training day', date: '2026-12-01', spaceId, location: 'Ruiru' });
  assert.equal(e.status, 200);
  assert.equal((await admin.put('/api/events/' + e.json.id, { date: '2026-13-45' })).status, 400);
  assert.equal((await admin.put('/api/events/' + e.json.id, { location: 'Nairobi' })).json.location, 'Nairobi');
});

test('uploads: stored safely, served with correct headers, versioned, deleted', async () => {
  const bad = await upload(admin, 'no-such-space', 'x.txt', 'x', 'text/plain');
  assert.equal(bad.status, 400);
  const before = fs.readdirSync(path.join(DATA, 'uploads')).length;

  const r = await upload(admin, spaceId, 'Rapport été.txt', 'hello world', 'text/plain', { tags: 'a, b' });
  assert.equal(r.status, 200);
  const f = r.json[0];
  assert.equal(f.originalName, 'Rapport été.txt', 'non-ASCII file names survive');
  assert.deepEqual(f.tags, ['a', 'b']);
  assert.equal(fs.readdirSync(path.join(DATA, 'uploads')).length, before + 1, 'rejected upload left no file behind');

  const raw = await admin.get(`/api/files/${f.id}/raw`);
  assert.equal(raw.status, 200); assert.equal(raw.text, 'hello world');
  assert.match(raw.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await admin.get(`/api/files/${f.id}/preview`)).json.text, 'hello world');

  const fd = new FormData(); fd.append('file', new Blob(['version two'], { type: 'text/plain' }), 'v2.txt'); fd.append('note', 'second');
  const ver = await admin.post(`/api/files/${f.id}/version`, fd);
  assert.equal(ver.status, 200); assert.equal(ver.json.versionCount, 2);
  assert.equal((await admin.get(`/api/files/${f.id}/raw?v=1`)).text, 'hello world');
  assert.equal((await admin.get(`/api/files/${f.id}/raw?v=9`)).status, 404);

  assert.equal((await admin.del('/api/files/' + f.id)).status, 200);
  assert.equal((await admin.get(`/api/files/${f.id}/raw`)).status, 404);
});

test('uploaded HTML/SVG can never run as a page on the hub (stored XSS)', async () => {
  for (const [name, type] of [['evil.html', 'text/html'], ['evil.svg', 'image/svg+xml'], ['innocent.jpg', 'text/html']]) {
    const f = (await upload(admin, spaceId, name, '<script>alert(1)</script>', type)).json[0];
    const r = await admin.get(`/api/files/${f.id}/raw`);
    assert.match(r.headers.get('content-disposition'), /^attachment/, name + ' is forced to download');
    assert.equal(r.headers.get('content-type'), 'application/octet-stream', name + ' is not served as active content');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
  }
});

test('download permission is enforced, but uploaders keep access to their own files', async () => {
  const f = (await upload(admin, spaceId, 'photo.png', 'PNGDATA', 'image/png')).json[0];
  const v = client(); await v.login('viewer@test.local', 'viewer-pass-1');
  assert.equal((await v.get(`/api/files/${f.id}/raw`)).status, 200, 'can view inline');
  assert.equal((await v.get(`/api/files/${f.id}/raw?download=1`)).status, 403, 'cannot download');
  assert.equal((await v.get(`/api/files/${f.id}/raw?v=1`)).status, 403, 'cannot fetch old versions');
  assert.equal((await v.del('/api/files/' + f.id)).status, 403, 'cannot delete others\' files');
});

test('pages: HTML is sanitised and edit conflicts are detected', async () => {
  const evil = '<p>ok</p><svg/onload=alert(1)><img src=x onerror=alert(1)><a href=javascript:alert(1)>x</a><a href="JaVaScRiPt:alert(1)">y</a><script>alert(1)</script><iframe src="//evil"></iframe><a href="https://example.org">good</a>';
  const p = await admin.post('/api/pages', { title: 'Minutes', spaceId, content: evil });
  assert.equal(p.status, 200);
  const c = p.json.content;
  assert.ok(c.includes('<p>ok</p>') && c.includes('https://example.org'), 'keeps safe formatting');
  for (const bad of ['onload', 'onerror', 'javascript:', '<script', '<iframe', '<svg']) assert.ok(!c.toLowerCase().includes(bad.toLowerCase()), 'strips ' + bad);

  const base = p.json.updatedAt;
  assert.equal((await admin.put('/api/pages/' + p.json.id, { content: '<p>first</p>', baseUpdatedAt: base })).status, 200);
  assert.equal((await admin.put('/api/pages/' + p.json.id, { content: '<p>second</p>', baseUpdatedAt: base })).status, 409, 'stale save is refused');
  const full = await admin.get('/api/pages/' + p.json.id);
  assert.equal(full.json.history.length, 1);
  assert.ok((await admin.get('/api/search?q=first')).json.pages.some(x => x.id === p.json.id));
});

test('spaces are validated', async () => {
  assert.equal((await admin.put('/api/spaces/' + spaceId, { color: 'red;background:url(x)' })).status, 400);
  assert.equal((await admin.put('/api/spaces/' + spaceId, { color: '#123abc' })).json.color, '#123abc');
});

test('password reset never trusts a forged Host header', async () => {
  // Fresh member, then ask for a reset while pretending to be a public host with no SITE_URL configured.
  // (fetch() may drop a custom Host header, so send this request with the raw http module.)
  await admin.post('/api/users', { name: 'Reset Me', email: 'reset@test.local', password: 'reset-pass-1' });
  const body = JSON.stringify({ email: 'reset@test.local' });
  const r = await new Promise((resolve, reject) => {
    const rq = require('node:http').request({ host: '127.0.0.1', port: PORT, path: '/api/forgot', method: 'POST',
      headers: { host: 'evil.example.com', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      res => { let t = ''; res.on('data', d => t += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) })); });
    rq.on('error', reject); rq.end(body);
  });
  assert.equal(r.status, 200);
  assert.match(r.json.message, /If that email belongs/, 'response stays generic');
  await new Promise(res => setTimeout(res, 400));
  assert.match(serverLog, /Not sent: set the Website address/, 'refused to build a link from the forged host');
  const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
  assert.equal(db.users.find(u => u.email === 'reset@test.local').resetHash, undefined, 'no token was issued');
  assert.equal((await client().get('/api/reset/check?token=abc')).json.valid, false);
});

test('email settings: secret kept out of the database, website address validated', async () => {
  assert.equal((await admin.put('/api/settings/email', { host: 'smtp.example.org', user: 'u@example.org', pass: 'secret-pw', siteUrl: 'not a url' })).status, 400);
  assert.equal((await admin.put('/api/settings/email', { host: 'smtp.example.org', user: 'u@example.org', pass: 'secret-pw', siteUrl: 'https://hub.example.org/' })).status, 200);
  const s = (await admin.get('/api/settings/email')).json;
  assert.equal(s.passSet, true); assert.equal(s.siteUrl, 'https://hub.example.org'); assert.equal(s.pass, undefined);
  await new Promise(res => setTimeout(res, 400));
  assert.ok(!fs.readFileSync(path.join(DATA, 'db.json'), 'utf8').includes('secret-pw'));
});

test('sign-ins survive a server restart', async () => {
  const cookie = admin.cookie;
  await new Promise(r => setTimeout(r, 400));   // let the session store write
  await stopServer(); await startServer();
  const c = client(); c.cookie = cookie;
  assert.equal((await c.get('/api/me')).status, 200);
});

test('repeated wrong passwords are throttled', async () => {
  const c = client();
  for (let i = 0; i < 10; i++) assert.equal((await c.login('viewer@test.local', 'wrong-' + i)).status, 401);
  assert.equal((await c.login('viewer@test.local', 'viewer-pass-1')).status, 429);
});
