// Kết nối CSDL PostgreSQL trên Supabase — dùng chung cho mọi service.
// Giữ cách gọi quen thuộc: const [rows] = await pool.query('... WHERE id = ?', [id])
//   - Dấu ? tự đổi thành $1, $2… của PostgreSQL
//   - Câu INSERT … RETURNING id: rows.insertId = id vừa tạo
//   - Câu UPDATE/DELETE: rows.affectedRows = số dòng bị ảnh hưởng
const { Pool, types } = require('pg');

// Kiểu số lớn / thời gian: trả về giống MySQL cũ để giao diện không phải sửa
types.setTypeParser(20, Number);                       // bigint (COUNT, SUM…) -> number
types.setTypeParser(1700, Number);                     // numeric (ROUND, AVG…) -> number
// timestamptz -> chuỗi "YYYY-MM-DD HH:MM:SS" theo giờ Việt Nam (UTC+7, không đổi giờ mùa hè)
types.setTypeParser(1184, (v) => new Date(new Date(v).getTime() + 7 * 3600e3).toISOString().slice(0, 19).replace('T', ' '));

if (!process.env.DATABASE_URL) console.warn('⚠  Chưa đặt DATABASE_URL trong file .env / Vercel — chưa kết nối được Supabase.');

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '');
const pg = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: local ? false : { rejectUnauthorized: false },  // Supabase bắt buộc SSL
  // Session pooler giữ nguyên 1 kết nối cho mỗi client và giới hạn tổng số kết nối của project,
  // nên trên Vercel mỗi hàm serverless chỉ mở tối đa 2 kết nối và trả lại sớm khi rảnh.
  max: process.env.VERCEL ? 2 : 10,
  idleTimeoutMillis: process.env.VERCEL ? 5000 : 30000
});

const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

async function run(client, sql, params = []) {
  const r = await client.query(toPg(sql), params);
  const rows = r.rows;
  rows.affectedRows = r.rowCount;
  rows.insertId = rows[0] && rows[0].id;
  return [rows];
}

const pool = {
  query: (sql, params) => run(pg, sql, params),
  // Giao dịch (transaction): conn.beginTransaction / commit / rollback / release
  async getConnection() {
    const c = await pg.connect();
    return {
      query: (sql, params) => run(c, sql, params),
      beginTransaction: () => c.query('BEGIN'),
      commit: () => c.query('COMMIT'),
      rollback: () => c.query('ROLLBACK'),
      release: () => c.release()
    };
  }
};

// Mã lỗi PostgreSQL hay dùng
const PG = { DUPLICATE: '23505', FOREIGN_KEY: '23503', RAISED: 'P0001', NO_TABLE: '42P01' };

module.exports = { pool, PG };
