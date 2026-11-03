// Bảo mật dùng chung: băm mật khẩu, phiên đăng nhập lưu trong CSDL, middleware phân quyền, nhật ký thao tác
const crypto = require('crypto');
const session = require('express-session');
const { pool } = require('./db');

// Mật khẩu: scrypt có sẵn trong Node, không cần thư viện ngoài
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [algo, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const weakPassword = (p) => p.length < 8 || !/\d/.test(p) || !/[A-Za-z]/.test(p);

/* Middleware phân quyền.
   auth()                    -> phải đăng nhập (vai trò bất kỳ)
   auth('staff', 'admin')    -> chỉ nhân viên hoặc admin
   Đọc lại user từ CSDL mỗi lần để khóa tài khoản / đổi vai trò có hiệu lực ngay. */
function auth(...roles) {
  return async (req, res, next) => {
    const id = req.session.userId;
    if (!id) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    const [[user]] = await pool.query('SELECT id, full_name, email, phone, address, region_code, role, is_active FROM users WHERE id = ?', [id]);
    if (!user || !user.is_active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị khóa.' });
    }
    if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    req.user = user;
    next();
  };
}
const STAFF = auth('staff', 'admin');
const ADMIN_ONLY = auth('admin');

// Phiên đăng nhập lưu trong bảng sessions — chạy nhiều máy chủ (Vercel) vẫn dùng chung phiên
class DbSessionStore extends session.Store {
  get(sid, cb) {
    pool.query('SELECT data FROM sessions WHERE session_id = ? AND expires > EXTRACT(EPOCH FROM now())', [sid])
      .then(([[r]]) => cb(null, r ? JSON.parse(r.data) : null), cb);
  }
  set(sid, sess, cb = () => {}) {
    const expires = Math.floor(new Date(sess.cookie.expires || Date.now() + 864e5).getTime() / 1000);
    pool.query(`INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)
      ON CONFLICT (session_id) DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data`, [sid, expires, JSON.stringify(sess)])
      .then(() => cb(), cb);
    // Dọn phiên hết hạn thỉnh thoảng (máy chủ serverless không chạy hẹn giờ được)
    if (Math.random() < 0.02) pool.query('DELETE FROM sessions WHERE expires < EXTRACT(EPOCH FROM now())').catch(() => {});
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
  destroy(sid, cb = () => {}) { pool.query('DELETE FROM sessions WHERE session_id = ?', [sid]).then(() => cb(), cb); }
}

function startSession(req, user) {
  return new Promise((ok, fail) => req.session.regenerate((err) => {   // đổi mã phiên sau đăng nhập, chống chiếm phiên
    if (err) return fail(err);
    req.session.userId = user.id;
    ok();
  }));
}

const publicUser = (u) => u && { id: u.id, fullName: u.full_name, email: u.email, phone: u.phone, role: u.role, address: u.address || '', regionCode: u.region_code || '' };

// Nhật ký thao tác của nhân viên/admin: ai làm gì, lúc nào
const audit = (req, action, detail) => pool.query('INSERT INTO admin_logs (user_id, action, detail) VALUES (?, ?, ?)', [req.user.id, action, String(detail).slice(0, 255)]);

module.exports = { hashPassword, verifyPassword, weakPassword, auth, STAFF, ADMIN_ONLY, DbSessionStore, startSession, publicUser, audit };
