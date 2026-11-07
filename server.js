
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;

    const i = t.indexOf('=');
    if (i < 1) continue;

    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();

    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }

    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile();

const SUPABASE_URL = String(
  process.env.SUPABASE_URL || ''
).replace(/\/+$/, '');

const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const CLOUD_READY =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) &&
  SUPABASE_KEY.length > 20;

const clean = (v, max = 500) =>
  String(v ?? '').trim().slice(0, max);

function send(res, status, data, type = 'application/json; charset=utf-8') {
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS'
  };

  if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);

    res.end(
      type.startsWith('application/json')
        ? JSON.stringify(data)
        : data
    );
  }
}

function body(req) {
  if (req.body !== undefined) {
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let d = '';

    req.on('data', c => {
      d += c;

      if (d.length > 200000) {
        reject(new Error('Payload terlalu besar'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch (e) {
        reject(e);
      }
    });

    req.on('error', reject);
  });
}

// ==========================================
// SUPABASE CONNECTION
// ==========================================

async function sb(
  pathname,
  {
    method = 'GET',
    body: payload,
    prefer,
    headers = {}
  } = {}
) {
  if (!CLOUD_READY) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const h = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...headers
  };

  if (prefer) h.Prefer = prefer;

  const controller = new AbortController();

  // Timeout mencakup fetch dan pembacaan response.
  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${pathname}`,
      {
        method,
        headers: h,
        body: payload === undefined
          ? undefined
          : JSON.stringify(payload),
        signal: controller.signal
      }
    );

    const txt = await r.text();

    let data = null;

    if (txt) {
      try {
        data = JSON.parse(txt);
      } catch {
        data = txt;
      }
    }

    if (!r.ok) {
      const msg =
        data?.message ||
        data?.error ||
        `Supabase HTTP ${r.status}`;

      const err = new Error(msg);
      err.status = r.status;
      err.detail = data;

      throw err;
    }

    return data;

  } catch (error) {
    if (
      controller.signal.aborted ||
      error.name === 'AbortError'
    ) {
      throw new Error(
        'Koneksi Supabase timeout setelah 10 detik.'
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

async function sessionExists(id) {
  if (!id) return null;

  const q =
    `sessions?select=id,alias,class_name&id=eq.${encodeURIComponent(id)}&limit=1`;

  const rows = await sb(q);

  return rows?.[0] || null;
}

async function touchSession(id) {
  if (!id) return;

  await sb(
    `sessions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: {
        last_seen: new Date().toISOString()
      }
    }
  );
}

function avg(rows, field) {
  const nums = (rows || [])
    .map(r => Number(r[field]))
    .filter(Number.isFinite);

  if (!nums.length) return null;

  return Math.round(
    (nums.reduce((a, b) => a + b, 0) / nums.length) * 10
  ) / 10;
}

// ==========================================
// DATABASE LOKAL
// ==========================================

const DATA_DIR = path.join(ROOT, 'data');
const LOCAL_FILE = path.join(DATA_DIR, 'local-db.json');

let localDb = {
  sessions: [],
  attempts: [],
  evaluations: [],
  logs: [],
  seq: 1
};

try {
  if (fs.existsSync(LOCAL_FILE)) {
    localDb = {
      ...localDb,
      ...JSON.parse(
        fs.readFileSync(LOCAL_FILE, 'utf8')
      )
    };
  }
} catch (error) {
  console.error('Gagal membaca database lokal:', error.message);
}

function saveLocal() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    fs.writeFileSync(
      LOCAL_FILE,
      JSON.stringify(localDb)
    );
  } catch (error) {
    console.error(
      'Gagal menyimpan database lokal:',
      error.message
    );
  }
}

const nowStr = () => new Date().toISOString();

// ==========================================
// DASHBOARD
// ==========================================

function buildDashboard(sessions, attempts, evaluations) {
  const overview = {
    sessions: sessions.length,
    attempts: attempts.length,
    avgEvaluation: avg(evaluations, 'score'),
    avgSimulation: avg(attempts, 'score')
  };

  const errorMap = new Map();

  for (const a of attempts) {
    const l = a.error_type || 'Tanpa kesalahan';

    errorMap.set(
      l,
      (errorMap.get(l) || 0) + 1
    );
  }

  const errors = [...errorMap.entries()]
    .map(([label, total]) => ({
      label,
      total
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const sessionMap = new Map(
    sessions.map(s => [s.id, s])
  );

  const recent = evaluations.slice(0, 12).map(e => ({
    alias: sessionMap.get(e.session_id)?.alias || 'Siswa',
    class_name: sessionMap.get(e.session_id)?.class_name || '-',
    score: e.score,
    correct: e.correct,
    total: e.total,
    created_at: e.created_at
  }));

  const scenarioMap = new Map();

  for (const a of attempts) {
    const k = Number(a.scenario) || 1;

    if (!scenarioMap.has(k)) {
      scenarioMap.set(k, []);
    }

    scenarioMap.get(k).push(a);
  }

  const scenarios = [...scenarioMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([scenario, rows]) => ({
      scenario,
      total: rows.length,
      avg_score: avg(rows, 'score'),
      success_count: rows.filter(
        r => r.success === true
      ).length
    }));

  return {
    overview,
    errors,
    recent,
    scenarios
  };
}

// ==========================================
// API MODE LOKAL
// ==========================================

async function localApi(req, res, url) {
  const find = id =>
    localDb.sessions.find(s => s.id === id);

  if (
    req.method === 'POST' &&
    url === '/api/session/validate'
  ) {
    const b = await body(req);
    const row = find(clean(b.id, 80));

    return send(res, 200, {
      valid: !!row,
      session: row
        ? {
            id: row.id,
            alias: row.alias,
            className: row.class_name
          }
        : null
    });
  }

  if (
    req.method === 'POST' &&
    url === '/api/session'
  ) {
    const b = await body(req);

    const row = {
      id: crypto.randomUUID(),
      alias:
        clean(b.alias, 30) ||
        `Siswa-${Math.floor(Math.random() * 900 + 100)}`,
      class_name: clean(b.className, 30) || 'X TJKT',
      created_at: nowStr(),
      last_seen: nowStr()
    };

    localDb.sessions.unshift(row);
    saveLocal();

    return send(res, 200, {
      id: row.id,
      alias: row.alias,
      className: row.class_name
    });
  }

  if (
    req.method === 'POST' &&
    url === '/api/log'
  ) {
    const b = await body(req);
    const sid = clean(b.sessionId, 80);
    const action = clean(b.action, 60);

    if (!sid || !action) {
      return send(res, 400, {
        error: 'sessionId dan action wajib.'
      });
    }

    const s = find(sid);

    if (!s) {
      return send(res, 404, {
        error: 'Sesi tidak ditemukan.'
      });
    }

    s.last_seen = nowStr();

    localDb.logs.unshift({
      id: localDb.seq++,
      session_id: sid,
      action,
      detail: clean(b.detail, 1000) || null,
      created_at: nowStr()
    });

    saveLocal();

    return send(res, 200, { ok: true });
  }

  if (
    req.method === 'POST' &&
    url === '/api/attempt'
  ) {
    const b = await body(req);
    const sid = clean(b.sessionId, 80);

    if (!sid) {
      return send(res, 400, {
        error: 'sessionId wajib.'
      });
    }

    const s = find(sid);

    if (!s) {
      return send(res, 404, {
        error: 'Sesi tidak ditemukan.'
      });
    }

    const row = {
      id: localDb.seq++,
      session_id: sid,
      scenario: Number(b.scenario) || 1,
      level: Number(b.level) || 1,
      success: !!b.success,
      score: Math.max(0, Math.min(100, Number(b.score) || 0)),
      hints_used: Math.max(0, Number(b.hintsUsed) || 0),
      error_type: clean(b.errorType, 80) || null,
      diagnosis: clean(b.diagnosis, 500) || null,
      created_at: nowStr()
    };

    s.last_seen = nowStr();
    localDb.attempts.unshift(row);
    saveLocal();

    return send(res, 200, {
      ok: true,
      id: row.id
    });
  }

  if (
    req.method === 'POST' &&
    url === '/api/evaluation'
  ) {
    const b = await body(req);
    const sid = clean(b.sessionId, 80);

    if (!sid) {
      return send(res, 400, {
        error: 'sessionId wajib.'
      });
    }

    const s = find(sid);

    if (!s) {
      return send(res, 404, {
        error: 'Sesi tidak ditemukan.'
      });
    }

    const row = {
      id: localDb.seq++,
      session_id: sid,
      score: Math.max(0, Math.min(100, Number(b.score) || 0)),
      correct: Math.max(0, Number(b.correct) || 0),
      total: Math.max(0, Number(b.total) || 0),
      reflection_difficulty: clean(b.difficulty, 500) || null,
      reflection_benefit: clean(b.benefit, 500) || null,
      created_at: nowStr()
    };

    s.last_seen = nowStr();
    localDb.evaluations.unshift(row);
    saveLocal();

    return send(res, 200, {
      ok: true,
      id: row.id
    });
  }

  if (
    req.method === 'GET' &&
    url === '/api/dashboard'
  ) {
    return send(
      res,
      200,
      buildDashboard(
        localDb.sessions,
        localDb.attempts,
        localDb.evaluations
      )
    );
  }

  return send(res, 404, {
    error: 'Endpoint tidak ditemukan'
  });
}

// ==========================================
// API UTAMA
// ==========================================

async function api(req, res, url) {
  try {
    if (req.method === 'OPTIONS') {
      return send(res, 204, '', 'text/plain');
    }

    if (
      req.method === 'GET' &&
      url === '/api/health'
    ) {
      if (!CLOUD_READY) {
        return send(
          res,
          process.env.VERCEL ? 503 : 200,
          {
            ok: !process.env.VERCEL,
            app: 'VLANesia',
            database: 'Mode Lokal (tanpa Supabase)',
            global: false,
            message: process.env.VERCEL
              ? 'Isi environment variables Supabase di Vercel.'
              : undefined
          }
        );
      }

      try {
        await sb('sessions?select=id&limit=1');

        return send(res, 200, {
          ok: true,
          app: 'VLANesia',
          database: 'Supabase PostgreSQL',
          global: true
        });

      } catch (e) {
        console.error(
          '[HEALTH CHECK]',
          e.message,
          e.detail || ''
        );

        return send(res, 503, {
          ok: false,
          app: 'VLANesia',
          database: 'Supabase',
          configured: true,
          message: e.message
        });
      }
    }

    if (!CLOUD_READY) {
      if (process.env.VERCEL) {
        return send(res, 503, {
          error: 'Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SECRET_KEY di Vercel.'
        });
      }

      return localApi(req, res, url);
    }

    if (
      req.method === 'POST' &&
      url === '/api/session/validate'
    ) {
      const b = await body(req);
      const id = clean(b.id, 80);
      const row = await sessionExists(id);

      return send(res, 200, {
        valid: !!row,
        session: row
          ? {
              id: row.id,
              alias: row.alias,
              className: row.class_name
            }
          : null
      });
    }

    if (
      req.method === 'POST' &&
      url === '/api/session'
    ) {
      const b = await body(req);

      const alias =
        clean(b.alias, 30) ||
        `Siswa-${Math.floor(Math.random() * 900 + 100)}`;

      const cls = clean(b.className, 30) || 'X TJKT';
      const id = crypto.randomUUID();

      const rows = await sb('sessions', {
        method: 'POST',
        body: [{
          id,
          alias,
          class_name: cls,
          last_seen: nowStr()
        }],
        prefer: 'return=representation'
      });

      const row = rows?.[0] || {
        id,
        alias,
        class_name: cls
      };

      return send(res, 200, {
        id: row.id,
        alias: row.alias,
        className: row.class_name
      });
    }

    if (
      req.method === 'POST' &&
      url === '/api/log'
    ) {
      const b = await body(req);
      const sid = clean(b.sessionId, 80);
      const action = clean(b.action, 60);
      const detail = clean(b.detail, 1000);

      if (!sid || !action) {
        return send(res, 400, {
          error: 'sessionId dan action wajib.'
        });
      }

      if (!(await sessionExists(sid))) {
        return send(res, 404, {
          error: 'Sesi tidak ditemukan.'
        });
      }

      await Promise.all([
        touchSession(sid),
        sb('activity_logs', {
          method: 'POST',
          body: [{
            session_id: sid,
            action,
            detail: detail || null
          }],
          prefer: 'return=minimal'
        })
      ]);

      return send(res, 200, { ok: true });
    }

    if (
      req.method === 'POST' &&
      url === '/api/attempt'
    ) {
      const b = await body(req);
      const sid = clean(b.sessionId, 80);

      if (!sid) {
        return send(res, 400, {
          error: 'sessionId wajib.'
        });
      }

      if (!(await sessionExists(sid))) {
        return send(res, 404, {
          error: 'Sesi tidak ditemukan.'
        });
      }

      const payload = [{
        session_id: sid,
        scenario: Number(b.scenario) || 1,
        level: Number(b.level) || 1,
        success: !!b.success,
        score: Math.max(0, Math.min(100, Number(b.score) || 0)),
        hints_used: Math.max(0, Number(b.hintsUsed) || 0),
        error_type: clean(b.errorType, 80) || null,
        diagnosis: clean(b.diagnosis, 500) || null
      }];

      const rows = await sb('attempts', {
        method: 'POST',
        body: payload,
        prefer: 'return=representation'
      });

      touchSession(sid).catch(error => {
        console.error('[TOUCH SESSION]', error.message);
      });

      return send(res, 200, {
        ok: true,
        id: rows?.[0]?.id ?? null
      });
    }

    if (
      req.method === 'POST' &&
      url === '/api/evaluation'
    ) {
      const b = await body(req);
      const sid = clean(b.sessionId, 80);

      if (!sid) {
        return send(res, 400, {
          error: 'sessionId wajib.'
        });
      }

      if (!(await sessionExists(sid))) {
        return send(res, 404, {
          error: 'Sesi tidak ditemukan.'
        });
      }

      const payload = [{
        session_id: sid,
        score: Math.max(0, Math.min(100, Number(b.score) || 0)),
        correct: Math.max(0, Number(b.correct) || 0),
        total: Math.max(0, Number(b.total) || 0),
        reflection_difficulty: clean(b.difficulty, 500) || null,
        reflection_benefit: clean(b.benefit, 500) || null
      }];

      const rows = await sb('evaluations', {
        method: 'POST',
        body: payload,
        prefer: 'return=representation'
      });

      touchSession(sid).catch(error => {
        console.error('[TOUCH SESSION]', error.message);
      });

      return send(res, 200, {
        ok: true,
        id: rows?.[0]?.id ?? null
      });
    }

    if (
      req.method === 'GET' &&
      url === '/api/dashboard'
    ) {
      const [sessions, attempts, evaluations] =
        await Promise.all([
          sb('sessions?select=id,alias,class_name,created_at,last_seen&order=created_at.desc'),
          sb('attempts?select=id,session_id,scenario,level,success,score,hints_used,error_type,diagnosis,created_at&order=created_at.desc'),
          sb('evaluations?select=id,session_id,score,correct,total,reflection_difficulty,reflection_benefit,created_at&order=created_at.desc')
        ]);

      return send(
        res,
        200,
        buildDashboard(
          sessions,
          attempts,
          evaluations
        )
      );
    }

    return send(res, 404, {
      error: 'Endpoint tidak ditemukan'
    });

  } catch (e) {
    console.error(
      '[VLANesia]',
      e.message,
      e.detail || ''
    );

    const status =
      e.message === 'SUPABASE_NOT_CONFIGURED'
        ? 503
        : e.status && e.status >= 400 && e.status < 600
          ? 502
          : 400;

    return send(res, status, {
      error: e.message === 'SUPABASE_NOT_CONFIGURED'
        ? 'Supabase belum dikonfigurasi.'
        : 'Permintaan gagal diproses pada database cloud.',
      detail: e.message
    });
  }
}

// ==========================================
// SERVER LOKAL
// ==========================================

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const u = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  if (u.pathname.startsWith('/api/')) {
    return api(req, res, u.pathname);
  }

  let rel = u.pathname === '/'
    ? 'index.html'
    : u.pathname.replace(/^\//, '');

  let file = path.normalize(
    path.join(PUBLIC, rel)
  );

  if (!file.startsWith(PUBLIC)) {
    return send(
      res,
      403,
      'Forbidden',
      'text/plain'
    );
  }

  if (
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    file = path.join(PUBLIC, 'index.html');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      return send(
        res,
        500,
        'Server error',
        'text/plain'
      );
    }

    send(
      res,
      200,
      data,
      mime[path.extname(file)] ||
        'application/octet-stream'
    );
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `VLANesia berjalan di http://127.0.0.1:${PORT}`
    );

    console.log(
      CLOUD_READY
        ? 'Database: Supabase PostgreSQL (global)'
        : 'Database: MODE LOKAL (tanpa Supabase)'
    );
  });
}

module.exports = { api };
