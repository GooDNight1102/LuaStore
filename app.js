// LỤA — API GATEWAY (cổng vào duy nhất của hệ thống theo kiến trúc SOA)
//   1. Lớp dùng chung cho mọi service: header bảo mật, đọc JSON, phiên đăng nhập
//   2. Gắn các service trong services/index.js vào /api và /api/admin
//   3. Trả trang giao diện (thư mục public/)
// Chạy ở máy: server.js gọi app.listen(). Chạy trên Vercel: api/index.js xuất app này thành hàm serverless.
const express = require('express');
const session = require('express-session');
const fs = require('fs/promises');
const path = require('path');
const helmet = require('helmet');
const { pool, PG } = require('./shared/db');
const { bad, esc } = require('./shared/http');
const { STAFF, DbSessionStore } = require('./shared/auth');
const registry = require('./services');
const catalog = require('./services/catalog.service');

const app = express();
const PUBLIC = path.join(__dirname, 'public');

if (!process.env.SESSION_SECRET) console.warn('⚠  Chưa đặt SESSION_SECRET — đang dùng chuỗi tạm.');
// Chạy sau proxy (Vercel, Render…): lấy đúng IP khách và nhận biết HTTPS để gửi cookie an toàn
if (process.env.VERCEL || process.env.TRUST_PROXY) app.set('trust proxy', 1);

// Header bảo mật: chống clickjacking, chặn script lạ (CSP), chống đoán kiểu file…
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'script-src': ["'self'", 'https://cdn.jsdelivr.net'],                 // Chart.js ở trang quản trị
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'https:'],                             // ảnh QR VietQR, ảnh Supabase Storage, ảnh dán link
      'frame-src': ['https://www.google.com', 'https://maps.google.com'],     // bản đồ Google Maps ở trang Liên hệ
      'upgrade-insecure-requests': null                                     // cho phép chạy http://localhost
    }
  }
}));

app.use(express.json({ limit: '100kb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lua-dev-secret',
  store: new DbSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 3600 * 1000 }
}));

/* ---------- Thông tin hệ thống ---------- */
app.get('/api/health', async (req, res) => {
  try {
    const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM products');
    res.json({ ok: true, database: 'supabase-postgres', products: r.n });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});
app.get('/api/services', (req, res) => res.json(registry.describe()));   // danh bạ service + hợp đồng endpoint

/* ---------- Gắn các service ---------- */
for (const s of registry.services) if (s.router) app.use('/api', s.router);
const adminRouters = registry.services.filter((s) => s.admin).map((s) => s.admin);
app.use('/api/admin', STAFF, ...adminRouters);                             // mọi API quản trị: nhân viên hoặc admin

/* ---------- Chặn trang quản trị với người không đủ quyền ---------- */
app.get('/admin.html', async (req, res, next) => {
  const [[u]] = req.session.userId ? await pool.query('SELECT role, is_active FROM users WHERE id = ?', [req.session.userId]) : [[]];
  if (!u || !u.is_active || !['staff', 'admin'].includes(u.role)) return res.redirect('/dangnhap.html?next=admin.html');
  next();
});

/* ---------- Trang HTML: điền địa chỉ website vào thẻ OG; trang chi tiết thêm OG + JSON-LD theo sản phẩm ---------- */
async function productMeta(html, req, origin) {
  const p = await catalog.productSeo(req.query.id);
  if (!p) return html;
  const url = `${origin}${req.originalUrl}`;
  const img = p.image_url ? (p.image_url.startsWith('/') ? origin + p.image_url : p.image_url) : `${origin}/og-image.png`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.sku, description: p.description, image: img,
    brand: { '@type': 'Brand', name: 'LỤA' },
    offers: { '@type': 'Offer', price: p.price, priceCurrency: 'VND', url, availability: `https://schema.org/${p.stock > 0 ? 'InStock' : 'OutOfStock'}` },
    ...(p.reviews ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(p.rating), reviewCount: p.reviews } } : {})
  };
  return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(p.name)} — LỤA</title>
<meta name="description" content="${esc(p.description || '')}">
<meta property="og:site_name" content="LỤA">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(p.name)} — LỤA">
<meta property="og:description" content="${esc(p.description || '')}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}">
<meta property="product:price:amount" content="${p.price}">
<meta property="product:price:currency" content="VND">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
}

app.get(/^\/([a-z0-9_-]+\.html)?$/i, async (req, res, next) => {
  const page = req.params[0] || 'index.html';
  let html;
  try { html = await fs.readFile(path.join(PUBLIC, page), 'utf8'); } catch { return next(); }
  const origin = `${req.protocol}://${req.get('host')}`;
  html = html.replaceAll('%ORIGIN%', origin);
  if (page === 'chitiet.html') html = await productMeta(html, req, origin);
  res.type('html').send(html);
});

app.use(express.static(PUBLIC));

app.use('/api', (req, res) => bad(res, 'Không tìm thấy API.', 404));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, 'File quá lớn. Ảnh tối đa 4MB.', 413);
  if (err.code === PG.NO_TABLE) {
    console.error(`⚠  Thiếu bảng: ${err.message} — hãy chạy: npm run setup`);
    return bad(res, 'Cơ sở dữ liệu chưa được tạo. Vui lòng chạy npm run setup.', 503);
  }
  console.error(err);
  bad(res, 'Lỗi máy chủ. Vui lòng thử lại sau.', 500);
});

module.exports = app;
