// Chạy website ở máy cá nhân: npm start (đọc cấu hình từ file .env)
// Trên Vercel không dùng file này — Vercel chạy api/index.js.
const app = require('./app');
const { pool } = require('./shared/db');
const registry = require('./services');

const PORT = Number(process.env.PORT || 3000);

pool.query('SELECT COUNT(*) AS n FROM products')
  .then(([[r]]) => {
    console.log(`🧩 ${registry.services.length} service: ${registry.services.map((s) => s.name).join(', ')}`);
    app.listen(PORT, () => console.log(`✔ Đã kết nối Supabase (${r.n} sản phẩm). Mở trình duyệt: http://localhost:${PORT}/index.html`));
  })
  .catch((e) => {
    const hints = {
      ENOTFOUND: 'Sai địa chỉ máy chủ trong DATABASE_URL.',
      ECONNREFUSED: 'Không kết nối được — kiểm tra DATABASE_URL (Session pooler dùng cổng 5432).',
      '28P01': 'Sai mật khẩu database trong DATABASE_URL.',
      '42P01': 'Chưa có bảng — hãy chạy: npm run setup',
      XX000: 'Sai tên người dùng — với Session pooler phải là postgres.<mã-project>.'
    };
    console.error(`✘ Không kết nối được CSDL: ${e.code || e.message}\n  → ${hints[e.code] || e.message}`);
    process.exit(1);
  });
