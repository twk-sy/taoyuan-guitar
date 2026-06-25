const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const OSS = require('ali-oss');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const ossClient = new OSS({
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET
});
const PORT = parseInt(process.env.PORT || '3000', 10);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'checkin.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('teacher', 'student')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date DATE NOT NULL,
    duration_minutes INTEGER NOT NULL,
    content TEXT NOT NULL,
    notes TEXT,
    video_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id);
  CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === key;
}

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(parts[0] + '.' + parts[1]).digest('base64url');
  if (sig !== parts[2]) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return null; }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' });
  const payload = verifyToken(header.slice(7));
  if (!payload) return res.status(401).json({ error: '登录已过期' });
  req.user = payload;
  next();
}

function teacherOnly(req, res, next) {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: '仅老师可操作' });
  next();
}

function studentOnly(req, res, next) {
  if (req.user.role !== 'student') return res.status(403).json({ error: '仅学生可操作' });
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});

const TEMP_UPLOAD_DIR = path.join(__dirname, 'temp_uploads');
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const videoTypes = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (videoTypes.includes(ext)) return cb(null, true);
    cb(new Error('仅支持 mp4/mov/avi/mkv/webm/m4v 格式'));
  }
});

async function getSignedUrl(key) {
  if (!key) return null;
  try {
    return await ossClient.signatureUrl(key, { expires: 3600 });
  } catch(e) {
    return null;
  }
}

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Auth
app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = signToken({ id: user.id, name: user.name, role: user.role });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Setup
app.post('/api/setup', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return res.status(400).json({ error: '账号已创建，请直接登录' });
  const { teacherName, teacherPassword, student1Name, student1Password, student2Name, student2Password } = req.body;
  if (!teacherName || !teacherPassword) return res.status(400).json({ error: '请填写老师账号' });
  const insert = db.prepare('INSERT INTO users (name, password_hash, role) VALUES (?, ?, ?)');
  insert.run(teacherName, hashPassword(teacherPassword), 'teacher');
  if (student1Name && student1Password) insert.run(student1Name, hashPassword(student1Password), 'student');
  if (student2Name && student2Password) insert.run(student2Name, hashPassword(student2Password), 'student');
  res.json({ success: true });
});

app.get('/api/setup/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({ needsSetup: count === 0 });
});

// Checkin CRUD
app.post('/api/checkin', authMiddleware, upload.single('video'), async (req, res) => {
  const { date, duration_minutes, content, notes } = req.body;
  if (!date) {
    return res.status(400).json({ error: '请填写日期' });
  }
  let video_key = null;
  if (req.file) {
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const key = 'videos/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      await ossClient.put(key, req.file.path);
      video_key = key;
      fs.unlink(req.file.path, () => {});
    } catch (err) {
      console.error('OSS upload error:', err);
      return res.status(500).json({ error: '视频上传失败' });
    }
  }
  const stmt = db.prepare('INSERT INTO checkins (user_id, date, duration_minutes, content, notes, video_path) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(req.user.id, date, Math.max(0, parseInt(duration_minutes || '0', 10)), content || '记录', notes || null, video_key);
  res.json({ success: true, id: Number(result.lastInsertRowid) });
});

app.get('/api/checkins', authMiddleware, async (req, res) => {
  let rows;
  if (req.user.role === 'teacher') {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    rows = db.prepare(
      'SELECT c.*, u.name as user_name FROM checkins c JOIN users u ON c.user_id = u.id ORDER BY c.date DESC, c.created_at DESC LIMIT ?'
    ).all(limit);
  } else {
    rows = db.prepare(
      'SELECT c.*, u.name as user_name FROM checkins c JOIN users u ON c.user_id = u.id WHERE c.user_id = ? ORDER BY c.date DESC, c.created_at DESC'
    ).all(req.user.id);
  }
  for (let row of rows) {
    if (row.video_path) {
      row.video_url = await getSignedUrl(row.video_path);
    }
  }
  res.json(rows);
});

app.get('/api/checkins/:id', authMiddleware, (req, res) => {
  const row = db.prepare(
    'SELECT c.*, u.name as user_name FROM checkins c JOIN users u ON c.user_id = u.id WHERE c.id = ?'
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (req.user.role === 'student' && row.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权查看' });
  }
  res.json(row);
});

app.delete('/api/checkins/:id', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (req.user.role === 'student' && row.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权删除' });
  }
  if (row.video_path) {
    const fpath = path.join(UPLOAD_DIR, row.video_path);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
  }
  db.prepare('DELETE FROM checkins WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Student list
app.get('/api/students', authMiddleware, teacherOnly, (req, res) => {
  const students = db.prepare(
    `SELECT u.id, u.name,
      (SELECT COUNT(*) FROM checkins WHERE user_id = u.id) as total_checkins,
      (SELECT COALESCE(SUM(duration_minutes), 0) FROM checkins WHERE user_id = u.id) as total_minutes,
      (SELECT MAX(date) FROM checkins WHERE user_id = u.id) as last_checkin_date
    FROM users u WHERE u.role = 'student' ORDER BY u.name`
  ).all();
  res.json(students);
});

// Stats
app.get('/api/stats', authMiddleware, (req, res) => {
  if (req.user.role === 'teacher') {
    const total = db.prepare('SELECT COUNT(*) as c FROM checkins').get().c;
    const totalMinutes = db.prepare('SELECT COALESCE(SUM(duration_minutes), 0) as s FROM checkins').get().s;
    const todayCount = db.prepare("SELECT COUNT(*) as c FROM checkins WHERE date = date('now')").get().c;
    const streakData = db.prepare(
      'SELECT date, COUNT(DISTINCT user_id) as active_users FROM checkins GROUP BY date ORDER BY date DESC LIMIT 60'
    ).all();
    res.json({ total, totalMinutes, todayCount, streakData });
  } else {
    const total = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(req.user.id).c;
    const totalMinutes = db.prepare('SELECT COALESCE(SUM(duration_minutes), 0) as s FROM checkins WHERE user_id = ?').get(req.user.id).s;
    res.json({ total, totalMinutes });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('桃园Guitar🎸拾遗已启动: http://localhost:' + PORT);
});
