const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '5mb' }));

const DB = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const hash = (p) =>
  crypto.createHash('sha256').update(String(p)).digest('hex');

function initial() {
  return {
    owner: {
      email: process.env.OWNER_EMAIL || 'owner@smartattend.com',
      passwordHash: hash(process.env.OWNER_PASSWORD || 'Owner@123')
    },
    colleges: [
      {
        name: 'Raj Kumar College',
        code: 'RK',
        active: true,
        students: 480,
        username: 'rkcollege',
        passwordHash: hash('RK@12345')
      },
      {
        name: 'Shree Shyam College',
        code: 'SS',
        active: true,
        students: 320,
        username: 'sscollege',
        passwordHash: hash('SS@12345')
      },
      {
        name: 'Maa Gayatri College',
        code: 'MG',
        active: true,
        students: 210,
        username: 'mgcollege',
        passwordHash: hash('MG@12345')
      },
      {
        name: 'Krishna Tech College',
        code: 'KT',
        active: true,
        students: 165,
        username: 'ktcollege',
        passwordHash: hash('KT@12345')
      },
      {
        name: 'Anand Program College',
        code: 'AP',
        active: false,
        students: 73,
        username: 'apcollege',
        passwordHash: hash('AP@12345')
      }
    ],
    staff: [
      {
        id: 'staff-demo',
        collegeCode: 'RK',
        name: 'Staff Member',
        username: 'staff@demo.com',
        passwordHash: hash('Staff123'),
        active: true
      }
    ],
    features: [
      'Attendance Management',
      'Student Management',
      'Staff Management',
      'Reports',
      'Face Recognition',
      'QR Attendance',
      'Notifications',
      'College Requests',
      'Export Reports',
      'Backup & Restore',
      'Announcements',
      'User Management'
    ].map(name => ({ name, active: true })),
    settings: {
      name: 'Smart Attendance',
      color: '#4169f5',
      announcement: 'System is running smoothly!',
      background: '#f2f6fd',
      animation: true,
      theme: 'light'
    },
    logs: [],
    collegeData: {}
  };
}

let db;

function save() {
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
}

try {
  db = JSON.parse(fs.readFileSync(DB, 'utf8'));
} catch {
  db = initial();
  save();
}

const tokens = new Map();

function tokenFor(info) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { ...info, at: Date.now() });
  return token;
}

function getSession(req) {
  const token = (req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '');
  return tokens.get(token);
}

function auth(role) {
  return (req, res, next) => {
    const session = getSession(req);

    if (!session || session.role !== role) {
      return res.status(401).json({
        error: 'Session expired. Please log in again.'
      });
    }

    req.session = session;
    next();
  };
}

function publicColleges() {
  return db.colleges.map(({ passwordHash, ...college }) => ({
    ...college,
    password: '••••••••'
  }));
}

// Serve only the intended HTML pages.
app.get('/', (req, res) => res.redirect('/college.html'));

app.get('/college.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'college.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Smart Attendance API' });
});

// Public settings
app.get('/api/public-config', (req, res) => {
  res.json({
    settings: db.settings,
    features: db.features
      .filter(feature => feature.active)
      .map(feature => feature.name)
  });
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};

  if (
    String(email || '').toLowerCase() !==
      db.owner.email.toLowerCase() ||
    hash(password || '') !== db.owner.passwordHash
  ) {
    return res.status(401).json({
      error: 'Incorrect owner email or password'
    });
  }

  const token = tokenFor({ role: 'admin' });

  res.json({
    token,
    state: {
      colleges: publicColleges(),
      features: db.features,
      settings: db.settings,
      logs: db.logs
    }
  });
});

// Read admin data
app.get('/api/admin/state', auth('admin'), (req, res) => {
  res.json({
    colleges: publicColleges(),
    features: db.features,
    settings: db.settings,
    logs: db.logs
  });
});

// Save admin changes
app.put('/api/admin/state', auth('admin'), (req, res) => {
  const body = req.body || {};

  if (Array.isArray(body.colleges)) {
    db.colleges = body.colleges.map(college => {
      const old = db.colleges.find(
        item => item.code === college.code
      );

      const passwordHash =
        college.password &&
        college.password !== '••••••••'
          ? hash(college.password)
          : old
            ? old.passwordHash
            : hash(crypto.randomBytes(16).toString('hex'));

      return { ...college, passwordHash };
    });
  }

  if (Array.isArray(body.features)) {
    db.features = body.features;
  }

  if (
    body.settings &&
    typeof body.settings === 'object'
  ) {
    db.settings = { ...db.settings, ...body.settings };
  }

  if (Array.isArray(body.logs)) {
    db.logs = body.logs.slice(0, 100);
  }

  save();
  res.json({ ok: true });
});

// College and staff login
app.post('/api/login', (req, res) => {
  const { role, username, password } = req.body || {};
  const user = String(username || '').trim().toLowerCase();

  let account;

  if (role === 'college') {
    account = db.colleges.find(college =>
      college.active &&
      college.username.toLowerCase() === user &&
      college.passwordHash === hash(password || '')
    );
  } else if (role === 'staff') {
    account = db.staff.find(staff =>
      staff.active &&
      staff.username.toLowerCase() === user &&
      staff.passwordHash === hash(password || '')
    );
  } else {
    return res.status(400).json({
      error: 'Invalid login role'
    });
  }

  if (!account) {
    return res.status(401).json({
      error: 'Invalid username/password, or account disabled'
    });
  }

  const token = tokenFor({
    role,
    code: account.code || account.collegeCode,
    id: account.id || account.username
  });

  const { passwordHash, ...safeAccount } = account;

  res.json({
    token,
    account: { ...safeAccount, role }
  });
});

// Read college/staff data
app.get('/api/college-state', (req, res) => {
  const session = getSession(req);

  if (
    !session ||
    !['college', 'staff'].includes(session.role)
  ) {
    return res.status(401).json({ error: 'Login required' });
  }

  res.json({
    data: db.collegeData[session.code] || {}
  });
});

// Save college/staff data
app.put('/api/college-state', (req, res) => {
  const session = getSession(req);

  if (
    !session ||
    !['college', 'staff'].includes(session.role)
  ) {
    return res.status(401).json({ error: 'Login required' });
  }

  db.collegeData[session.code] = req.body || {};
  save();

  res.json({ ok: true });
});

// Start server
const port = process.env.PORT || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Smart Attendance running on port ${port}`);
});
