// Kiểm thử tự động các quy tắc quan trọng của API — chạy: npm test
// Cần file .env có DATABASE_URL (Supabase) hợp lệ. Test tự bật server riêng ở cổng 3999 rồi tắt khi xong.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['--env-file=.env', 'server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('Server không khởi động được sau 15 giây')), 15000);
    server.stdout.on('data', (d) => { if (String(d).includes('Mở trình duyệt')) { clearTimeout(t); ok(); } });
    server.on('exit', (code) => fail(new Error(`Server dừng với mã ${code} — kiểm tra DATABASE_URL trong file .env`)));
  });
});
after(() => server && server.kill());

async function call(url, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0], headers: res.headers };
}
const login = async (email, password) => (await call('/api/auth/login', { method: 'POST', body: { email, password } })).cookie;
const guest = { fullName: 'Khách Test', phone: '0901234567', region: 'big', address: '12 Nguyễn Huệ, Quận 1, TP.HCM' };

test('Danh mục sản phẩm tải được', async () => {
  const r = await call('/api/catalog');
  assert.equal(r.status, 200);
  assert.ok(r.data.products.length > 0);
});

test('Tìm kiếm có phân trang, không dấu vẫn tìm được', async () => {
  const r = await call('/api/products?q=dam&limit=2');
  assert.equal(r.status, 200);
  assert.ok(r.data.total >= 1);
  assert.ok(r.data.items.length <= 2);
  assert.ok(r.data.items.every((p) => /đầm|váy/i.test(`${p.name} ${p.cat}`) || p.cat === 'vay'));
});

test('Chưa đăng nhập không vào được API quản trị', async () => {
  assert.equal((await call('/api/admin/stats')).status, 401);
});

test('Nhân viên không được thêm sản phẩm (chỉ admin)', async () => {
  const cookie = await login('nhanvien@lua.vn', 'Staff@123');
  const r = await call('/api/admin/products', { method: 'POST', cookie, body: { sku: 'X', name: 'Thử' } });
  assert.equal(r.status, 403);
});

test('Khách hàng không xem được doanh thu', async () => {
  const cookie = await login('hoa.nguyen@example.com', 'Khach@123');
  assert.equal((await call('/api/admin/stats', { cookie })).status, 403);
});

test('Đặt quá số lượng tồn kho bị chặn', async () => {
  const { data } = await call('/api/catalog');
  const [p, key] = data.products.flatMap((x) => Object.entries(x.stock).filter(([, n]) => n > 0 && n < 10).map(([k]) => [x, k]))[0];
  const [size, color] = key.split('|');
  const r = await call('/api/orders', { method: 'POST', body: { ...guest, payment: 'cod', items: [{ id: p.id, size, color, qty: p.stock[key] + 1 }] } });
  assert.equal(r.status, 409);
});

test('Đơn COD từ 5.000.000₫ bị từ chối', async () => {
  const { data } = await call('/api/catalog');
  const items = [];
  let sum = 0;
  for (const p of [...data.products].sort((a, b) => b.price - a.price)) {
    for (const [k, n] of Object.entries(p.stock)) {
      if (sum >= 5000000 || n < 1) continue;
      const qty = Math.min(n, 10, Math.ceil((5000000 - sum) / p.price));
      const [size, color] = k.split('|');
      items.push({ id: p.id, size, color, qty });
      sum += qty * p.price;
    }
  }
  const r = await call('/api/orders', { method: 'POST', body: { ...guest, payment: 'cod', items } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /chuyển khoản/);
});

test('Sai mật khẩu 5 lần thì bị khóa tạm (429)', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'khongco@lua.vn', password: 'sai' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'khongco@lua.vn', password: 'sai' } })).status, 429);
});

test('Quên mật khẩu không để lộ email có tồn tại hay không', async () => {
  const r = await call('/api/auth/forgot', { method: 'POST', body: { email: 'khongtontai@example.com' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
});

test('Webhook SePay từ chối khi sai khóa', async () => {
  const r = await call('/api/webhooks/sepay', { method: 'POST', headers: { authorization: 'Apikey sai' }, body: { transferType: 'in' } });
  assert.equal(r.status, 401);
});

test('Có header bảo mật (CSP, chống clickjacking)', async () => {
  const res = await fetch(BASE + '/');
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
});
