const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const hash = p => crypto.createHash('sha256').update(String(p ?? '')).digest('hex');
const tokens = new Map();

function tokenFor(info) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { ...info, at: Date.now() });
  return token;
}
function bearer(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}
function sessionFor(req) {
  const token = bearer(req);
  const session = tokens.get(token);
  if (!session || Date.now() - session.at > 12 * 60 * 60 * 1000) {
    if (token) tokens.delete(token);
    return null;
  }
  return session;
}
function auth(role) {
  return (req, res, next) => {
    const s = sessionFor(req);
    if (!s || s.role !== role) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    req.session = s;
    next();
  };
}
function safeCollege(c) {
  const { password_hash, ...rest } = c;
  return { ...rest, password: '••••••••' };
}
async function getSetting(key, fallback = null) {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  if (!data || data.value == null) return fallback;
  if (typeof data.value === 'string') {
    try { return JSON.parse(data.value); } catch { return data.value; }
  }
  return data.value;
}
async function putSetting(key, value) {
  const { error } = await supabase.from('app_settings').upsert(
    { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw error;
}
async function getColleges() {
  const { data, error } = await supabase.from('colleges').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
async function getFeatures() {
  const { data, error } = await supabase.from('features').select('name,active');
  if (error) throw error;
  return data || [];
}
async function getGlobalState() {
  const settings = await getSetting('global_settings', {
    name: 'Smart Attendance', color: '#4169f5', announcement: 'System is running smoothly!',
    background: '#f2f6fd', animation: true, theme: 'light'
  });
  const logs = await getSetting('admin_logs', []);
  return { settings, logs: Array.isArray(logs) ? logs : [] };
}
async function adminPayload() {
  const [colleges, features, global] = await Promise.all([getColleges(), getFeatures(), getGlobalState()]);
  return { colleges: colleges.map(safeCollege), features, settings: global.settings, logs: global.logs };
}
function publicCollegeFields(c) {
  return {
    name: String(c.name || ''),
    code: String(c.code || '').trim().toUpperCase(),
    username: String(c.username || '').trim(),
    active: c.active !== false,
    students: Number(c.students || 0)
  };
}
async function saveColleges(input) {
  const existing = await getColleges();
  for (const c of input) {
    const fields = publicCollegeFields(c);
    if (!fields.name || !fields.code || !fields.username) continue;
    const old = existing.find(x => String(x.code).toUpperCase() === fields.code);
    const row = { ...fields };
    if (c.password && c.password !== '••••••••') row.password_hash = hash(c.password);
    if (old) {
      const { error } = await supabase.from('colleges').update(row).eq('id', old.id);
      if (error) throw error;
    } else {
      if (!row.password_hash) row.password_hash = hash(crypto.randomBytes(18).toString('hex'));
      const { error } = await supabase.from('colleges').insert(row);
      if (error) throw error;
    }
  }
  const wanted = new Set(input.map(c => String(c.code || '').toUpperCase()));
  for (const old of existing) {
    if (!wanted.has(String(old.code).toUpperCase())) {
      const { error } = await supabase.from('colleges').delete().eq('id', old.id);
      if (error) throw error;
    }
  }
}
async function seedIfEmpty() {
  const colleges = await getColleges();
  if (colleges.length === 0) {
    const defaults = [
      { name: 'Raj Kumar College', code: 'RK', active: true, students: 480, username: 'rkcollege', password_hash: hash('RK@12345') },
      { name: 'Shree Shyam College', code: 'SS', active: true, students: 320, username: 'sscollege', password_hash: hash('SS@12345') },
      { name: 'Maa Gayatri College', code: 'MG', active: true, students: 210, username: 'mgcollege', password_hash: hash('MG@12345') },
      { name: 'Krishna Tech College', code: 'KT', active: true, students: 165, username: 'ktcollege', password_hash: hash('KT@12345') },
      { name: 'Anand Program College', code: 'AP', active: false, students: 73, username: 'apcollege', password_hash: hash('AP@12345') }
    ];
    const { error } = await supabase.from('colleges').insert(defaults);
    if (error) throw error;
  }
  const features = await getFeatures();
  if (features.length === 0) {
    const names = ['Attendance Management','Student Management','Staff Management','Reports','Face Recognition','QR Attendance','Notifications','College Requests','Export Reports','Backup & Restore','Announcements','User Management'];
    const { error } = await supabase.from('features').insert(names.map(name => ({ name, active: true })));
    if (error) throw error;
  }
  const settings = await getSetting('global_settings', null);
  if (settings == null) await putSetting('global_settings', {
    name: 'Smart Attendance', color: '#4169f5', announcement: 'System is running smoothly!',
    background: '#f2f6fd', animation: true, theme: 'light'
  });
  if ((await getSetting('admin_logs', null)) == null) await putSetting('admin_logs', []);
  // Seed the demo staff account only when the staff table is empty.
  const { data: staffRows, error: staffErr } = await supabase.from('staff').select('id').limit(1);
  if (staffErr) throw staffErr;
  if (!staffRows || staffRows.length === 0) {
    const cs = await getColleges();
    const college = cs.find(c => c.code === 'RK');
    if (college) {
      const { error } = await supabase.from('staff').insert([{
        college_id: college.id, name: 'Staff Member', username: 'staff@demo.com',
        active: true, password_hash: hash('Staff123')
      }]);
      if (error) throw error;
    }
  }
}

app.get('/api/health', async (req, res) => {
  try {
    const { error } = await supabase.from('colleges').select('id').limit(1);
    if (error) throw error;
    res.json({ ok: true, service: 'Smart Attendance API', database: 'Supabase connected' });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'Smart Attendance API', database: 'Supabase error', error: e.message });
  }
});
app.get('/', (req, res) => res.redirect('/college.html'));

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const ownerEmail = process.env.OWNER_EMAIL || 'owner@smartattend.com';
    const ownerPassword = process.env.OWNER_PASSWORD || 'Owner@123';
    if (String(email || '').toLowerCase() !== ownerEmail.toLowerCase() || hash(password) !== hash(ownerPassword)) {
      return res.status(401).json({ error: 'Incorrect owner email or password' });
    }
    const token = tokenFor({ role: 'admin' });
    res.json({ token, state: await adminPayload() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/state', auth('admin'), async (req, res) => {
  try { res.json(await adminPayload()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/state', auth('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    if (Array.isArray(b.colleges)) await saveColleges(b.colleges);
    if (Array.isArray(b.features)) {
      const current = await getFeatures();
      const names = new Set(b.features.map(f => f.name));
      for (const old of current) if (!names.has(old.name)) {
        const { error } = await supabase.from('features').delete().eq('name', old.name);
        if (error) throw error;
      }
      for (const f of b.features) {
        const { error } = await supabase.from('features').upsert({ name: String(f.name), active: f.active !== false }, { onConflict: 'name' });
        if (error) throw error;
      }
    }
    if (b.settings && typeof b.settings === 'object') await putSetting('global_settings', b.settings);
    if (Array.isArray(b.logs)) await putSetting('admin_logs', b.logs.slice(0, 100));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { role, username, password } = req.body || {};
    const u = String(username || '').trim().toLowerCase();
    let account = null;
    if (role === 'college') {
      const { data, error } = await supabase.from('colleges').select('*').ilike('username', u).maybeSingle();
      if (error) throw error;
      if (data && data.active && data.password_hash && data.password_hash === hash(password)) account = { ...data, code: data.code };
    } else if (role === 'staff') {
      const { data, error } = await supabase.from('staff').select('*').ilike('username', u).maybeSingle();
      if (error) throw error;
      if (data && data.active && data.password_hash && data.password_hash === hash(password)) {
        const { data: college, error: collegeError } = await supabase.from('colleges').select('id,name,code').eq('id', data.college_id).maybeSingle();
        if (collegeError) throw collegeError;
        account = { ...data, college_name: college?.name || '', code: college?.code || '' };
      }
    }
    if (!account) return res.status(401).json({ error: 'Invalid username/password, or account disabled' });
    const token = tokenFor({ role, code: account.code, id: account.id || account.username });
    const { password_hash, ...publicAccount } = account;
    res.json({ token, account: { ...publicAccount, role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/college-state', async (req, res) => {
  try {
    const s = sessionFor(req);
    if (!s || !['college', 'staff'].includes(s.role)) return res.status(401).json({ error: 'Login required' });
    res.json({ data: await getSetting('college_data_' + s.code, {}) || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/college-state', async (req, res) => {
  try {
    const s = sessionFor(req);
    if (!s || !['college', 'staff'].includes(s.role)) return res.status(401).json({ error: 'Login required' });
    const data = req.body || {};
    await putSetting('college_data_' + s.code, data);
    // Keep attendance rows in the dedicated attendance table in sync with the dashboard snapshot.
    if (Array.isArray(data.students)) {
      const { data: college, error: cErr } = await supabase.from('colleges').select('id').eq('code', s.code).maybeSingle();
      if (cErr) throw cErr;
      if (college) {
        const today = new Date().toISOString().slice(0, 10);
        const rows = data.students.filter(st => st && (st.status || st.attendance)).map(st => ({
          college_id: college.id,
          student_code: String(st.code || st.roll || st.id || ''),
          student_name: String(st.name || st.studentName || 'Student'),
          status: String(st.status || st.attendance || 'present'),
          marked_by: String(s.id || s.role)
        })).filter(r => r.student_code);
        if (rows.length) {
          const { error } = await supabase.from('attendance').insert(rows);
          if (error) throw error;
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// List staff accounts belonging to the logged-in college
app.get('/api/staff', auth('college'), async (req, res) => {
  try {
    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('id')
      .eq('code', req.session.code)
      .maybeSingle();

    if (collegeError) throw collegeError;
    if (!college) {
      return res.status(404).json({ error: 'College not found' });
    }

    const { data, error } = await supabase
      .from('staff')
      .select('id, name, username, active, college_id')
      .eq('college_id', college.id);

    if (error) throw error;
    res.json({ staff: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a staff account
app.post('/api/staff', auth('college'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!name || !username || password.length < 6) {
      return res.status(400).json({
        error: 'Name, username and password of at least 6 characters are required'
      });
    }

    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('id')
      .eq('code', req.session.code)
      .maybeSingle();

    if (collegeError) throw collegeError;
    if (!college) {
      return res.status(404).json({ error: 'College not found' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('staff')
      .select('id')
      .ilike('username', username)
      .limit(1);

    if (checkError) throw checkError;
    if (existing?.length) {
      return res.status(409).json({
        error: 'This username already exists. Use another username.'
      });
    }

    const { data, error } = await supabase
      .from('staff')
      .insert({
        college_id: college.id,
        name,
        username,
        password_hash: hash(password),
        active: true
      })
      .select('id, name, username, active, college_id')
      .single();

    if (error) throw error;
    res.status(201).json({ staff: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove a staff account belonging to the logged-in college
app.delete('/api/staff/:id', auth('college'), async (req, res) => {
  try {
    const { data: college, error: collegeError } = await supabase
      .from('colleges')
      .select('id')
      .eq('code', req.session.code)
      .maybeSingle();

    if (collegeError) throw collegeError;
    if (!college) {
      return res.status(404).json({ error: 'College not found' });
    }

    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .select('id, college_id')
      .eq('id', req.params.id)
      .maybeSingle();

    if (staffError) throw staffError;

    if (!staff || String(staff.college_id) !== String(college.id)) {
      return res.status(404).json({
        error: 'Staff account not found in your college'
      });
    }

    const { error } = await supabase
      .from('staff')
      .delete()
      .eq('id', staff.id)
      .eq('college_id', college.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/public-config', async (req, res) => {
  try {
    const global = await getGlobalState();
    const features = await getFeatures();
    res.json({ settings: global.settings, features: features.filter(f => f.active).map(f => f.name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

(async () => {
  try {
    await seedIfEmpty();
    app.listen(PORT, '0.0.0.0', () => console.log(`Smart Attendance API listening on ${PORT}; Supabase connected`));
  } catch (e) {
    console.error('Supabase startup failed:', e.message);
    process.exit(1);
  }
})();
