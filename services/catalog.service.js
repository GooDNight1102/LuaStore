// CATALOG SERVICE — sản phẩm, biến thể (size/màu/tồn kho), ảnh, đánh giá.
// Hàm loadCatalog() là giao diện (interface) cho các service khác dùng lại (Admin, Order…).
const express = require('express');
const { pool, PG } = require('../shared/db');
const { bad, str } = require('../shared/http');
const { auth, ADMIN_ONLY, audit } = require('../shared/auth');
const payment = require('./payment.service');

const SIZE_ORDER = ['S', 'M', 'L', 'XL', 'Free size'];

/* ---------- Interface: đọc danh mục sản phẩm ---------- */
async function loadCatalog({ all = false, ids = null } = {}) {
  if (ids && !ids.length) return { products: [] };
  const only = ids ? [ids] : [];
  const [categories] = await pool.query('SELECT slug AS id, name FROM categories ORDER BY sort_order');
  const [colors] = await pool.query('SELECT code, name, hex FROM colors ORDER BY id');
  const [regions] = await pool.query('SELECT code, name, fee, free_from AS "freeFrom", eta FROM shipping_regions');
  const [rows] = await pool.query(`
    SELECT p.*, c.slug AS cat,
           (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE product_id = p.id) AS rating,
           (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) AS review_count
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE ${all ? 'TRUE' : "p.status = 'active'"} ${ids ? 'AND p.id = ANY(?)' : ''}
    ORDER BY p.id`, only);
  const [variants] = await pool.query(`
    SELECT v.id, v.product_id, v.size, co.code AS color, v.stock
    FROM product_variants v JOIN colors co ON co.id = v.color_id WHERE v.is_active ${ids ? 'AND v.product_id = ANY(?)' : ''} ORDER BY v.id`, only);
  const [images] = await pool.query(`SELECT product_id, url, color_code AS color FROM product_images ${ids ? 'WHERE product_id = ANY(?)' : ''} ORDER BY product_id, sort_order, id`, only);

  const products = rows.map((p) => {
    const vs = variants.filter((v) => v.product_id === p.id);
    const im = images.filter((i) => i.product_id === p.id).map(({ url, color }) => ({ url, color }));
    return {
      id: p.id, sku: p.sku, name: p.name, cat: p.cat, price: p.price, oldPrice: p.old_price,
      badge: p.badge, imageUrl: p.image_url, material: p.material, desc: p.description,
      featured: !!p.is_featured, isNew: !!p.is_new, sold: p.sold_count, status: p.status,
      rating: p.rating === null ? null : Number(p.rating), reviewCount: p.review_count, createdAt: p.created_at,
      sizes: [...new Set(vs.map((v) => v.size))].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b)),
      colors: [...new Set(vs.map((v) => v.color))],
      stock: Object.fromEntries(vs.map((v) => [`${v.size}|${v.color}`, v.stock])),
      // Bộ ảnh: mỗi ảnh gắn 1 màu (hoặc null = ảnh chung). Sản phẩm cũ chỉ có image_url -> 1 ảnh chung.
      images: im.length ? im : p.image_url ? [{ url: p.image_url, color: null }] : [],
      variants: all ? vs.map(({ id, size, color, stock }) => ({ id, size, color, stock })) : undefined
    };
  });

  return {
    categories,
    colors: Object.fromEntries(colors.map((c) => [c.code, { name: c.name, hex: c.hex }])),
    regions: Object.fromEntries(regions.map((r) => [r.code, r])),
    products,
    bank: payment.bankAccount()
  };
}

// Dữ liệu SEO cho trang chi tiết (thẻ OG + JSON-LD) — API Gateway gọi khi trả trang chitiet.html
async function productSeo(id) {
  const [[p]] = await pool.query(`
    SELECT p.id, p.sku, p.name, p.description, p.price, p.image_url,
           (SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = p.id AND is_active) AS stock,
           (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE product_id = p.id) AS rating,
           (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) AS reviews
    FROM products p WHERE p.id = ? AND p.status = 'active'`, [Number(id) || 0]);
  return p || null;
}

const router = express.Router();

// ponytail: trả về toàn bộ sản phẩm, lọc ở trình duyệt — ổn tới vài trăm sản phẩm; nhiều hơn thì chuyển lọc/phân trang sang SQL.
router.get('/catalog', async (req, res) => res.json(await loadCatalog()));

/* ---------- Tìm kiếm + lọc + phân trang ở server (trang Sản phẩm) ---------- */
const SORTS = { macdinh: 'p.is_featured DESC, p.id', moinhat: 'p.is_new DESC, p.id DESC', banchay: 'p.sold_count DESC', giatang: 'p.price', giagiam: 'p.price DESC' };
router.get('/products', async (req, res) => {
  const q = req.query, w = ["p.status = 'active'"], args = [];
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
  if (q.cat) { w.push('c.slug = ?'); args.push(String(q.cat)); }
  const [min, max] = String(q.price || '').split('-').map(Number);
  if (q.price && Number.isFinite(min) && Number.isFinite(max)) { w.push('p.price >= ? AND p.price < ?'); args.push(min, max); }
  const sizes = list(q.sizes), colors = list(q.colors);
  if (sizes.length) { w.push('EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.size = ANY(?))'); args.push(sizes); }
  if (colors.length) { w.push('EXISTS (SELECT 1 FROM product_variants v JOIN colors co ON co.id = v.color_id WHERE v.product_id = p.id AND v.is_active AND co.code = ANY(?))'); args.push(colors); }
  if (q.sale === '1') w.push('p.old_price IS NOT NULL');
  if (q.new === '1') w.push('p.is_new');
  // unaccent bỏ dấu tiếng Việt (gõ "dam" vẫn ra "Đầm")
  const kw = str(q.q, 100).toLowerCase().replace(/[\\%_]/g, '\\$&');
  if (kw) { w.push(`extensions.unaccent(LOWER(CONCAT_WS(' ', p.name, p.material, c.name))) LIKE extensions.unaccent(?)`); args.push(`%${kw}%`); }
  const size = Math.min(48, Math.max(1, Number(q.limit) || 12));
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const from = `FROM products p JOIN categories c ON c.id = p.category_id WHERE ${w.join(' AND ')}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, args);
  const [rows] = await pool.query(`SELECT p.id ${from} ORDER BY ${SORTS[q.sort] || SORTS.macdinh}, p.id LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size]);
  const { products } = await loadCatalog({ ids: rows.map((r) => r.id) });
  const byId = new Map(products.map((p) => [p.id, p]));
  res.json({ total, page, pages: Math.max(1, Math.ceil(total / size)), items: rows.map((r) => byId.get(r.id)) });
});

/* ---------- Đánh giá ---------- */
router.get('/products/:id/reviews', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT r.id, r.rating, r.content, r.created_at, r.user_id,
           COALESCE(u.full_name, 'Khách hàng') AS name,
           EXISTS (SELECT 1 FROM orders o
                   JOIN order_items i ON i.order_id = o.id
                   JOIN product_variants v ON v.id = i.variant_id
                   WHERE o.user_id = r.user_id AND v.product_id = r.product_id AND o.status = 'completed') AS verified
    FROM reviews r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ? ORDER BY r.created_at DESC`, [Number(req.params.id) || 0]);
  const mine = req.session.userId ? rows.some((r) => r.user_id === req.session.userId) : false;
  res.json({ reviews: rows.map(({ user_id, ...r }) => r), reviewedByMe: mine });
});

router.post('/products/:id/reviews', auth('customer'), async (req, res) => {
  const rating = Number(req.body.rating);
  const content = str(req.body.content, 1000);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad(res, 'Vui lòng chọn từ 1 đến 5 sao.');
  if (content.length < 10) return bad(res, 'Nội dung đánh giá cần ít nhất 10 ký tự.');
  try {
    await pool.query('INSERT INTO reviews (product_id, user_id, rating, content) VALUES (?, ?, ?, ?)', [Number(req.params.id) || 0, req.user.id, rating, content]);
  } catch (e) {
    if (e.code === PG.DUPLICATE) return bad(res, 'Bạn đã đánh giá sản phẩm này rồi.', 409);
    if (e.code === PG.FOREIGN_KEY) return bad(res, 'Sản phẩm không tồn tại.', 404);
    throw e;
  }
  res.status(201).json({ ok: true });
});

/* ---------- Quản trị: sản phẩm, tồn kho, đánh giá (gắn vào /api/admin) ---------- */
const admin = express.Router();

admin.get('/products', async (req, res) => res.json(await loadCatalog({ all: true })));

// Nhân viên được cập nhật tồn kho
admin.patch('/variants/:id', async (req, res) => {
  const stock = Number(req.body && req.body.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 99999) return bad(res, 'Tồn kho phải là số nguyên từ 0.');
  const [x] = await pool.query('UPDATE product_variants SET stock = ? WHERE id = ?', [stock, Number(req.params.id) || 0]);
  if (!x.affectedRows) return bad(res, 'Không tìm thấy biến thể.', 404);
  const [[v]] = await pool.query('SELECT p.sku, v.size, co.name AS color FROM product_variants v JOIN products p ON p.id = v.product_id JOIN colors co ON co.id = v.color_id WHERE v.id = ?', [Number(req.params.id)]);
  await audit(req, 'Sửa tồn kho', `${v.sku} ${v.size}/${v.color} = ${stock}`);
  res.json({ ok: true });
});

// Thêm / sửa / ngừng bán sản phẩm: chỉ admin
async function saveProduct(req, res, id) {
  const b = req.body || {};
  const p = {
    sku: str(b.sku, 20).toUpperCase(), name: str(b.name, 150), cat: str(b.cat, 50),
    price: Number(b.price), old_price: b.oldPrice ? Number(b.oldPrice) : null,
    material: str(b.material, 150) || null, description: str(b.desc, 2000) || null, badge: str(b.badge, 30) || null,
    image_url: str(b.imageUrl, 255) || null, is_featured: !!b.featured, is_new: !!b.isNew,
    status: ['active', 'hidden', 'discontinued'].includes(b.status) ? b.status : 'active'
  };
  const sizes = (Array.isArray(b.sizes) ? b.sizes : []).map((s) => str(s, 20)).filter(Boolean);
  const colors = (Array.isArray(b.colors) ? b.colors : []).map((c) => str(c, 20)).filter(Boolean);
  if (!p.sku || p.name.length < 2) return bad(res, 'Cần nhập mã SKU và tên sản phẩm.');
  if (!Number.isFinite(p.price) || p.price <= 0) return bad(res, 'Giá bán phải lớn hơn 0.');
  if (p.old_price !== null && !(p.old_price > p.price)) return bad(res, 'Giá gốc phải lớn hơn giá bán (hoặc để trống).');
  if (p.image_url && !/^https?:\/\//.test(p.image_url) && !p.image_url.startsWith('/')) return bad(res, 'Đường dẫn ảnh phải bắt đầu bằng http(s):// hoặc /');
  // Bộ ảnh: [{ url, color: tên màu admin gõ (hoặc để trống = ảnh chung), hex }]
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 30)
    .map((i) => ({ url: str(i && i.url, 255), color: str(i && i.color, 50), hex: /^#[0-9a-f]{6}$/i.test(i && i.hex) ? i.hex : '#9c7b56' }))
    .filter((i) => i.url);
  if (images.some((i) => !/^https?:\/\//.test(i.url) && !i.url.startsWith('/'))) return bad(res, 'Đường dẫn ảnh phải bắt đầu bằng http(s):// hoặc /');
  if (images.length) p.image_url = images[0].url;       // ảnh đầu tiên = ảnh đại diện
  // Đổi tên màu -> mã màu; màu chưa có thì tạo mới. Màu gắn với ảnh tự được thêm vào danh sách màu của sản phẩm.
  for (const img of images) {
    if (!img.color) { img.code = null; continue; }
    const [[c]] = await pool.query('SELECT code FROM colors WHERE LOWER(name) = LOWER(?) OR code = ?', [img.color, img.color]);
    if (c) img.code = c.code;
    else {
      const slug = img.color.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 14) || 'mau';
      img.code = `${slug}-${Date.now().toString(36).slice(-4)}`;
      await pool.query('INSERT INTO colors (code, name, hex) VALUES (?, ?, ?)', [img.code, img.color, img.hex]);
      colors.push(img.code);   // màu mới tạo từ ảnh -> tự thêm vào sản phẩm
    }
  }
  if (!sizes.length || !colors.length) return bad(res, 'Chọn ít nhất 1 size và 1 màu.');
  const [[cat]] = await pool.query('SELECT id FROM categories WHERE slug = ?', [p.cat]);
  if (!cat) return bad(res, 'Danh mục không hợp lệ.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const vals = [p.sku, p.name, cat.id, p.price, p.old_price, p.material, p.description, p.badge, p.image_url, p.is_featured, p.is_new, p.status];
    if (id) {
      const [x] = await conn.query(`UPDATE products SET sku=?, name=?, category_id=?, price=?, old_price=?, material=?, description=?, badge=?, image_url=?, is_featured=?, is_new=?, status=? WHERE id=?`, [...vals, id]);
      if (!x.affectedRows) { await conn.rollback(); return bad(res, 'Không tìm thấy sản phẩm.', 404); }
    } else {
      const [x] = await conn.query(`INSERT INTO products (sku, name, category_id, price, old_price, material, description, badge, image_url, is_featured, is_new, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, vals);
      id = x.insertId;
    }
    if (Array.isArray(b.images)) {
      await conn.query('DELETE FROM product_images WHERE product_id = ?', [id]);
      for (const [n, img] of images.entries()) await conn.query('INSERT INTO product_images (product_id, url, color_code, sort_order) VALUES (?, ?, ?, ?)', [id, img.url, img.code, n]);
    }
    // Tạo biến thể còn thiếu (tồn kho 0). Không xóa biến thể cũ vì đơn hàng cũ còn tham chiếu.
    for (const s of sizes) for (const c of colors) {
      await conn.query(`INSERT INTO product_variants (product_id, size, color_id, stock) SELECT ?::int, ?::text, id, 0 FROM colors WHERE code = ?
        ON CONFLICT (product_id, size, color_id) DO NOTHING`, [id, s, c]);
    }
    // Size/màu bị bỏ tick -> ẩn biến thể (không xóa vì đơn cũ còn tham chiếu). Tick lại -> hiện lại với tồn kho cũ.
    await conn.query(`UPDATE product_variants v SET is_active = (v.size = ANY(?) AND co.code = ANY(?))
      FROM colors co WHERE co.id = v.color_id AND v.product_id = ?`, [sizes, colors, id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.code === PG.DUPLICATE) return bad(res, 'Mã SKU đã tồn tại.', 409);
    throw e;
  } finally { conn.release(); }
  await audit(req, req.params.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm', `${p.sku} — ${p.name}`);
  res.status(201).json({ id });
}

admin.post('/products', ADMIN_ONLY, (req, res) => saveProduct(req, res, null));
admin.put('/products/:id', ADMIN_ONLY, (req, res) => saveProduct(req, res, Number(req.params.id) || 0));
// Không xóa hẳn vì đơn hàng cũ còn tham chiếu — chuyển sang "ngừng bán"
admin.delete('/products/:id', ADMIN_ONLY, async (req, res) => {
  await pool.query("UPDATE products SET status = 'discontinued' WHERE id = ?", [Number(req.params.id) || 0]);
  await audit(req, 'Ngừng bán sản phẩm', `#${req.params.id}`);
  res.json({ ok: true });
});

admin.get('/reviews', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT r.id, r.rating, r.content, r.created_at, p.name AS product, COALESCE(u.full_name, 'Khách hàng') AS author
    FROM reviews r JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC LIMIT 200`);
  res.json(rows);
});
admin.delete('/reviews/:id', async (req, res) => {
  await pool.query('DELETE FROM reviews WHERE id = ?', [Number(req.params.id) || 0]);
  res.json({ ok: true });
});

module.exports = {
  name: 'catalog', version: '1.0', description: 'Sản phẩm, biến thể, tồn kho, đánh giá',
  router, admin, loadCatalog, productSeo
};
