# Water quality monitor (PostgreSQL + login)

A dashboard for water quality readings, backed by a PostgreSQL database, with accounts and
roles so only people you've added can view or change data. Add stations and readings through
the UI; everything is stored in the database and reloads on every visit — no CSV, no local
database file.

## Accounts and roles
Nobody can see or touch anything without signing in. There are three roles:
- **Viewer** — can see stations, readings, the chart and breaches. Can't add, edit or delete.
- **Editor** — everything a viewer can do, plus adding and deleting stations and readings.
- **Admin** — everything an editor can do, plus adding, removing, and setting the role of
  other accounts (via "Manage users" in the header).

The very first account (the one that lets you log in at all) is created automatically the
first time the app starts, from the `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables
below. After that, add everyone else — editors and viewers, or additional admins — from
inside the app as that admin.

## Run it locally
You need:
- `DATABASE_URL` — a PostgreSQL connection string. The easiest way to get one for free is
  Render (see below) — copy its "External Database URL" for local testing.
- `SESSION_SECRET` — any long random string; it signs login cookies. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` — only used once, to create the first admin account
  when the database has no users yet. Safe to leave set afterward.

```
DATABASE_URL=postgres://user:pass@host:5432/dbname \
SESSION_SECRET=paste-a-long-random-string-here \
ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD=choose-a-real-password \
npm start
```
Or create a `.env` file (kept out of git by `.gitignore`) and use a tool like `dotenv` if
you'd rather not put it on the command line each time.

Then open http://localhost:3000 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Using it
- **Add station** — name and optional location. (Editors and admins.)
- **Add reading** — pick a station, a date/time, and any of pH, turbidity, dissolved oxygen,
  TDS, electrical conductivity, temperature (leave fields blank if not measured). (Editors and admins.)
- Readings and stations can be deleted from the dashboard. (Editors and admins.)
- **Manage users** — add or remove accounts, and set their role. (Admins only.)
- The chart, status colors, and breach list update from whatever is in the database.

## Change the limits
Edit the `P` array at the top of `public/app.js`. Each parameter has `min` / `max` (the
allowed range) and `m` (how close to a limit counts as "near limit"). Defaults are
placeholders — set them to the standard you're following (e.g. WHO, or your country's
drinking-water standard).

## Deploying on Render (free)
1. Push this repo to GitHub.
2. On Render: **New → PostgreSQL**. Create a free database and copy its
   **Internal Database URL**.
3. On Render: **New → Web Service**, connect this repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Add these environment variables:
     - `DATABASE_URL` — the Internal Database URL from step 2 (internal is fine and faster
       since both live on Render; use the External URL only if connecting from outside
       Render, e.g. testing locally).
     - `SESSION_SECRET` — a long random string (see "Run it locally" above for how to
       generate one).
     - `NODE_ENV` — set to `production`, so login cookies are only ever sent over HTTPS.
     - `ADMIN_EMAIL` and `ADMIN_PASSWORD` — your own login for the first deploy. These are
       only read once, when the database has no users yet, so changing them later has no
       effect — change your password instead by having another admin remove and re-add
       the account, or add a new admin and remove the old one.
4. Deploy. The app creates its tables and your first admin account automatically on startup
   — watch the deploy log for "Seeded initial admin: ...".
5. Share the `https://your-app.onrender.com` link, and sign in with `ADMIN_EMAIL` /
   `ADMIN_PASSWORD`. Add everyone else's accounts from "Manage users" in the app itself —
   you don't need to touch Render's environment variables again.

Render's free Postgres and free web service both work well together, and — unlike a plain
file on disk — the database keeps your data even when the web service redeploys or restarts.

Render's free Postgres database expires 30 days after creation unless upgraded to a paid
plan. Keep an eye on the expiry date in Render's dashboard so you can migrate the data
before then if this becomes more than a capstone demo.

## API
All endpoints below require being logged in (a session cookie set by `/api/login`); the ones
marked **(editor)** also require the editor or admin role, and **(admin)** the admin role.
- `POST /api/login` `{email, password}`, `POST /api/logout`, `GET /api/me`
- `GET /api/users` (admin), `POST /api/users` `{email, password, role}` (admin),
  `DELETE /api/users/:id` (admin)
- `GET /api/stations`, `POST /api/stations` `{name, location}` (editor),
  `DELETE /api/stations/:id` (editor)
- `GET /api/readings`, `POST /api/readings` `{station_id, taken_at, ph, turbidity, dissolved_oxygen, tds, temperature, conductivity}` (editor),
  `DELETE /api/readings/:id` (editor)

## Files
- `server.js` — Express API + PostgreSQL database (via `pg`)
- `public/index.html`, `public/style.css`, `public/app.js` — the dashboard
