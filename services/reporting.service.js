// REPORTING SERVICE — số liệu tổng quan, doanh thu (chỉ admin), nhật ký thao tác.
const express = require('express');
const { pool } = require('../shared/db');
const { ADMIN_ONLY } = require('../shared/auth');

const admin = express.Router();

admin.get('/stats', async (req, res) => {
  const [byStatus] = await pool.query('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  const [lowStock] = await pool.query('SELECT * FROM v_low_stock LIMIT 8');
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM contact_messages WHERE NOT is_handled');
  const out = { role: req.user.role, byStatus, lowStock, unread };
  if (req.user.role === 'admin') {                           // doanh thu chỉ admin xem
    [out.revenue] = await pool.query('SELECT * FROM v_revenue_by_month ORDER BY month DESC LIMIT 12');
    [out.byCategory] = await pool.query(`
      SELECT c.name, SUM(i.line_total) AS revenue
      FROM order_items i JOIN orders o ON o.id = i.order_id
      JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
      WHERE o.status NOT IN ('cancelled', 'returned') GROUP BY c.id, c.name ORDER BY revenue DESC`);
    [out.topProducts] = await pool.query('SELECT name, sold_count FROM v_product_list ORDER BY sold_count DESC LIMIT 5');
    [[out.totals]] = await pool.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
      (SELECT COUNT(*) FROM newsletter_subscribers) AS subscribers,
      (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status NOT IN ('cancelled','returned')) AS revenue`);
  }
  res.json(out);
});

admin.get('/logs', ADMIN_ONLY, async (req, res) => {
  const [rows] = await pool.query(`SELECT l.action, l.detail, l.created_at, COALESCE(u.full_name, '—') AS by_name, u.role
    FROM admin_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 300`);
  res.json(rows);
});

module.exports = {
  name: 'reporting', version: '1.0', description: 'Tổng quan, doanh thu, nhật ký thao tác',
  admin
};
