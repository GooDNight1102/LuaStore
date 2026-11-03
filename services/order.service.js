// ORDER SERVICE — mã giảm giá, đặt hàng, đơn hàng của khách, xử lý đơn ở trang quản trị.
// Gọi sang service khác qua interface: Payment (ghép tiền chuyển trước), Notification (email xác nhận).
const express = require('express');
const { pool, PG } = require('../shared/db');
const { bad, str, phoneOf, PHONE_RE, EMAIL_RE } = require('../shared/http');
const { auth, ADMIN_ONLY, audit, publicUser } = require('../shared/auth');
const payment = require('./payment.service');
const notification = require('./notification.service');

const ORDER_STATUS = ['pending', 'confirmed', 'shipping', 'completed', 'cancelled', 'returned'];
const PAY_STATUS = ['unpaid', 'paid', 'refunded'];
const STATUS_VI = { pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', shipping: 'Đang giao', completed: 'Hoàn tất', cancelled: 'Đã hủy', returned: 'Trả hàng' };
const PAY_VI = { unpaid: 'Chưa thanh toán', paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền' };
const PAID_CLAIM = '[Khách báo đã chuyển khoản, nội dung:';   // tiền tố ghi chú — trang quản trị dùng để gắn nhãn

async function findCoupon(db, code) {
  const [[c]] = await db.query(`
    SELECT code, type, value, min_order AS "minOrder", description AS label FROM coupons
    WHERE code = ? AND is_active
      AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now())
      AND (usage_limit IS NULL OR used_count < usage_limit)`, [str(code, 30).toUpperCase()]);
  return c || null;
}

const router = express.Router();

// Kho voucher: các mã đang còn hiệu lực (trang Thanh toán hiển thị để khách chọn)
router.get('/coupons', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT code, type, value, min_order AS "minOrder", description AS label, ends_at AS "endsAt",
           CASE WHEN usage_limit IS NULL THEN NULL ELSE usage_limit - used_count END AS remaining
    FROM coupons
    WHERE is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now())
      AND (usage_limit IS NULL OR used_count < usage_limit)
    ORDER BY min_order, code`);
  res.json(rows);
});

router.get('/coupons/:code', async (req, res) => {
  const c = await findCoupon(pool, req.params.code);
  c ? res.json(c) : bad(res, 'Mã giảm giá không tồn tại hoặc đã hết hạn.', 404);
});

/* ---------- Đặt hàng: giá, giảm giá, phí ship đều tính lại ở server ---------- */
router.post('/orders', async (req, res) => {
  const b = req.body || {};
  const f = {
    fullName: str(b.fullName, 100), phone: phoneOf(b.phone), email: str(b.email, 150) || null,
    region: str(b.region, 20), address: str(b.address), note: str(b.note, 500) || null, payment: b.payment === 'bank' ? 'bank' : 'cod'
  };
  const items = Array.isArray(b.items) ? b.items : [];
  if (f.fullName.length < 2) return bad(res, 'Vui lòng nhập họ và tên.');
  if (!PHONE_RE.test(f.phone)) return bad(res, 'Số điện thoại không hợp lệ.');
  if (f.email && !EMAIL_RE.test(f.email)) return bad(res, 'Email không hợp lệ.');
  if (f.address.length < 10) return bad(res, 'Vui lòng nhập địa chỉ đầy đủ.');
  if (!items.length || items.length > 30) return bad(res, 'Giỏ hàng trống hoặc quá nhiều sản phẩm.');
  if (items.some((i) => !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 10)) return bad(res, 'Số lượng mỗi sản phẩm từ 1 đến 10.');

  const conn = await pool.getConnection();
  let order;
  try {
    await conn.beginTransaction();
    const [[region]] = await conn.query('SELECT * FROM shipping_regions WHERE code = ?', [f.region]);
    if (!region) { await conn.rollback(); return bad(res, 'Vui lòng chọn khu vực giao hàng.'); }

    const lines = [];
    for (const it of items) {
      const [[v]] = await conn.query(`
        SELECT v.id, v.stock, p.name, p.price, co.name AS color_name
        FROM product_variants v JOIN products p ON p.id = v.product_id JOIN colors co ON co.id = v.color_id
        WHERE p.id = ? AND v.size = ? AND co.code = ? AND p.status = 'active' AND v.is_active FOR UPDATE OF v`, [Number(it.id) || 0, str(it.size, 20), str(it.color, 20)]);
      if (!v) { await conn.rollback(); return bad(res, 'Có sản phẩm trong giỏ không còn bán. Vui lòng xóa và thêm lại.'); }
      if (v.stock < it.qty) { await conn.rollback(); return bad(res, `"${v.name}" (${it.size}, ${v.color_name}) chỉ còn ${v.stock} sản phẩm.`, 409); }
      lines.push({ ...v, size: str(it.size, 20), qty: it.qty });
    }

    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    let discount = 0, freeship = false, couponCode = null;
    if (b.couponCode) {
      const c = await findCoupon(conn, b.couponCode);
      if (c && subtotal >= c.minOrder) {
        couponCode = c.code;
        if (c.type === 'percent') discount = Math.round(subtotal * c.value / 100 / 1000) * 1000;
        if (c.type === 'fixed') discount = Math.min(c.value, subtotal);
        if (c.type === 'freeship') freeship = true;
      }
    }
    const shipping = freeship || (region.free_from !== null && subtotal >= region.free_from) ? 0 : region.fee;
    const total = subtotal - discount + shipping;
    if (f.payment === 'cod' && total >= 5000000) { await conn.rollback(); return bad(res, 'Đơn từ 5.000.000₫ cần thanh toán chuyển khoản.'); }
    // Khách bấm "Tôi đã chuyển khoản xong": ghi lại vào ghi chú để nhân viên đối chiếu
    const transferInfo = f.payment === 'bank' ? (str(b.transferInfo, 60) || `LUA ${f.phone}`) : null;
    if (f.payment === 'bank' && b.paidConfirmed) {
      f.note = `${PAID_CLAIM} ${transferInfo}]${f.note ? ' ' + f.note : ''}`.slice(0, 500);
    }

    const d = new Date(Date.now() + 7 * 3600e3);   // ngày theo giờ Việt Nam
    const code = `LUA${d.toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(100000 + Math.random() * 900000)}`;
    const [r] = await conn.query(`
      INSERT INTO orders (order_code, user_id, full_name, phone, email, region_code, address, note, payment_method, coupon_code, subtotal, discount, shipping_fee, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [code, req.session.userId || null, f.fullName, f.phone, f.email, f.region, f.address, f.note, f.payment, couponCode, subtotal, discount, shipping, total]);
    await conn.query('INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES (?, ?, ?, ?)',
      [r.insertId, 'pending', f.payment === 'bank' && b.paidConfirmed ? 'Đặt hàng — khách báo đã chuyển khoản' : 'Đặt hàng', req.session.userId || null]);
    for (const l of lines) {   // trigger trong CSDL tự kiểm tra & trừ tồn kho
      await conn.query('INSERT INTO order_items (order_id, variant_id, product_name, size, color_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [r.insertId, l.id, l.name, l.size, l.color_name, l.price, l.qty]);
    }
    if (couponCode) await conn.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', [couponCode]);
    // Khách đã đăng nhập: nhớ địa chỉ vừa dùng (và số điện thoại nếu tài khoản chưa có) để lần sau tự điền
    if (req.session.userId) {
      await conn.query('UPDATE users SET address = ?, region_code = ?, phone = COALESCE(phone, ?) WHERE id = ?',
        [f.address, f.region, f.phone, req.session.userId]);
    }
    await conn.commit();
    order = { id: r.insertId, code, f, lines, subtotal, discount, shipping, total, transferInfo, region: region.name };
  } catch (e) {
    await conn.rollback();
    if (e.code === PG.RAISED) return bad(res, 'Một sản phẩm vừa hết hàng. Vui lòng kiểm tra lại giỏ.', 409); // lỗi từ trigger tồn kho
    throw e;
  } finally {
    conn.release();
  }

  const o = order;
  const paidNow = o.f.payment === 'bank' && await payment.claimEarlyTransfer(o.id, o.f.phone, o.total);
  if (o.f.email) await notification.orderConfirmation(o);
  res.status(201).json({
    orderCode: o.code, subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, payment: o.f.payment,
    region: o.region, transferInfo: o.transferInfo, paid: !!paidNow, fullName: o.f.fullName, phone: o.f.phone, address: o.f.address,
    items: o.lines.map((l) => ({ name: l.name, size: l.size, color: l.color_name, qty: l.qty }))
  });
});

/* ---------- Khách hàng: đơn hàng của tôi ---------- */
router.get('/me/orders', auth(), async (req, res) => {
  const [orders] = await pool.query(`
    SELECT o.id, o.order_code, o.status, o.payment_method, o.payment_status, o.total, o.discount, o.shipping_fee, o.created_at, o.address, r.name AS region,
           (o.note LIKE '[Khách báo đã chuyển khoản%') AS claimed_paid
    FROM orders o JOIN shipping_regions r ON r.code = o.region_code
    WHERE o.user_id = ? ORDER BY o.created_at DESC`, [req.user.id]);
  const ids = orders.map((o) => o.id);
  const [items] = ids.length
    ? await pool.query(`SELECT i.order_id, i.product_name, i.size, i.color_name, i.quantity, i.line_total, v.product_id
                        FROM order_items i JOIN product_variants v ON v.id = i.variant_id WHERE i.order_id = ANY(?)`, [ids])
    : [[]];
  const [history] = ids.length
    ? await pool.query('SELECT order_id, status, note, created_at FROM order_status_history WHERE order_id = ANY(?) ORDER BY id', [ids])
    : [[]];
  res.json({
    user: publicUser(req.user),
    orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id), history: history.filter((h) => h.order_id === o.id) }))
  });
});

router.post('/me/orders/:code/cancel', auth(), async (req, res) => {
  const [r] = await pool.query("UPDATE orders SET status = 'cancelled' WHERE order_code = ? AND user_id = ? AND status = 'pending'", [req.params.code, req.user.id]);
  if (!r.affectedRows) return bad(res, 'Chỉ hủy được đơn đang chờ xác nhận.');
  await pool.query("INSERT INTO order_status_history (order_id, status, note, changed_by) SELECT id, 'cancelled', 'Khách tự hủy đơn', ?::int FROM orders WHERE order_code = ?", [req.user.id, req.params.code]);
  res.json({ ok: true });
});

/* ---------- Quản trị: đơn hàng (nhân viên + admin), mã giảm giá (admin) ---------- */
const admin = express.Router();

admin.get('/orders', async (req, res) => {
  const w = ['TRUE'], args = [];
  if (ORDER_STATUS.includes(req.query.status)) { w.push('o.status = ?'); args.push(req.query.status); }
  const q = str(req.query.q, 50);
  if (q) { w.push('(o.order_code ILIKE ? OR o.phone ILIKE ? OR o.full_name ILIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const [rows] = await pool.query(`
    SELECT o.id, o.order_code, o.full_name, o.phone, o.status, o.payment_method, o.payment_status, o.total, o.created_at,
           (o.note LIKE '[Khách báo đã chuyển khoản%') AS claimed_paid,
           (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o WHERE ${w.join(' AND ')}
    ORDER BY o.created_at DESC LIMIT 200`, args);
  res.json(rows);
});

admin.get('/orders/:id', async (req, res) => {
  const [[order]] = await pool.query('SELECT o.*, s.name AS region FROM orders o JOIN shipping_regions s ON s.code = o.region_code WHERE o.id = ?', [Number(req.params.id) || 0]);
  if (!order) return bad(res, 'Không tìm thấy đơn hàng.', 404);
  const [items] = await pool.query('SELECT product_name, size, color_name, unit_price, quantity, line_total FROM order_items WHERE order_id = ?', [order.id]);
  const [history] = await pool.query(`SELECT h.status, h.note, h.created_at, u.full_name AS by_name
    FROM order_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.order_id = ? ORDER BY h.id`, [order.id]);
  res.json({ ...order, items, history });
});

admin.patch('/orders/:id', async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { status, payment_status } = req.body || {};
  if (status && !ORDER_STATUS.includes(status)) return bad(res, 'Trạng thái không hợp lệ.');
  if (payment_status && !PAY_STATUS.includes(payment_status)) return bad(res, 'Trạng thái thanh toán không hợp lệ.');
  const [[o]] = await pool.query('SELECT status, payment_status, order_code FROM orders WHERE id = ?', [id]);
  if (!o) return bad(res, 'Không tìm thấy đơn hàng.', 404);
  if (['cancelled', 'returned'].includes(o.status)) return bad(res, 'Đơn đã hủy/trả hàng không thể thay đổi.');
  await pool.query('UPDATE orders SET status = COALESCE(?, status), payment_status = COALESCE(?, payment_status) WHERE id = ?',
    [status || null, payment_status || null, id]);   // hủy đơn -> trigger tự hoàn kho
  const changes = [status && status !== o.status && STATUS_VI[status], payment_status && payment_status !== o.payment_status && PAY_VI[payment_status]].filter(Boolean);
  if (changes.length) {
    await pool.query('INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES (?, ?, ?, ?)',
      [id, status || o.status, changes.join(' · '), req.user.id]);
    await audit(req, 'Cập nhật đơn', `${o.order_code}: ${changes.join(', ')}`);
  }
  res.json({ ok: true });
});

admin.get('/coupons', ADMIN_ONLY, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM coupons ORDER BY is_active DESC, code');
  res.json(rows);
});
admin.post('/coupons', ADMIN_ONLY, async (req, res) => {
  const b = req.body || {};
  const code = str(b.code, 30).toUpperCase(), type = b.type, value = Number(b.value || 0), minOrder = Number(b.minOrder || 0);
  if (!/^[A-Z0-9]{3,30}$/.test(code)) return bad(res, 'Mã chỉ gồm chữ in hoa và số (3–30 ký tự).');
  if (!['percent', 'fixed', 'freeship'].includes(type)) return bad(res, 'Loại mã không hợp lệ.');
  if (type === 'percent' && !(value >= 1 && value <= 100)) return bad(res, 'Phần trăm giảm từ 1 đến 100.');
  if (type === 'fixed' && !(value > 0)) return bad(res, 'Số tiền giảm phải lớn hơn 0.');
  try {
    await pool.query('INSERT INTO coupons (code, type, value, min_order, description, ends_at, usage_limit) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [code, type, type === 'freeship' ? 0 : value, minOrder, str(b.description, 150) || null, b.endsAt || null, b.usageLimit ? Number(b.usageLimit) : null]);
  } catch (e) {
    if (e.code === PG.DUPLICATE) return bad(res, 'Mã này đã tồn tại.', 409);
    throw e;
  }
  await audit(req, 'Tạo mã giảm giá', code);
  res.status(201).json({ ok: true });
});
admin.patch('/coupons/:code', ADMIN_ONLY, async (req, res) => {
  const on = !!(req.body && req.body.is_active);
  await pool.query('UPDATE coupons SET is_active = ? WHERE code = ?', [on, req.params.code]);
  await audit(req, on ? 'Bật mã giảm giá' : 'Tắt mã giảm giá', req.params.code);
  res.json({ ok: true });
});

module.exports = {
  name: 'order', version: '1.0', description: 'Mã giảm giá, đặt hàng, đơn hàng của khách, xử lý đơn',
  router, admin
};