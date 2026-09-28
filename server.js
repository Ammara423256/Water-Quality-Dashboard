const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'water.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS stations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    location TEXT
  );
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY,
    station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    taken_at TEXT NOT NULL,
    ph REAL, turbidity REAL, dissolved_oxygen REAL, tds REAL, temperature REAL, conductivity REAL
  );
  CREATE INDEX IF NOT EXISTS idx_readings_station_time ON readings(station_id, taken_at);
`);

// Migration: databases created before conductivity was added lack the column.
if (!db.prepare('PRAGMA table_info(readings)').all().some(c => c.name === 'conductivity')) {
  db.exec('ALTER TABLE readings ADD COLUMN conductivity REAL');
}

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const handle = fn => (req, res) => {
  try { fn(req, res); }
  catch (e) { res.status(400).json({ error: e.message.includes('UNIQUE') ? 'A station with that name already exists' : e.message }); }
};
const num = (v, lo, hi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error('A value is out of range');
  return n;
};

app.get('/api/stations', handle((req, res) =>
  res.json(db.prepare('SELECT id, name, location FROM stations ORDER BY name').all())));

app.post('/api/stations', handle((req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Station name is required');
  const location = String(req.body.location || '').trim().slice(0, 120) || null;
  const info = db.prepare('INSERT INTO stations (name, location) VALUES (?, ?)').run(name, location);
  res.status(201).json({ id: info.lastInsertRowid });
}));

app.delete('/api/stations/:id', handle((req, res) => {
  db.prepare('DELETE FROM stations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

app.get('/api/readings', handle((req, res) =>
  res.json(db.prepare('SELECT * FROM readings ORDER BY taken_at').all())));

app.post('/api/readings', handle((req, res) => {
  const b = req.body;
  const st = db.prepare('SELECT id FROM stations WHERE id = ?').get(b.station_id);
  if (!st) throw new Error('Unknown station');
  const t = new Date(b.taken_at);
  if (isNaN(t)) throw new Error('Invalid date and time');
  const v = [num(b.ph, 0, 14), num(b.turbidity, 0, 1e5), num(b.dissolved_oxygen, 0, 30), num(b.tds, 0, 1e5), num(b.temperature, -5, 60), num(b.conductivity, 0, 1e6)];
  if (v.every(x => x === null)) throw new Error('Enter at least one measurement');
  const info = db.prepare(
    'INSERT INTO readings (station_id, taken_at, ph, turbidity, dissolved_oxygen, tds, temperature, conductivity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(st.id, t.toISOString(), ...v);
  res.status(201).json({ id: info.lastInsertRowid });
}));

app.delete('/api/readings/:id', handle((req, res) => {
  db.prepare('DELETE FROM readings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Water quality monitor on http://localhost:${port}`));
