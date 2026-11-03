// PAYMENT SERVICE — thanh toán chuyển khoản: tài khoản nhận tiền (VietQR), webhook SePay, tự ghép tiền với đơn.
// Mọi giao dịch tiền vào được lưu vào bảng bank_transactions rồi ghép với đơn theo nội dung "LUA <số điện thoại>" + số tiền.
//   - Tiền về SAU khi khách bấm đặt hàng: webhook ghép ngay.
//   - Tiền về TRƯỚC (khách chuyển xong mới bấm): Order Service gọi claimEarlyTransfer() lúc tạo đơn.
const express = require('express');
const { pool } = require('../shared/db');
const { bad, str, phoneOf, money } = require('../shared/http');
const { ADMIN_ONLY, audit } = require('../shared/auth');

// Tài khoản nhận chuyển khoản (đọc từ biến môi trường, hiển thị mã VietQR ở trang thanh toán)
const bankAccount = () => (process.env.BANK_ACCOUNT ? {
  bin: process.env.BANK_BIN || '970436',                         // mã ngân hàng (BIN), mặc định Vietcombank
  label: process.env.BANK_LABEL || 'Vietcombank',
  account: process.env.BANK_ACCOUNT,
  owner: (process.env.BANK_OWNER || 'LUA STUDIO').toUpperCase()
} : null);

const phoneFromContent = (content) => {
  const m = String(content || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/LUA(0\d{9}|84\d{9})/);
  return m ? (m[1].startsWith('84') ? '0' + m[1].slice(2) : m[1]) : null;
};

async function markPaid(orderId, txId, amount, gateway) {
  const [r] = await pool.query("UPDATE orders SET payment_status = 'paid' WHERE id = ? AND payment_status = 'unpaid'", [orderId]);
  if (!r.affectedRows) return false;
  await pool.query('UPDATE bank_transactions SET order_id = ? WHERE id = ?', [orderId, txId]);
  await pool.query('INSERT INTO order_status_history (order_id, status, note) SELECT id, status, ?::text FROM orders WHERE id = ?',
    [`Đã nhận chuyển khoản ${money(amount)} (tự động — ${gateway})`, orderId]);
  return true;
}

/* ---------- Interface cho service khác ---------- */
// Ghi nhận 1 giao dịch tiền vào và thử ghép với đơn đang chờ thanh toán
async function receiveTransfer({ sepayId = null, gateway, amount, content }) {
  const phone = phoneFromContent(content);
  const [ins] = await pool.query(`INSERT INTO bank_transactions (sepay_id, gateway, amount, content, phone) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (sepay_id) DO NOTHING RETURNING id`, [sepayId, str(gateway, 50) || 'SePay', amount, str(content, 255), phone]);
  if (!ins.affectedRows) return { duplicate: true };                       // SePay gửi lại cùng giao dịch
  if (!phone) return { matched: false };
  const [[o]] = await pool.query(`
    SELECT id, order_code FROM orders
    WHERE payment_method = 'bank' AND payment_status = 'unpaid' AND status NOT IN ('cancelled', 'returned')
      AND REPLACE(phone, '+84', '0') = ? AND total <= ?
    ORDER BY created_at DESC LIMIT 1`, [phone, amount]);
  return o && await markPaid(o.id, ins.insertId, amount, str(gateway, 50) || 'SePay') ? { matched: o.order_code } : { matched: false };
}

// Đơn chuyển khoản vừa tạo: có sẵn giao dịch khớp (khách chuyển trước) thì ghép luôn
async function claimEarlyTransfer(orderId, phone, total) {
  const [[t]] = await pool.query(`
    SELECT id, amount, gateway FROM bank_transactions
    WHERE order_id IS NULL AND phone = ? AND amount >= ? AND created_at > now() - interval '1 day'
    ORDER BY id LIMIT 1`, [phone.replace(/^\+84/, '0'), total]);
  return t ? markPaid(orderId, t.id, t.amount, t.gateway) : false;
}

/* ---------- API công khai ---------- */
const router = express.Router();

// Cấu hình webhook trên my.sepay.vn: URL https://<website>/api/webhooks/sepay, chứng thực "API Key" = SEPAY_API_KEY
router.post('/webhooks/sepay', async (req, res) => {
  const key = process.env.SEPAY_API_KEY;
  if (!key || req.headers.authorization !== `Apikey ${key}`) return bad(res, 'Unauthorized', 401);
  const b = req.body || {};
  if (b.transferType !== 'in') return res.json({ success: true });
  const amount = Math.round(Number(b.transferAmount) || 0);
  if (amount <= 0) return res.json({ success: true });
  const out = await receiveTransfer({ sepayId: Number(b.id) || null, gateway: b.gateway ? `SePay · ${b.gateway}` : 'SePay', amount, content: b.content });
  res.json({ success: true, ...out });
});

// Trang "Đặt hàng thành công" hỏi định kỳ xem tiền đã về chưa (phải kèm đúng số điện thoại của đơn)
router.get('/orders/:code/payment', async (req, res) => {
  const [[o]] = await pool.query('SELECT payment_status FROM orders WHERE order_code = ? AND phone = ?', [req.params.code, phoneOf(req.query.phone)]);
  o ? res.json({ paymentStatus: o.payment_status }) : bad(res, 'Không tìm thấy đơn hàng.', 404);
});

/* ---------- Quản trị ---------- */
const admin = express.Router();

admin.get('/bank-transactions', async (req, res) => {
  const [rows] = await pool.query('SELECT t.*, o.order_code FROM bank_transactions t LEFT JOIN orders o ON o.id = t.order_id ORDER BY t.id DESC LIMIT 200');
  res.json({ rows, webhook: !!process.env.SEPAY_API_KEY });
});

// Mô phỏng "tiền về tài khoản" để demo khi SePay chưa gọi tới được
admin.post('/bank-simulate', ADMIN_ONLY, async (req, res) => {
  const amount = Math.round(Number(req.body && req.body.amount));
  const content = str(req.body && req.body.content, 255);
  if (!(amount > 0) || !content) return bad(res, 'Nhập số tiền và nội dung chuyển khoản.');
  const out = await receiveTransfer({ gateway: 'Mô phỏng (admin)', amount, content });
  await audit(req, 'Mô phỏng tiền về', `${amount}₫ — ${content}${out.matched ? ` → ${out.matched}` : ''}`);
  res.json(out);
});

module.exports = {
  name: 'payment', version: '1.0', description: 'Thanh toán chuyển khoản: VietQR, webhook SePay, đối soát giao dịch',
  router, admin, bankAccount, receiveTransfer, claimEarlyTransfer
};
