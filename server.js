const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PgSession = require('connect-pg-simple')(session);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL database and connect its connection string to this service.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is not set. Set it to a long random string (used to sign login cookies).');
  process.exit(1);
}

// Render's Postgres requires SSL, with a chain Node won't validate by
// default — this is Render's documented setting for that.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

const ROLES = ['admin', 'editor', 'viewer'];

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      location TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS readings (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      taken_at TIMESTAMPTZ NOT NULL,
      ph REAL, turbidity REAL, dissolved_oxygen REAL, tds REAL, temperature REAL, conductivity REAL
    );
  `);
  await pool.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS conductivity REAL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_readings_station_time ON readings(station_id, taken_at);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // First run: seed one admin so someone can actually log in and create
  // everyone else. Set these two env vars on the host before first deploy.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
        [process.env.ADMIN_EMAIL.trim().toLowerCase(), hash, 'admin']);
      console.log(`Seeded initial admin: ${process.env.ADMIN_EMAIL}`);
    } else {
      console.warn('No users exist yet, and ADMIN_EMAIL / ADMIN_PASSWORD are not set — nobody can log in until you set them and restart.');
    }
  }
}

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed for secure cookies to work
app.use(express.json({ limit: '100kb' }));
// Temporary debug logging — safe to remove once things are working.
app.use((req, res, next) => { console.log('REQ', req.method, req.path); next(); });
app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

const handle = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    const status = e.status || (e.code === '23505' ? 400 : 400);
    const msg = e.code === '23505' ? 'That already exists' : e.message;
    res.status(status).json({ error: msg });
  }
};
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const num = (v, lo, hi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error('A value is out of range');
  return n;
};
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ error: 'Please log in' });
}
function requireEditor(req, res, next) {
  if (req.session.user && (req.session.user.role === 'editor' || req.session.user.role === 'admin')) return next();
  res.status(403).json({ error: 'Your account is view-only' });
}
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admins only' });
}

/* ---- Auth ---- */
app.post('/api/login', handle(async (req, res) => {
  console.log('login: looking up user by email');
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  console.log('login: query finished, found', r.rows.length, 'matching row(s)');
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw fail(401, 'Incorrect email or password');
  console.log('login: password OK, saving session');
  req.session.user = { id: u.id, email: u.email, role: u.role };
  res.json(req.session.user);
  console.log('login: response sent');
}));

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', (req, res) => {
  if (req.session.user) res.json(req.session.user);
  else res.status(401).json({ error: 'Not logged in' });
});

/* ---- User management (admin only) ---- */
app.get('/api/users', requireAuth, requireAdmin, handle(async (req, res) => {
  const r = await pool.query('SELECT id, email, role, created_at FROM users ORDER BY email');
  res.json(r.rows);
}));

app.post('/api/users', requireAuth, requireAdmin, handle(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Enter a valid email address');
  const role = ROLES.includes(req.body.role) ? req.body.role : 'viewer';
  const password = String(req.body.password || '');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
    [email, hash, role]);
  res.status(201).json({ id: r.rows[0].id });
}));

app.delete('/api/users/:id', requireAuth, requireAdmin, handle(async (req, res) => {
  if (String(req.params.id) === String(req.session.user.id)) throw new Error("You can't delete the account you're logged in as");
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---- Stations: anyone logged in can view; editors and admins can change ---- */
app.get('/api/stations', requireAuth, handle(async (req, res) => {
  const r = await pool.query('SELECT id, name, location FROM stations ORDER BY name');
  res.json(r.rows);
}));

app.post('/api/stations', requireAuth, requireEditor, handle(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Station name is required');
  const location = String(req.body.location || '').trim().slice(0, 120) || null;
  const r = await pool.query('INSERT INTO stations (name, location) VALUES ($1, $2) RETURNING id', [name, location]);
  res.status(201).json({ id: r.rows[0].id });
}));

app.delete('/api/stations/:id', requireAuth, requireEditor, handle(async (req, res) => {
  await pool.query('DELETE FROM stations WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---- Readings: anyone logged in can view; editors and admins can change ---- */
app.get('/api/readings', requireAuth, handle(async (req, res) => {
  const r = await pool.query('SELECT * FROM readings ORDER BY taken_at');
  res.json(r.rows);
}));

app.post('/api/readings', requireAuth, requireEditor, handle(async (req, res) => {
  const b = req.body;
  const st = await pool.query('SELECT id FROM stations WHERE id = $1', [b.station_id]);
  if (!st.rows.length) throw new Error('Unknown station');
  const t = new Date(b.taken_at);
  if (isNaN(t)) throw new Error('Invalid date and time');
  const v = [num(b.ph, 0, 14), num(b.turbidity, 0, 1e5), num(b.dissolved_oxygen, 0, 30), num(b.tds, 0, 1e5), num(b.temperature, -5, 60), num(b.conductivity, 0, 1e6)];
  if (v.every(x => x === null)) throw new Error('Enter at least one measurement');
  const r = await pool.query(
    `INSERT INTO readings (station_id, taken_at, ph, turbidity, dissolved_oxygen, tds, temperature, conductivity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [st.rows[0].id, t.toISOString(), ...v]
  );
  res.status(201).json({ id: r.rows[0].id });
}));

app.delete('/api/readings/:id', requireAuth, requireEditor, handle(async (req, res) => {
  await pool.query('DELETE FROM readings WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

const port = process.env.PORT || 3000;
init()
  .then(() => app.listen(port, () => console.log(`Water quality monitor on http://localhost:${port}`)))
  .catch(e => { console.error('Failed to set up the database:', e.message); process.exit(1); });
