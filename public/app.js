
/* =====================================================
   WATER QUALITY MONITOR
   Frontend application
   ===================================================== */

/* ---- CONFIGURATION: WATER QUALITY PARAMETERS ---- */

const P = [
  {
    k: 'ph',
    name: 'pH',
    unit: '',
    min: 6.5,
    max: 8.5,
    m: 0.25,
    dec: 2,
    noise: 0.3
  },
  {
    k: 'dissolved_oxygen',
    name: 'Dissolved oxygen',
    unit: 'mg/L',
    min: 5,
    m: 1,
    dec: 1,
    noise: 0.6
  },
  {
    k: 'tds',
    name: 'TDS',
    unit: 'mg/L',
    max: 1000,
    m: 100,
    dec: 0,
    noise: 40
  },
  {
    k: 'conductivity',
    name: 'Electrical conductivity',
    unit: 'µS/cm',
    max: 1500,
    m: 150,
    dec: 0,
    noise: 60
  },
  {
    k: 'temperature',
    name: 'Temperature',
    unit: '°C',
    dec: 1,
    noise: 1
  }
];

const LBL = {
  ok: 'Within limits',
  warn: 'Near limit',
  bad: 'Out of limits',
  info: 'Monitored',
  na: 'No data'
};

const RANK = {
  bad: 3,
  warn: 2,
  ok: 1,
  info: 0,
  na: 0
};

const $ = s => document.querySelector(s);

const esc = s => String(s).replace(/[&<>"]/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}[c]));

const fmt = (v, p) =>
  Number.isFinite(v) ? v.toFixed(p.dec) : '–';

const fdate = d =>
  d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short'
  });

const fdt = d =>
  fdate(d) + ', ' +
  d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });

/* ---- STATE ---- */

let DATA = {};
let END = Date.now();

let S = {
  sid: null,
  k: 'ph',
  days: 30,
  tab: 'dashboard'
};

let ME = null;
let ST = [];

/* ---- STATUS CALCULATIONS ---- */

function status(p, v) {

  if (!Number.isFinite(v)) return 'na';

  if (p.min == null && p.max == null) {
    return 'info';
  }

  if (
    (p.min != null && v < p.min) ||
    (p.max != null && v > p.max)
  ) {
    return 'bad';
  }

  if (
    (p.min != null && v < p.min + p.m) ||
    (p.max != null && v > p.max - p.m)
  ) {
    return 'warn';
  }

  return 'ok';
}

const last = (rows, k) => {

  for (let i = rows.length - 1; i >= 0; i--) {

    if (Number.isFinite(rows[i][k])) {
      return rows[i];
    }
  }

  return null;
};

const latest = (rows, p) => {

  const r = last(rows, p.k);

  return r ? r[p.k] : NaN;
};

function overall(rows) {

  let w = 'na';

  for (const p of P) {

    const s = status(p, latest(rows, p));

    if (RANK[s] > RANK[w]) {
      w = s;
    }
  }

  return w === 'info' ? 'ok' : w;
}

const limitText = p => {

  if (p.min != null && p.max != null) {
    return `Limit ${p.min}–${p.max}`;
  }

  if (p.max != null) {
    return `Limit ≤ ${p.max} ${p.unit}`;
  }

  if (p.min != null) {
    return `Limit ≥ ${p.min} ${p.unit}`;
  }

  return 'No limit set';
};

/* ---- PERMISSIONS ---- */

const canEdit = () =>
  ME && (
    ME.role === 'editor' ||
    ME.role === 'admin'
  );

const isAdmin = () =>
  ME && ME.role === 'admin';

/* ---- DASHBOARD RENDERING ---- */

function render() {

  const names = Object.keys(DATA);
  const rows = DATA[S.sid] || [];

  const none = !names.length;

  $('#content').hidden = none;
  $('#empty').hidden = !none;

  $('#sub').textContent = none
    ? 'No stations yet'
    : `${names.length} station${names.length > 1 ? 's' : ''}`;

  if (none) {
    $('#stations').innerHTML = '';
    return;
  }

  // Station navigation

  $('#stations').innerHTML = names.map(n => {

    const o = overall(DATA[n]);

    return `
      <button class="st ${o}"
        data-s="${esc(n)}"
        aria-current="${n === S.sid}">

        <span class="dot"></span>
        ${esc(n)}

      </button>
    `;

  }).join('');

  // Station heading

  const o = overall(rows);
  const lr = rows[rows.length - 1];

  $('#head').innerHTML = `
    <h2>${esc(S.sid)}</h2>

    <span class="pill ${o}">
      ${LBL[o]}
    </span>

    <span class="t">
      ${lr ? 'Last reading ' + fdt(lr.t) : 'No readings yet'}
    </span>

    ${
      canEdit()
        ? '<button class="btn" id="delst">Delete station</button>'
        : ''
    }
  `;

  // Measurement tiles

  $('#tiles').innerHTML = P.map(p => {

    const v = latest(rows, p);
    const s = status(p, v);

    const pts = rows
      .filter(r => Number.isFinite(r[p.k]))
      .slice(-28)
      .map(r => r[p.k]);

    const lo = Math.min(...pts);
    const hi = Math.max(...pts);

    const sp = pts.length < 2
      ? ''
      : pts.map((x, i) =>
          `${(i / (pts.length - 1)) * 100},${26 - ((x - lo) / ((hi - lo) || 1)) * 24}`
        ).join(' ');

    return `
      <button class="tile ${s}"
        data-k="${p.k}"
        aria-pressed="${p.k === S.k}">

        <span class="n">${p.name}</span>

        <span class="v">
          ${fmt(v, p)}
          <small>${p.unit}</small>
        </span>

        <span class="s">${LBL[s]}</span>

        <span class="l">${limitText(p)}</span>

        <svg viewBox="0 0 100 28"
          preserveAspectRatio="none"
          aria-hidden="true">

          <polyline
            points="${sp}"
            fill="none"
            stroke="var(--c)"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"/>

        </svg>

      </button>
    `;

  }).join('');

  // Date range controls

  $('#range').innerHTML = [7, 14, 30].map(d => `
    <button data-d="${d}"
      aria-pressed="${d === S.days}">
      ${d} days
    </button>
  `).join('');

  // Render dashboard components

  showTab();
  chart();
  alerts();
  readingsList();
}

/* ---- TABS ---- */

function showTab() {

  document.querySelectorAll('#tabs [data-tab]')
    .forEach(b => {

      b.setAttribute(
        'aria-pressed',
        b.dataset.tab === S.tab
      );

    });

  document.querySelectorAll('.tabpanel[data-panel]')
    .forEach(p => {

      p.hidden = p.dataset.panel !== S.tab;

    });
}

/* ---- DATE FILTER ---- */

function inRange(rows) {

  const cut = END - S.days * 864e5;

  return rows.filter(r =>
    r.t.getTime() >= cut
  );
}

/* ---- MAIN MEASUREMENT CHART ---- */

function chart() {

  const p = P.find(x => x.k === S.k);

  const rows = inRange(DATA[S.sid] || [])
    .filter(r => Number.isFinite(r[p.k]));

  $('#ct').textContent =
    `${p.name} by household · ${limitText(p)}`;

  const svg = $('#chart');

  const W = 800;
  const H = 320;

  const m = {
    l: 65,
    r: 25,
    t: 25,
    b: 65
  };

  if (!rows.length) {

    svg.innerHTML = `
      <text x="400" y="150"
        text-anchor="middle">
        No samples available
      </text>
    `;

    return;
  }

  const values = rows.map(r => r[p.k]);

  let lo = Math.min(...values, p.min ?? Infinity);
  let hi = Math.max(...values, p.max ?? -Infinity);

  const pad = (hi - lo) * 0.12 || 1;

  lo = Math.max(0, lo - pad);
  hi += pad;

  const X = i =>
    m.l + (i + 0.5) *
    ((W - m.l - m.r) / rows.length);

  const Y = v =>
    H - m.b -
    ((v - lo) / (hi - lo)) *
    (H - m.t - m.b);

  let html = '';

  // Horizontal gridlines

  for (let i = 0; i <= 5; i++) {

    const v = lo + (hi - lo) * i / 5;
    const y = Y(v);

    html += `
      <line
        x1="${m.l}"
        x2="${W - m.r}"
        y1="${y}"
        y2="${y}"
        stroke="var(--line)"/>

      <text
        x="${m.l - 10}"
        y="${y + 4}"
        text-anchor="end"
        font-size="11"
        fill="var(--muted)">
        ${v.toFixed(p.dec)}
      </text>
    `;
  }

  // Maximum permissible limit

  if (p.max != null && p.max >= lo && p.max <= hi) {

    html += `
      <line
        x1="${m.l}"
        x2="${W - m.r}"
        y1="${Y(p.max)}"
        y2="${Y(p.max)}"
        stroke="var(--bad)"
        stroke-dasharray="6 4"/>
    `;
  }

  // Minimum permissible limit

  if (p.min != null && p.min >= lo && p.min <= hi) {

    html += `
      <line
        x1="${m.l}"
        x2="${W - m.r}"
        y1="${Y(p.min)}"
        y2="${Y(p.min)}"
        stroke="var(--bad)"
        stroke-dasharray="6 4"/>
    `;
  }

  // Household sample points

  rows.forEach((r, i) => {

    const v = r[p.k];

    const color = status(p, v) === 'bad'
      ? 'var(--bad)'
      : 'var(--accent)';

    const code =
      r.sample_code ||
      r.student_name ||
      `Sample ${i + 1}`;

    html += `
      <circle
        cx="${X(i)}"
        cy="${Y(v)}"
        r="6"
        fill="${color}"
        stroke="var(--surface)"
        stroke-width="1.5">

        <title>
          ${esc(code)}: ${fmt(v, p)} ${p.unit}
        </title>

      </circle>

      <text
        x="${X(i)}"
        y="${H - m.b + 18}"
        text-anchor="middle"
        font-size="10"
        fill="var(--muted)">
        ${i + 1}
      </text>
    `;

  });

  html += `
    <text
      x="${W / 2}"
      y="${H - 10}"
      text-anchor="middle"
      font-size="12"
      fill="var(--muted)">
      Household sample
    </text>
  `;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = html;
}

/* ---- ALERTS ---- */

function alerts() {

  const rows = inRange(DATA[S.sid] || []);
  const items = [];

  for (const r of rows) {

    for (const p of P) {

      if (status(p, r[p.k]) === 'bad') {
        items.push({ r, p });
      }

    }
  }

  const badge = $('#alertCount');

  badge.hidden = !items.length;
  badge.textContent = items.length;

  const ul = $('#alerts');

  if (!items.length) {

    ul.innerHTML = `
      <li class="empty">
        No limit breaches in this period.
      </li>
    `;

    return;
  }

  ul.innerHTML = items
    .slice(-8)
    .reverse()
    .map(({ r, p }) => {

      const v = r[p.k];

      const dir =
        p.max != null && v > p.max
          ? 'above'
          : 'below';

      const lim =
        dir === 'above'
          ? p.max
          : p.min;

      return `
        <li class="bad">

          <span class="dot"></span>

          <span>
            <b>${p.name}</b>
            ${fmt(v, p)} ${p.unit}
            — ${dir} the limit of ${lim}
          </span>

          <span class="w">
            ${fdt(r.t)}
          </span>

        </li>
      `;

    }).join('');
}

/* ---- API ACCESS ---- */

async function api(path, method = 'GET', body) {

  const r = await fetch('/api/' + path, {

    method,

    headers: {
      'Content-Type': 'application/json'
    },

    credentials: 'same-origin',

    body: body
      ? JSON.stringify(body)
      : undefined

  });

  if (r.status === 401) {

    showLogin();

    throw new Error(
      'Your session ended — please sign in again.'
    );
  }

  const j = await r.json().catch(() => ({}));

  if (!r.ok) {

    throw new Error(
      j.error || 'Request failed'
    );
  }

  return j;
}

/* ---- LOAD STATIONS AND HISTORICAL READINGS ---- */

async function load() {

  const [st, rd] = await Promise.all([
    api('stations'),
    api('readings')
  ]);

  ST = st;
  DATA = {};

  // Initialize station data

  st.forEach(x => {
    DATA[x.name] = [];
  });

  const byId = Object.fromEntries(
    st.map(x => [x.id, x.name])
  );

  // Assign readings to their stations

  rd.forEach(r => {

    const n = byId[r.station_id];

    if (n) {

      DATA[n].push({
        ...r,
        t: new Date(r.taken_at)
      });

    }

  });

  // Sort oldest to newest

  Object.values(DATA).forEach(rows => {

    rows.sort((a, b) =>
      a.t.getTime() - b.t.getTime()
    );

  });

  // Most recent reading date

  END = rd.length
    ? Math.max(...rd.map(r =>
        Date.parse(r.taken_at)
      ))
    : Date.now();

  // Select first station if necessary

  if (!DATA[S.sid]) {

    S.sid = st.length
      ? st[0].name
      : null;

  }

  render();
}

/* ---- READING LOG ---- */

const SH = {
  ph: 'pH',
  dissolved_oxygen: 'DO',
  tds: 'TDS',
  conductivity: 'EC',
  temperature: 'Temp'
};

function readingsList() {

  const rows = DATA[S.sid] || [];

  $('#rl').innerHTML = rows.length

    ? rows.slice(-10).reverse().map(r => `

        <li>

          <span>
            ${fdt(r.t)}

            ${
              r.student_name
                ? ' · <b>' + esc(r.student_name) + '</b>'
                : ''
            }

            ${
              r.sample_code
                ? ' · ' + esc(r.sample_code)
                : ''
            }

          </span>

          <span class="w">
            ${
              P.map(p =>
                SH[p.k] + ' ' + fmt(r[p.k], p)
              ).join(' · ')
            }
          </span>

          ${
            canEdit()
              ? `
                <button
                  class="btn"
                  data-del="${r.id}"
                  aria-label="Delete reading">
                  Delete
                </button>
              `
              : ''
          }

        </li>

      `).join('')

    : `
      <li class="empty">
        No readings yet for this station.
      </li>
    `;
}

/* ---- AUTHENTICATION ---- */

function showLogin() {

  ME = null;

  $('#login').hidden = false;
  $('#app').hidden = true;
}

function showApp() {

  $('#login').hidden = true;
  $('#app').hidden = false;

  $('#whoami').textContent =
    `${ME.email} · ${ME.role}`;

  document.querySelectorAll('[data-role]')
    .forEach(el => {

      el.hidden =
        el.dataset.role === 'admin'
          ? !isAdmin()
          : !canEdit();

    });
}

async function checkSession() {

  try {

    ME = await api('me');

    showApp();

    await load();

  } catch (e) {

    showLogin();

  }
}

/* ---- LOGIN FORM ---- */

$('#fLogin').onsubmit = async e => {

  e.preventDefault();

  const f = new FormData(e.target);

  try {

    const r = await fetch('/api/login', {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      credentials: 'same-origin',

      body: JSON.stringify({

        email: f.get('email'),
        password: f.get('password')

      })

    });

    const j = await r.json();

    if (!r.ok) {
      throw new Error(
        j.error || 'Could not sign in'
      );
    }

    ME = j;

    e.target.reset();

    $('#eLogin').textContent = '';

    showApp();

    await load();

  } catch (x) {

    $('#eLogin').textContent = x.message;

  }
};

/* ---- LOGOUT ---- */

$('#logout').onclick = async () => {

  try {

    await fetch('/api/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });

  } finally {

    showLogin();

  }
};

/* ---- USER MANAGEMENT ---- */

async function loadUsers() {

  const users = await api('users');

  $('#ul').innerHTML = users.map(u => `

    <li>

      <span>${esc(u.email)}</span>

      <span class="w">${u.role}</span>

      ${
        u.id !== ME.id
          ? `
            <button
              class="btn"
              data-deluser="${u.id}"
              aria-label="Remove ${esc(u.email)}">
              Remove
            </button>
          `
          : ' <span class="w">(you)</span>'
      }

    </li>

  `).join('') || `
    <li class="empty">No users yet.</li>
  `;
}

function openUsers() {

  $('#eU').textContent = '';

  loadUsers()
    .then(() => $('#dlgU').showModal())
    .catch(x => {
      $('#eU').textContent = x.message;
      $('#dlgU').showModal();
    });
}

$('#fU').onsubmit = async e => {

  e.preventDefault();

  const f = new FormData(e.target);

  try {

    await api('users', 'POST', {

      email: f.get('email'),
      password: f.get('password'),
      role: f.get('role')

    });

    e.target.reset();

    await loadUsers();

  } catch (x) {

    $('#eU').textContent = x.message;

  }
};

/* ---- STATION AND READING FORMS ---- */

const dS = $('#dlgS');
const dR = $('#dlgR');

/* ---- READING FORM FIELDS ---- */

$('#rfields').innerHTML = `

  <label>
    Household Sample ID

    <input
      name="sample_code"
      type="text"
      required
      placeholder="e.g. V01-H01">
  </label>

  <label>
    Water Source

    <select name="source_type">

      <option value="">Select source</option>
      <option>Tap water</option>
      <option>Well</option>
      <option>Borehole</option>
      <option>Spring</option>
      <option>River</option>
      <option>Other</option>

    </select>
  </label>

` + P.map(p => `

  <label>
    ${p.name}${p.unit ? ' (' + p.unit + ')' : ''}

    <input
      name="${p.k}"
      type="number"
      step="any"
      ${p.k === 'ph' ? 'min="0" max="14"' : 'min="0"'}>

  </label>

`).join('');

/* ---- ADD STATION ---- */

function openStation() {

  $('#eS').textContent = '';

  dS.showModal();
}

/* ---- ADD READING ---- */

function openReading() {

  if (!ST.length) {
    return openStation();
  }

  $('#rs').innerHTML = ST.map(x => `

    <option
      value="${x.id}"
      ${x.name === S.sid ? 'selected' : ''}>

      ${esc(x.name)}

    </option>

  `).join('');

  const d = new Date();

  d.setMinutes(
    d.getMinutes() - d.getTimezoneOffset()
  );

  $('#rt').value = d.toISOString().slice(0, 16);

  $('#eR').textContent = '';

  dR.showModal();
}

/* ---- SAVE STATION ---- */

$('#fS').onsubmit = async e => {

  e.preventDefault();

  const f = new FormData(e.target);

  try {

    await api('stations', 'POST', {

      name: f.get('name'),
      location: f.get('location')

    });

    S.sid = f.get('name').trim();

    e.target.reset();

    dS.close();

    await load();

  } catch (x) {

    $('#eS').textContent = x.message;

  }
};

/* ---- SAVE READING ---- */

$('#fR').onsubmit = async e => {

  e.preventDefault();

  const f = new FormData(e.target);

  const body = {

    station_id: +f.get('station'),

    taken_at: new Date(
      f.get('taken')
    ).toISOString(),

    sample_code: String(
      f.get('sample_code') || ''
    ).trim(),

    source_type: String(
      f.get('source_type') || ''
    ),

    student_name: String(
      f.get('student_name') || ''
    ).trim()

  };

  // Add five water-quality measurements

  P.forEach(p => {

    const v = f.get(p.k);

    body[p.k] = v === ''
      ? null
      : +v;

  });

  try {

    await api('readings', 'POST', body);

    S.sid = ST.find(
      x => x.id === body.station_id
    ).name;

    e.target.reset();

    dR.close();

    await load();

  } catch (x) {

    $('#eR').textContent = x.message;

  }
};

/* ---- CLICK EVENTS ---- */

document.addEventListener('click', async e => {

  const t = e.target;

  const c = t.closest('[data-close]');
  const r = t.closest('[data-del]');
  const du = t.closest('[data-deluser]');
  const s = t.closest('[data-s]');
  const k = t.closest('[data-k]');
  const d = t.closest('[data-d]');
  const tb = t.closest('[data-tab]');

  try {

    // Close dialogs

    if (c) {

      c.closest('dialog').close();

      return;
    }

    // Open station form

    if (t.closest('.js-station')) {

      openStation();

      return;
    }

    // Open reading form

    if (t.closest('.js-reading')) {

      openReading();

      return;
    }

    // Open user management

    if (t.closest('.js-users')) {

      openUsers();

      return;
    }

    // Delete reading

    if (r) {

      if (confirm('Delete this reading?')) {

        await api(
          'readings/' + r.dataset.del,
          'DELETE'
        );

        await load();

      }

      return;
    }

    // Delete user

    if (du) {

      if (
        confirm(
          'Remove this user? They will no longer be able to sign in.'
        )
      ) {

        await api(
          'users/' + du.dataset.deluser,
          'DELETE'
        );

        await loadUsers();

      }

      return;
    }

    // Delete station

    if (t.closest('#delst')) {

      if (
        confirm(
          `Delete "${S.sid}" and all its readings?`
        )
      ) {

        const station = ST.find(
          x => x.name === S.sid
        );

        await api(
          'stations/' + station.id,
          'DELETE'
        );

        S.sid = null;

        await load();

      }

      return;
    }

    // Change dashboard tab

    if (tb) {

      S.tab = tb.dataset.tab;

      showTab();

      return;
    }

    // Change station

    if (s) {

      S.sid = s.dataset.s;

    }

    // Change measurement

    else if (k) {

      S.k = k.dataset.k;

    }

    // Change date range

    else if (d) {

      S.days = +d.dataset.d;

    }

    else {

      return;

    }

    render();

  } catch (x) {

    $('#msg').textContent = x.message;

  }

});

/* ---- START APPLICATION ---- */

checkSession();
