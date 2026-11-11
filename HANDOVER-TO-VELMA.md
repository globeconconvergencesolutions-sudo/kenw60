# KENW60 Project Hub — password recovery integration handover

## What changed
- Preserved Velma's existing login, dashboard, documents, events, member roles and password-reset interface.
- Removed disclosure of password reset links in server logs when sending fails.
- An unsent recovery token is invalidated; the public response remains generic to protect account enumeration.
- SMTP passwords are now kept in `data/.smtp-password` (or an `SMTP_PASS` server environment variable), **not** in `data/db.json`. Previously saved SMTP passwords migrate automatically when the updated server starts.
- The administrator reset command now requires an explicit `ADMIN_PASSWORD` (at least 12 characters). Fresh databases generate a random initial password when ADMIN_PASSWORD isn't specified.

## Run and test on Windows
1. Unzip the package; open the `kenw60-hub` folder in VS Code.
2. In PowerShell: `npm.cmd install` then `npm.cmd start`.
3. Open `http://localhost:3000` and sign in as an administrator. Existing accounts and project content are retained in the supplied original database.
4. Open **Email settings**, enter authorized SMTP configuration, click **Save settings**. The SMTP password is saved locally in `data/.smtp-password`; do not send this file to another person.
5. Create a member with an email address you control, sign out, select **Forgot password?**, and request a link. Check inbox/spam, open it on the computer running the local server, reset the member password and sign in again.
6. If test delivery is needed without signing out, the 'Send test email to me' button sends to the **currently logged-in account**, not the SMTP sending mailbox.

## Before real deployment
- Set SMTP configuration with environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `SITE_URL`) and use an authorized company mail account rather than a staff member's personal Gmail.
- Set `SITE_URL` or the Website address field to the deployed HTTPS address. Never send a localhost URL to remote users.
- Rotate existing default or publicly shared administrator passwords immediately.
- Keep `data/` private, backed up and out of public directories, source control and email handover attachments. This delivery includes the original project database/media supplied with Velma's ZIP, without the original session secret or outstanding recovery token.
- Run `npm audit` and address dependency advisories after reviewing compatibility (avoid `npm audit fix --force` blindly).
- Express's default in-memory session store is only suitable for testing; use a production-ready session store before multi-user internet deployment.

## How to hand over
Send the ZIP to Velma. Do not include your locally configured `data/.smtp-password`, personal Gmail App Password, or a copy of your local modified database. Velma should configure her own SMTP account on her installation.
