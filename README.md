# Water quality monitor (with database)

A dashboard for water quality readings backed by a real database (SQLite) — no CSV needed.
Add stations and readings through the UI; everything is stored on the server and reloads
on every visit.

## Run it locally
```
npm install
npm start
```
Then open http://localhost:3000

The database file is created automatically at `data/water.db` the first time you run it.

## Using it
- **Add station** — name and optional location.
- **Add reading** — pick a station, a date/time, and any of pH, turbidity, dissolved oxygen,
  TDS, temperature (leave fields blank if not measured).
- Readings and stations can be deleted from the dashboard.
- The chart, status colors, and breach list update from whatever is in the database.

## Change the limits
Edit the `P` array at the top of `public/app.js`. Each parameter has `min` / `max` (the allowed
range) and `m` (how close to a limit counts as "near limit"). Defaults are placeholders — set
them to the standard you're following (e.g. WHO, or your country's drinking-water standard).

## Deploying
This needs a Node server (not static GitHub Pages), since it has a database. Any host that
runs Node works, e.g. Render, Railway, Fly.io, or your own server:
```
npm install
npm start   # or: PORT=3000 DATA_DIR=/path/to/persist node server.js
```
Set `DATA_DIR` to a persistent disk/volume on hosts with ephemeral filesystems, so the
database survives restarts and deploys.

## API
- `GET /api/stations`, `POST /api/stations` `{name, location}`, `DELETE /api/stations/:id`
- `GET /api/readings`, `POST /api/readings` `{station_id, taken_at, ph, turbidity, dissolved_oxygen, tds, temperature}`, `DELETE /api/readings/:id`

## Files
- `server.js` — Express API + SQLite database (via better-sqlite3)
- `public/index.html`, `public/style.css`, `public/app.js` — the dashboard
- `data/` — where `water.db` is created (gitignored)
