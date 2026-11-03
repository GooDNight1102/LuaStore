// SUPPORT SERVICE — form liên hệ, đăng ký nhận tin và xử lý tin nhắn ở trang quản trị.
const express = require('express');
const { pool } = require('../shared/db');
const { bad, str, phoneOf, PHONE_RE, EMAIL_RE } = require('../shared/http');
const { ADMIN_ONLY } = require('../shared/auth');

const router = express.Router();

router.post('/contact', async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100), phone = phoneOf(b.phone), email = str(b.email, 150) || null, message = str(b.message, 2000);
  if (name.length < 2 || !PHONE_RE.test(phone) || message.length < 10 || (email && !EMAIL_RE.test(email))) return bad(res, 'Thông tin chưa hợp lệ.');
  await pool.query('INSERT INTO contact_messages (full_name, phone, email, message) VALUES (?, ?, ?, ?)', [name, phone, email, message]);
  res.status(201).json({ ok: true });
});

router.post('/newsletter', async (req, res) => {
  const email = str(req.body && req.body.email, 150).toLowerCase();
  if (!EMAIL_RE.test(email)) return bad(res, 'Email không hợp lệ.');
  await pool.query('INSERT INTO newsletter_subscribers (email) VALUES (?) ON CONFLICT DO NOTHING', [email]);
  res.status(201).json({ ok: true });
});

const admin = express.Router();

admin.get('/messages', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM contact_messages ORDER BY is_handled, created_at DESC LIMIT 200');
  res.json(rows);
});
admin.patch('/messages/:id', async (req, res) => {
  await pool.query('UPDATE contact_messages SET is_handled = ? WHERE id = ?', [!!(req.body && req.body.is_handled), Number(req.params.id) || 0]);
  res.json({ ok: true });
});
admin.get('/newsletter', ADMIN_ONLY, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC');
  res.json(rows);
});

module.exports = {
  name: 'support', version: '1.0', description: 'Liên hệ, đăng ký nhận tin, xử lý tin nhắn',
  router, admin
};
