
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PgSession = require('connect-pg-simple')(session);

// ---------------- ENVIRONMENT VARIABLES ----------------

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is not set.');
  process.exit(1);
}

// ---------------- DATABASE CONNECTION ----------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

const ROLES = ['admin', 'editor', 'viewer'];

// ---------------- DATABASE INITIALIZATION ----------------

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
      ph REAL,
      dissolved_oxygen REAL,
      tds REAL,
      temperature REAL,
      conductivity REAL,
      student_name TEXT,
      sample_code TEXT,
      source_type TEXT
    );
  `);

  // Add missing columns safely to existing databases

  await pool.query(`
    ALTER TABLE readings
    ADD COLUMN IF NOT EXISTS conductivity REAL;
  `);

  await pool.query(`
    ALTER TABLE readings
    ADD COLUMN IF NOT EXISTS student_name TEXT;
  `);

  await pool.query(`
    ALTER TABLE readings
    ADD COLUMN IF NOT EXISTS sample_code TEXT;
  `);

  await pool.query(`
    ALTER TABLE readings
    ADD COLUMN IF NOT EXISTS source_type TEXT;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_readings_station_time
    ON readings(station_id, taken_at);
  `);

  // USERS TABLE

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // CREATE FIRST ADMIN IF REQUIRED

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM users'
  );

  if (rows[0].n === 0) {

    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {

      const hash = await bcrypt.hash(
        process.env.ADMIN_PASSWORD,
        10
      );

      await pool.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)`,
        [
          process.env.ADMIN_EMAIL.trim().toLowerCase(),
          hash,
          'admin'
        ]
      );

      console.log(`Seeded initial admin: ${process.env.ADMIN_EMAIL}`);

    } else {

      console.warn(
        'No users exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD.'
      );

    }
  }

  console.log('Database initialized successfully.');
}

// ---------------- EXPRESS APP ----------------

const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: '100kb' }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),

  secret: process.env.SESSION_SECRET,

  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

// SERVE FRONTEND

app.use(express.static(path.join(__dirname, 'public')));

// ---------------- HELPERS ----------------

const handle = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {

    console.error('API error:', e);

    const status =
      e.status ||
      (e.code === '23505' ? 400 : 500);

    const msg =
      e.code === '23505'
        ? 'That already exists'
        : e.message;

    res.status(status).json({ error: msg });
  }
};

const fail = (status, msg) =>
  Object.assign(new Error(msg), { status });

const num = (v, lo, hi) => {

  if (v === null || v === undefined || v === '') {
    return null;
  }

  const n = Number(v);

  if (!Number.isFinite(n) || n < lo || n > hi) {
    throw new Error('A value is out of range');
  }

  return n;
};

// ---------------- AUTHENTICATION ----------------

function requireAuth(req, res, next) {

  if (req.session.user) {
    return next();
  }

  res.status(401).json({
    error: 'Please log in'
  });
}

function requireEditor(req, res, next) {

  if (
    req.session.user &&
    (
      req.session.user.role === 'editor' ||
      req.session.user.role === 'admin'
    )
  ) {
    return next();
  }

  res.status(403).json({
    error: 'Your account is view-only'
  });
}

function requireAdmin(req, res, next) {

  if (
    req.session.user &&
    req.session.user.role === 'admin'
  ) {
    return next();
  }

  res.status(403).json({
    error: 'Admins only'
  });
}

// ---------------- LOGIN ----------------

app.post('/api/login', handle(async (req, res) => {

  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();

  const password = String(req.body.password || '');

  const r = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  const u = r.rows[0];

  if (
    !u ||
    !(await bcrypt.compare(password, u.password_hash))
  ) {
    throw fail(401, 'Incorrect email or password');
  }

  req.session.user = {
    id: u.id,
    email: u.email,
    role: u.role
  };

  res.json(req.session.user);

}));

app.post('/api/logout', (req, res) => {

  req.session.destroy(() => {
    res.json({ ok: true });
  });

});

app.get('/api/me', (req, res) => {

  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({
      error: 'Not logged in'
    });
  }

});

// ---------------- USER MANAGEMENT ----------------

app.get(
  '/api/users',
  requireAuth,
  requireAdmin,
  handle(async (req, res) => {

    const r = await pool.query(`
      SELECT id, email, role, created_at
      FROM users
      ORDER BY email
    `);

    res.json(r.rows);

  })
);

app.post(
  '/api/users',
  requireAuth,
  requireAdmin,
  handle(async (req, res) => {

    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();

    if (!email.includes('@')) {
      throw new Error('Enter a valid email address');
    }

    const role = ROLES.includes(req.body.role)
      ? req.body.role
      : 'viewer';

    const password = String(req.body.password || '');

    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    const hash = await bcrypt.hash(password, 10);

    const r = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email, hash, role]
    );

    res.status(201).json({
      id: r.rows[0].id
    });

  })
);

app.delete(
  '/api/users/:id',
  requireAuth,
  requireAdmin,
  handle(async (req, res) => {

    if (
      String(req.params.id) ===
      String(req.session.user.id)
    ) {
      throw new Error(
        "You can't delete the account you're logged in as"
      );
    }

    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [req.params.id]
    );

    res.json({ ok: true });

  })
);

// ---------------- STATIONS ----------------

app.get(
  '/api/stations',
  requireAuth,
  handle(async (req, res) => {

    const r = await pool.query(`
      SELECT id, name, location
      FROM stations
      ORDER BY name
    `);

    res.json(r.rows);

  })
);

app.post(
  '/api/stations',
  requireAuth,
  requireEditor,
  handle(async (req, res) => {

    const name = String(req.body.name || '')
      .trim()
      .slice(0, 80);

    if (!name) {
      throw new Error('Station name is required');
    }

    const location = String(req.body.location || '')
      .trim()
      .slice(0, 120) || null;

    const r = await pool.query(
      `INSERT INTO stations (name, location)
       VALUES ($1, $2)
       RETURNING id`,
      [name, location]
    );

    res.status(201).json({
      id: r.rows[0].id
    });

  })
);

app.delete(
  '/api/stations/:id',
  requireAuth,
  requireEditor,
  handle(async (req, res) => {

    await pool.query(
      'DELETE FROM stations WHERE id = $1',
      [req.params.id]
    );

    res.json({ ok: true });

  })
);

// ---------------- READINGS: GET ALL ----------------

app.get(
  '/api/readings',
  requireAuth,
  handle(async (req, res) => {

    const r = await pool.query(`
      SELECT
        readings.*,
        stations.name AS station_name,
        stations.location AS station_location
      FROM readings
      LEFT JOIN stations
        ON readings.station_id = stations.id
      ORDER BY readings.taken_at DESC
    `);

    res.json(r.rows);

  })
);

// ---------------- READINGS: ADD NEW ----------------

app.post(
  '/api/readings',
  requireAuth,
  requireEditor,
  handle(async (req, res) => {

    const b = req.body;

    const st = await pool.query(
      'SELECT id FROM stations WHERE id = $1',
      [b.station_id]
    );

    if (!st.rows.length) {
      throw new Error('Unknown village');
    }

    const sampleCode = String(b.sample_code || '')
      .trim();

    const sourceType = String(b.source_type || '')
      .trim();

    if (!sampleCode) {
      throw new Error('Household sample ID is required');
    }

    const t = new Date(b.taken_at);

    if (isNaN(t.getTime())) {
      throw new Error('Invalid collection date');
    }

    const student = String(b.student_name || '')
      .trim()
      .slice(0, 80) || null;

    const values = [
      num(b.ph, 0, 14),
      num(b.dissolved_oxygen, 0, 30),
      num(b.tds, 0, 100000),
      num(b.temperature, -5, 60),
      num(b.conductivity, 0, 1000000)
    ];

    if (values.every(v => v === null)) {
      throw new Error('Enter at least one measurement');
    }

    const result = await pool.query(`
      INSERT INTO readings (
        station_id,
        taken_at,
        sample_code,
        source_type,
        student_name,
        ph,
        dissolved_oxygen,
        tds,
        temperature,
        conductivity
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `, [
      b.station_id,
      t.toISOString(),
      sampleCode,
      sourceType || null,
      student,
      ...values
    ]);

    res.status(201).json({
      id: result.rows[0].id
    });

  })
);

// ---------------- DELETE READING ----------------

app.delete(
  '/api/readings/:id',
  requireAuth,
  requireEditor,
  handle(async (req, res) => {

    await pool.query(
      'DELETE FROM readings WHERE id = $1',
      [req.params.id]
    );

    res.json({ ok: true });

  })
);

// ---------------- START SERVER ----------------

const port = process.env.PORT || 3000;

init()
  .then(() => {

    app.listen(port, () => {
      console.log(
        `Water quality monitor running on port ${port}`
      );
    });

  })
  .catch(e => {

    console.error(
      'Failed to set up the database:',
      e.message
    );

    process.exit(1);

  });
