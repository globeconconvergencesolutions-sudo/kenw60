# KENW60 Project Hub

Members portal for PLEAD II / KENW60 (Kenya Prisons Service · UNODC), hosted by GlobeCon Convergence Solutions.
Members can view, upload and edit documents, pictures, audio and video from project events, write
minutes and reports together online, and comment on everything.

## What it does

- **Spaces** for each facility and workstream in the inception report: PSTC Ruiru Digital Learning Centre,
  National Partner ICT Data Centre (Nairobi), Model Witness Rooms (Nakuru & Kisumu), Rescue Centres
  (Kiambu, Embu & Kisumu), Nairobi Witness Room installation, and Project Management & Reporting.
- **Events**: site visits, meetings, trainings, handovers, each with its own media gallery, minutes and comments.
- **Files**: drag-and-drop upload (up to 2 GB per file by default). Video and audio play in the browser with seeking,
  pictures display full size, PDFs open inline, Word (.docx) documents preview in the browser.
- **Version history**: uploading a new version of a file keeps every earlier version for download.
- **Pages**: rich-text minutes, reports and checklists edited online, with full revision history and restore.
  The page warns you if someone else saved while you were editing.
- **Comments** on files, events and pages; **search** across everything; **activity feed** on the dashboard.
- **Roles**: `admin` (manages members & spaces), `editor` (edits events and pages), `viewer` (views and comments).
- **File permissions per member** (Members → Edit): *Can upload* and *Can download other people's files* are switched
  on or off for each person. Everyone can always download their own uploads. A member without download permission can
  still view pictures, play audio/video and read previews of other people's files inside the hub, but has no download
  buttons on them and the server refuses those download requests. Admins can always do both.
- **Deleting files**: each member can delete the files they uploaded; admins can delete any file.

## Run it on your computer (to try it)

1. Install Node.js 22 LTS (22.12 or newer) from <https://nodejs.org>
2. Double-click **start-hub.bat**, or open a terminal in this folder and run (in PowerShell type `npm.cmd`):

   ```text
   npm install
   npm start
   ```

3. Open **<http://localhost:3000>** and sign in with
   the existing administrator credentials supplied separately. On a **new empty** database, the initial password is printed in the server terminal unless `ADMIN_PASSWORD` is configured; change it immediately after signing in.
4. Go to **Members** to add people. Give each person their email and temporary password.

## Put it online (GlobeCon server)

### Option A – Docker (recommended)

```text
cp .env.example .env      # then edit .env: ADMIN_PASSWORD, SITE_URL, SMTP_*
docker compose up -d --build
```

The site listens on 127.0.0.1:3000 (reach it through Nginx below); all data stays in the `./data` folder on the server.
Never commit or email the real `.env` file.

### Option B – Node + PM2

```text
npm install --omit=dev
npm install -g pm2
ADMIN_PASSWORD='YourStrongPassword' SITE_URL='https://kenw60.globeconcs.com' pm2 start server.js --name kenw60-hub
pm2 save && pm2 startup
```

### Domain and HTTPS (Nginx)

Point a subdomain such as `kenw60.globeconcs.com` to the server, then use this Nginx site
and run `sudo certbot --nginx -d kenw60.globeconcs.com` for a free SSL certificate:

```nginx
server {
    server_name kenw60.globeconcs.com;
    client_max_body_size 2048M;          # allow large video uploads
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
    }
}
```

Once HTTPS works, set `COOKIE_SECURE=true` in the environment and restart.

## Settings (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | Port to listen on |
| `DATA_DIR` | `./data` | Where the database and uploaded files are stored |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@globeconcs.com` / randomly generated | Initial account for an empty database; `ADMIN_PASSWORD` must be set for `npm run reset-admin` |
| `MAX_UPLOAD_MB` | 2048 | Largest single upload |
| `COOKIE_SECURE` | false | Set `true` once the site is on HTTPS (also turns on HSTS) |
| `SITE_URL` | – | Public address used in password-reset links. **Required for reset emails on a public server**: the hub will not build links from the request's Host header |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | – | Outgoing mail; these override Administration → Email settings |
| `SESSION_SECRET` | random, kept in `data/.secret` | Signs session cookies |

## Tests

`npm test` starts a real hub on a temporary data folder and checks sign-in, roles, uploads, permissions,
HTML cleaning, password-reset safety and more. It never touches `data/`.

## Security notes

- Sign-ins are kept in `data/sessions.json`, so members stay signed in across restarts. Changing or resetting a
  password signs that member out on other devices; disabling a member signs them out immediately.
- After 10 wrong passwords an account is paused for 15 minutes.
- Uploaded files are served in a sandbox. HTML, SVG, XML and JS uploads always download instead of opening, so an
  upload can never run code in another member's session.
- Page and Word-preview HTML is cleaned with an allow-list (sanitize-html).
- The hub always keeps at least one active admin.

## Backup

Everything lives in the `data/` folder (`db.json` + `uploads/`). Back it up daily, for example:

```text
tar czf /backups/kenw60-$(date +%F).tgz -C /path/to/kenw60-hub data
```

## Password-recovery integration (handover update)

Read `HANDOVER-TO-VELMA.md` for a complete local test and production checklist.
SMTP can be entered in Administration → Email settings. Its secret is stored separately
in `data/.smtp-password` (never in `data/db.json`); production servers should
use `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and `SITE_URL`
environment variables. The local data directory and its secrets must never be
published or shared after configuring a real mailbox.
