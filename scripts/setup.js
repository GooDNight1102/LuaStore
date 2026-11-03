// Đẩy cơ sở dữ liệu lên Supabase: npm run setup
// Chạy toàn bộ supabase/schema.sql (tạo bảng, trigger, view, bảo mật, kho ảnh, dữ liệu mẫu) qua DATABASE_URL trong .env.
// CSDL đã có dữ liệu thì dừng lại để tránh xóa nhầm — muốn xóa hết và tạo lại: npm run setup -- --reset
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✘ Chưa có DATABASE_URL trong file .env');
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  console.log(`🔌 Đã kết nối: ${url.replace(/:[^:@/]+@/, ':****@')}`);

  const { rows: [r] } = await client.query("SELECT to_regclass('public.products') IS NOT NULL AS has");
  if (r.has && !process.argv.includes('--reset')) {
    const { rows: [n] } = await client.query('SELECT COUNT(*)::int AS n FROM orders');
    console.log(`ℹ  CSDL đã được tạo trước đó (${n.n} đơn hàng). Không làm gì để tránh mất dữ liệu.`);
    console.log('   Muốn XÓA HẾT và tạo lại dữ liệu mẫu: npm run setup -- --reset');
    return;
  }

  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  console.log('⏳ Đang tạo bảng, trigger, view và dữ liệu mẫu…');
  await client.query(sql);   // nhiều câu lệnh trong một lần gửi, chạy tuần tự
  const { rows: [c] } = await client.query(`SELECT
    (SELECT COUNT(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables,
    (SELECT COUNT(*)::int FROM products) AS products,
    (SELECT COUNT(*)::int FROM users) AS users`);
  console.log(`✔ Xong: ${c.tables} bảng, ${c.products} sản phẩm, ${c.users} tài khoản mẫu. Chạy web: npm run dev`);
})()
  .catch((e) => {
    const hints = {
      ENOTFOUND: 'Sai địa chỉ máy chủ trong DATABASE_URL.',
      '28P01': 'Sai mật khẩu database (phần sau dấu ":" trước "@") trong DATABASE_URL.',
      XX000: 'Sai tên người dùng — với Session pooler phải là postgres.<mã-project>, không phải postgres.'
    };
    console.error(`✘ Lỗi: ${e.message}${hints[e.code] ? `\n  → ${hints[e.code]}` : ''}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
