// Tiện ích HTTP dùng chung cho mọi service: trả lỗi, làm sạch dữ liệu nhập, giới hạn số lần gọi
const { rateLimit } = require('express-rate-limit');

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const str = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const phoneOf = (v) => str(v, 20).replace(/[\s.\-]/g, '');
const PHONE_RE = /^(0|\+84)(3|5|7|8|9)\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const money = (n) => `${Number(n).toLocaleString('vi-VN')}₫`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ponytail: bộ đếm nằm trong RAM của từng máy chủ — trên Vercel mỗi bản chạy đếm riêng (vẫn chặn được dò mật khẩu cơ bản);
// cần chặt hơn thì chuyển sang bộ đếm lưu trong CSDL/Redis.
const limiter = (limit, minutes, msg, extra) => rateLimit({
  windowMs: minutes * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: msg }), ...extra
});

module.exports = { bad, str, phoneOf, PHONE_RE, EMAIL_RE, money, esc, limiter };
