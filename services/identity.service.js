// IDENTITY SERVICE — đăng ký, đăng nhập, quên mật khẩu, hồ sơ khách hàng, quản lý tài khoản (admin).
const express = require('express');
const crypto = require('crypto');
const { pool, PG } = require('../shared/db');
const { bad, str, phoneOf, PHONE_RE, EMAIL_RE, limiter } = require('../shared/http');
const { hashPassword, verifyPassword, weakPassword, auth, ADMIN_ONLY, startSession, publicUser, audit } = require('../shared/auth');
const notification = require('./notification.service');

// Giới hạn số lần thử — chống dò mật khẩu / spam email
const loginLimit = limiter(5, 15, 'Bạn nhập sai quá 5 lần. Vui lòng thử lại sau 15 phút.', { skipSuccessfulRequests: true });
const registerLimit = limiter(10, 60, 'Quá nhiều lượt đăng ký từ máy này. Vui lòng thử lại sau.');
const resetLimit = limiter(5, 15, 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.');

const router = express.Router();

router.post('/auth/register', registerLimit, async (req, res) => {
  const b = req.body || {};
  const fullName = str(b.fullName, 100), email = str(b.email, 150).toLowerCase(), phone = phoneOf(b.phone);
  const password = typeof b.password === 'string' ? b.password : '';
  if (fullName.length < 2) return bad(res, 'Vui lòng nhập họ và tên.');
  if (!EMAIL_RE.test(email)) return bad(res, 'Email không hợp lệ.');
  if (!PHONE_RE.test(phone)) return bad(res, 'Số điện thoại không hợp lệ.');
  if (weakPassword(password)) return bad(res, 'Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số.');
  try {
    const [r] = await pool.query("INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'customer') RETURNING id",
      [fullName, email, phone, hashPassword(password)]);
    const user = { id: r.insertId, full_name: fullName, email, phone, role: 'customer' };
    await startSession(req, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    if (e.code === PG.DUPLICATE) return bad(res, 'Email này đã được đăng ký.', 409);
    throw e;
  }
});

router.post('/auth/login', loginLimit, async (req, res) => {
  const email = str(req.body && req.body.email, 150).toLowerCase();
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  const [[user]] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password, user.password_hash)) return bad(res, 'Email hoặc mật khẩu không đúng.', 401);
  if (!user.is_active) return bad(res, 'Tài khoản đã bị khóa. Vui lòng liên hệ cửa hàng.', 403);
  await startSession(req, user);
  res.json({ user: publicUser(user) });
});

/* ---------- Quên mật khẩu: gửi mã 6 số qua email, hết hạn sau 15 phút ---------- */
router.post('/auth/forgot', resetLimit, async (req, res) => {
  const email = str(req.body && req.body.email, 150).toLowerCase();
  if (!EMAIL_RE.test(email)) return bad(res, 'Email không hợp lệ.');
  const [[u]] = await pool.query('SELECT id, full_name FROM users WHERE email = ? AND is_active', [email]);
  if (u) {
    const code = String(crypto.randomInt(100000, 1000000));
    await pool.query('DELETE FROM password_resets WHERE user_id = ?', [u.id]);
    await pool.query("INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, now() + interval '15 minutes')", [u.id, hashPassword(code)]);
    await notification.passwordReset(email, u.full_name, code);
  }
  res.json({ ok: true });   // luôn trả lời giống nhau — không để lộ email nào đã đăng ký
});

router.post('/auth/reset', resetLimit, async (req, res) => {
  const b = req.body || {};
  const email = str(b.email, 150).toLowerCase(), code = str(b.code, 6);
  const password = typeof b.password === 'string' ? b.password : '';
  const [[r]] = await pool.query(`SELECT pr.id, pr.code_hash, pr.attempts, pr.user_id FROM password_resets pr JOIN users u ON u.id = pr.user_id
    WHERE u.email = ? AND pr.expires_at > now()`, [email]);
  if (!r || r.attempts >= 5 || !verifyPassword(code, r.code_hash)) {
    if (r) await pool.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [r.id]);
    return bad(res, 'Mã không đúng hoặc đã hết hạn.');
  }
  if (weakPassword(password)) return bad(res, 'Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số.');
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), r.user_id]);
  await pool.query('DELETE FROM password_resets WHERE user_id = ?', [r.user_id]);
  res.json({ ok: true });
});

router.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

router.get('/auth/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const [[u]] = await pool.query('SELECT * FROM users WHERE id = ? AND is_active', [req.session.userId]);
  res.json({ user: publicUser(u) || null });
});

/* ---------- Khách hàng: sửa thông tin & đổi mật khẩu ---------- */
router.put('/me', auth(), async (req, res) => {
  const b = req.body || {};
  const fullName = str(b.fullName, 100), phone = phoneOf(b.phone), address = str(b.address), region = str(b.regionCode, 20);
  if (fullName.length < 2) return bad(res, 'Vui lòng nhập họ và tên.');
  if (phone && !PHONE_RE.test(phone)) return bad(res, 'Số điện thoại không hợp lệ.');
  if (address && address.length < 10) return bad(res, 'Địa chỉ cần ít nhất 10 ký tự.');
  if (region && !(await pool.query('SELECT 1 FROM shipping_regions WHERE code = ?', [region]))[0].length) return bad(res, 'Khu vực không hợp lệ.');
  await pool.query('UPDATE users SET full_name = ?, phone = ?, address = ?, region_code = ? WHERE id = ?',
    [fullName, phone || null, address || null, region || null, req.user.id]);
  const [[u]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(u) });
});

router.post('/me/password', auth(), loginLimit, async (req, res) => {
  const b = req.body || {};
  const current = typeof b.current === 'string' ? b.current : '', next = typeof b.password === 'string' ? b.password : '';
  const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!verifyPassword(current, u.password_hash)) return bad(res, 'Mật khẩu hiện tại không đúng.', 401);
  if (weakPassword(next)) return bad(res, 'Mật khẩu mới cần ít nhất 8 ký tự, gồm cả chữ và số.');
  if (current === next) return bad(res, 'Mật khẩu mới phải khác mật khẩu hiện tại.');
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(next), req.user.id]);
  res.json({ ok: true });
});

/* ---------- Quản trị: tài khoản (admin) ---------- */
const admin = express.Router();

admin.get('/users', ADMIN_ONLY, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at,
           (SELECT COUNT(*) FROM orders WHERE user_id = u.id) AS orders
    FROM users u ORDER BY array_position(ARRAY['admin', 'staff', 'customer'], u.role), u.id`);
  res.json(rows);
});
admin.post('/users', ADMIN_ONLY, async (req, res) => {
  const b = req.body || {};
  const fullName = str(b.fullName, 100), email = str(b.email, 150).toLowerCase(), role = b.role;
  const password = typeof b.password === 'string' ? b.password : '';
  if (fullName.length < 2 || !EMAIL_RE.test(email)) return bad(res, 'Cần nhập họ tên và email hợp lệ.');
  if (!['customer', 'staff', 'admin'].includes(role)) return bad(res, 'Vai trò không hợp lệ.');
  if (password.length < 8) return bad(res, 'Mật khẩu tạm cần ít nhất 8 ký tự.');
  try {
    await pool.query('INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [fullName, email, str(b.phone, 15) || null, hashPassword(password), role]);
  } catch (e) {
    if (e.code === PG.DUPLICATE) return bad(res, 'Email đã tồn tại.', 409);
    throw e;
  }
  await audit(req, 'Tạo tài khoản', `${email} (${role})`);
  res.status(201).json({ ok: true });
});
admin.patch('/users/:id', ADMIN_ONLY, async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { role, is_active } = req.body || {};
  if (id === req.user.id) return bad(res, 'Không thể tự đổi vai trò hoặc khóa chính tài khoản đang đăng nhập.');
  if (role !== undefined && !['customer', 'staff', 'admin'].includes(role)) return bad(res, 'Vai trò không hợp lệ.');
  await pool.query('UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?',
    [role ?? null, is_active === undefined ? null : !!is_active, id]);
  const [[u]] = await pool.query('SELECT email FROM users WHERE id = ?', [id]);
  await audit(req, 'Sửa tài khoản', `${u ? u.email : '#' + id}: ${role ? 'vai trò ' + role : ''}${is_active === undefined ? '' : is_active ? 'mở khóa' : 'khóa'}`);
  res.json({ ok: true });
});

module.exports = {
  name: 'identity', version: '1.0', description: 'Đăng ký, đăng nhập, quên mật khẩu, hồ sơ, quản lý tài khoản',
  router, admin
};
