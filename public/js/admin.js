/* =========================================================
   Trang Quản trị — nhân viên & admin
   Menu hiện theo vai trò; quyền thật sự do server kiểm tra (admin-api.js).
   ========================================================= */
(function () {
  const { $, $$, money, escapeHTML: h, api, statusPill, ORDER_STATUS, PAY_STATUS, toast } = LUA;
  let me = null;

  const TABS = [
    { id: 'tong-quan',  label: 'Tổng quan',       roles: ['staff', 'admin'], render: dashboard },
    { id: 'don-hang',   label: 'Đơn hàng',        roles: ['staff', 'admin'], render: orders },
    { id: 'san-pham',   label: 'Sản phẩm & kho',  roles: ['staff', 'admin'], render: products },
    { id: 'tin-nhan',   label: 'Tin nhắn',        roles: ['staff', 'admin'], render: messages },
    { id: 'danh-gia',   label: 'Đánh giá',        roles: ['staff', 'admin'], render: reviews },
    { id: 'ma-giam-gia', label: 'Mã giảm giá',    roles: ['admin'], render: coupons },
    { id: 'tai-khoan',  label: 'Tài khoản',       roles: ['admin'], render: users },
    { id: 'nhan-tin',   label: 'Đăng ký nhận tin', roles: ['admin'], render: newsletter },
    { id: 'giao-dich',  label: 'Giao dịch ngân hàng', roles: ['staff', 'admin'], render: bankTx },
    { id: 'nhat-ky',    label: 'Nhật ký thao tác', roles: ['admin'], render: logs }
  ];
  const ROLE_NAME = { customer: 'Khách hàng', staff: 'Nhân viên', admin: 'Quản trị viên' };
  const panel = () => $('#adminPanel');
  const date = (d) => h(String(d || '').slice(0, 16));
  const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v}</option>`).join('');
  const fail = (e) => toast(h(e.message));

  /* ---------- Khởi động ---------- */
  LUA.me().then((u) => {
    if (!u || u.role === 'customer') return location.replace('dangnhap.html?next=admin.html');
    me = u;
    $('#adminUser').innerHTML = `${h(u.fullName)} <span class="pill role-${u.role}">${ROLE_NAME[u.role]}</span>`;
    const tabs = TABS.filter((t) => t.roles.includes(u.role));
    $('#adminNav').innerHTML = tabs.map((t) => `<a href="#${t.id}" data-tab="${t.id}">${t.label}</a>`).join('');
    window.addEventListener('hashchange', route);
    route();
  });

  function route() {
    const tabs = TABS.filter((t) => t.roles.includes(me.role));
    const tab = tabs.find((t) => `#${t.id}` === location.hash) || tabs[0];
    $$('#adminNav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === tab.id));
    $('#adminTitle').textContent = tab.label;
    panel().innerHTML = '<div class="skeleton sk-block"></div>';
    panel().onclick = panel().onchange = panel().oninput = panel().onkeydown = null;   // bỏ xử lý sự kiện của tab trước
    tab.render().catch((e) => { panel().innerHTML = `<p class="form-note err">${h(e.message)}</p>`; });
  }

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = 'dangnhap.html';
  });

  /* ---------- Tổng quan ---------- */
  async function dashboard() {
    const s = await api('/api/admin/stats');
    const count = (st) => (s.byStatus.find((x) => x.status === st) || { n: 0 }).n;
    const maxRev = Math.max(1, ...(s.revenue || []).map((r) => r.revenue));
    panel().innerHTML = `
      <div class="stat-grid">
        <a class="stat" href="#don-hang" data-status="pending"><span>Đơn chờ xác nhận</span><strong>${count('pending')}</strong></a>
        <a class="stat" href="#don-hang"><span>Đang giao</span><strong>${count('shipping')}</strong></a>
        <a class="stat" href="#tin-nhan"><span>Tin nhắn chưa xử lý</span><strong>${s.unread}</strong></a>
        ${s.totals ? `
        <div class="stat"><span>Doanh thu (không tính đơn hủy)</span><strong>${money(s.totals.revenue)}</strong></div>
        <div class="stat"><span>Khách hàng có tài khoản</span><strong>${s.totals.customers}</strong></div>
        <div class="stat"><span>Người đăng ký nhận tin</span><strong>${s.totals.subscribers}</strong></div>` : ''}
      </div>
      <div class="admin-cols">
        ${s.revenue ? `
        <section class="admin-card chart-card">
          <h2>Biểu đồ doanh thu 12 tháng</h2>
          <div class="chart-box"><canvas id="revChart" aria-label="Biểu đồ doanh thu theo tháng" role="img"></canvas></div>
        </section>
        <section class="admin-card chart-card">
          <h2>Doanh thu theo danh mục</h2>
          <div class="chart-box"><canvas id="catChart" aria-label="Biểu đồ doanh thu theo danh mục" role="img"></canvas></div>
        </section>
        <section class="admin-card">
          <h2>Doanh thu theo tháng</h2>
          <table class="data-table"><thead><tr><th>Tháng</th><th>Đơn</th><th>Doanh thu</th></tr></thead><tbody>
          ${s.revenue.map((r) => `<tr><td>${h(r.month)}</td><td>${r.order_count}</td><td><div class="bar-cell"><i style="width:${(r.revenue / maxRev) * 100}%"></i><span>${money(r.revenue)}</span></div></td></tr>`).join('')}
          </tbody></table>
        </section>
        <section class="admin-card">
          <h2>Bán chạy nhất</h2>
          <table class="data-table"><tbody>${s.topProducts.map((p) => `<tr><td>${h(p.name)}</td><td class="num">${p.sold_count}</td></tr>`).join('')}</tbody></table>
        </section>` : ''}
        <section class="admin-card">
          <h2>Sắp hết hàng (≤ 3)</h2>
          ${s.lowStock.length ? `<table class="data-table"><thead><tr><th>Sản phẩm</th><th>Size</th><th>Màu</th><th>Tồn</th></tr></thead><tbody>
          ${s.lowStock.map((v) => `<tr><td>${h(v.name)}</td><td>${h(v.size)}</td><td>${h(v.color)}</td><td class="num"><span class="pill ${v.stock ? 'warn' : 'bad'}">${v.stock}</span></td></tr>`).join('')}
          </tbody></table>` : '<p class="muted">Không có biến thể nào sắp hết.</p>'}
        </section>
      </div>`;
    panel().querySelector('[data-status]').addEventListener('click', () => { orderFilter.status = 'pending'; });
    if (s.revenue) drawCharts(s).catch(() => $$('.chart-card').forEach((c) => c.remove()));   // mất mạng: vẫn còn bảng số liệu
  }

  // Biểu đồ bằng Chart.js (tải từ CDN khi cần)
  let chartLib;
  const loadChartJs = () => chartLib || (chartLib = new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';
    sc.onload = ok; sc.onerror = fail;
    document.head.append(sc);
  }));
  async function drawCharts(s) {
    await loadChartJs();
    if (!$('#revChart')) return;   // đã chuyển tab khác trong lúc tải
    const css = getComputedStyle(document.documentElement);
    const c = (name) => css.getPropertyValue(name).trim();
    Chart.defaults.font.family = c('--font-body');
    Chart.defaults.color = c('--ink-soft');
    const months = [...s.revenue].reverse();
    const vnd = (v) => Number(v).toLocaleString('vi-VN') + '₫';
    new Chart($('#revChart'), {
      data: {
        labels: months.map((m) => m.month.split('-').reverse().join('/')),
        datasets: [
          { type: 'bar', label: 'Doanh thu', data: months.map((m) => m.revenue), backgroundColor: c('--wine'), borderRadius: 3, yAxisID: 'y' },
          { type: 'line', label: 'Số đơn', data: months.map((m) => m.order_count), borderColor: c('--brass'), backgroundColor: c('--brass'), tension: 0.3, yAxisID: 'y1' }
        ]
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: (x) => x.dataset.yAxisID === 'y' ? `Doanh thu: ${vnd(x.raw)}` : `Số đơn: ${x.raw}` } } },
        scales: {
          y: { ticks: { callback: (v) => `${v / 1e6}tr` }, grid: { color: c('--line') } },
          y1: { position: 'right', grid: { display: false }, ticks: { precision: 0 } }
        }
      }
    });
    new Chart($('#catChart'), {
      type: 'doughnut',
      data: {
        labels: s.byCategory.map((x) => x.name),
        datasets: [{ data: s.byCategory.map((x) => x.revenue), backgroundColor: [c('--wine'), c('--brass'), c('--swatch-2'), c('--swatch-4'), c('--swatch-5')], borderColor: c('--paper-raise') }]
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (x) => `${x.label}: ${vnd(x.raw)}` } } } }
    });
  }

  /* ---------- Đơn hàng ---------- */
  const orderFilter = { status: '', q: '' };
  async function orders() {
    const qs = new URLSearchParams(orderFilter).toString();
    const rows = await api(`/api/admin/orders?${qs}`);
    panel().innerHTML = `
      <form class="admin-toolbar" id="orderFilter">
        <select class="select" name="status" aria-label="Lọc trạng thái"><option value="">Tất cả trạng thái</option>${opts(ORDER_STATUS, orderFilter.status)}</select>
        <input class="input" name="q" placeholder="Mã đơn, tên, số điện thoại" value="${h(orderFilter.q)}" aria-label="Tìm đơn hàng">
        <button class="btn" type="submit">Lọc</button>
        <span class="muted">${rows.length} đơn</span>
        <button class="btn" type="button" id="exportCsv">Xuất Excel (CSV)</button>
      </form>
      <div class="table-wrap"><table class="data-table admin-table">
        <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>SL</th><th>Tổng</th><th>Trạng thái</th><th>Thanh toán</th><th>Ngày đặt</th><th></th></tr></thead>
        <tbody>${rows.map((o) => {
          const locked = ['cancelled', 'returned'].includes(o.status);
          return `<tr data-id="${o.id}">
            <td><strong>${h(o.order_code)}</strong></td>
            <td>${h(o.full_name)}<br><small class="muted">${h(o.phone)}</small></td>
            <td class="num">${o.item_count}</td>
            <td class="num">${money(o.total)}</td>
            <td>${locked ? statusPill(o.status) : `<select class="select sm" data-field="status" aria-label="Trạng thái ${h(o.order_code)}">${opts(ORDER_STATUS, o.status)}</select>`}</td>
            <td>${locked ? PAY_STATUS[o.payment_status] : `<select class="select sm" data-field="payment_status" aria-label="Thanh toán ${h(o.order_code)}">${opts(PAY_STATUS, o.payment_status)}</select>`}<br><small class="muted">${o.payment_method === 'cod' ? 'COD' : 'Chuyển khoản'}</small>${o.claimed_paid && o.payment_status === 'unpaid' ? '<br><span class="pill warn" title="Khách đã bấm Tôi đã chuyển khoản xong — kiểm tra tài khoản ngân hàng rồi chọn Đã thanh toán">Khách báo đã CK</span>' : ''}</td>
            <td>${date(o.created_at)}</td>
            <td><button type="button" class="link-btn" data-detail>Chi tiết</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;

    // Xuất danh sách đơn đang lọc ra file CSV (Excel mở được, giữ tiếng Việt nhờ ký tự BOM)
    $('#exportCsv').onclick = () => {
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['Mã đơn', 'Khách hàng', 'Điện thoại', 'Số lượng', 'Tổng tiền', 'Trạng thái', 'Thanh toán', 'Hình thức', 'Ngày đặt']]
        .concat(rows.map((o) => [o.order_code, o.full_name, `'${o.phone}`, o.item_count, o.total, ORDER_STATUS[o.status], PAY_STATUS[o.payment_status], o.payment_method === 'cod' ? 'COD' : 'Chuyển khoản', String(o.created_at).slice(0, 16)]));
      const blob = new Blob(['\ufeff' + lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `don-hang-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(a.href);
    };

    $('#orderFilter').addEventListener('submit', (e) => {
      e.preventDefault();
      orderFilter.status = e.target.status.value;
      orderFilter.q = e.target.q.value.trim();
      orders().catch(fail);
    });
    panel().onchange = async (e) => {
      const sel = e.target.closest('[data-field]');
      if (!sel) return;
      const id = sel.closest('tr').dataset.id;
      if (sel.value === 'cancelled' && !confirmInline(sel, 'Hủy đơn sẽ hoàn lại tồn kho. Chọn "Đã hủy" lần nữa để xác nhận.')) return;
      try {
        await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: { [sel.dataset.field]: sel.value } });
        toast('Đã cập nhật đơn hàng.');
        if (sel.value === 'cancelled') orders().catch(fail);
      } catch (err) { fail(err); orders().catch(fail); }
    };
    panel().onclick = async (e) => {
      const b = e.target.closest('[data-detail]');
      if (!b) return;
      const tr = b.closest('tr');
      if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('detail-row')) { tr.nextElementSibling.remove(); return; }
      const o = await api(`/api/admin/orders/${tr.dataset.id}`).catch(fail);
      if (!o) return;
      tr.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="8">
        <div class="order-detail">
          <div><strong>Giao đến:</strong> ${h(o.address)} (${h(o.region)})<br>
          ${o.email ? `<strong>Email:</strong> ${h(o.email)}<br>` : ''}${o.note ? `<strong>Ghi chú:</strong> ${h(o.note)}<br>` : ''}
          <strong>Tạm tính:</strong> ${money(o.subtotal)} · <strong>Giảm:</strong> ${money(o.discount)}${o.coupon_code ? ` (${h(o.coupon_code)})` : ''} · <strong>Ship:</strong> ${money(o.shipping_fee)}</div>
          <ul>${o.items.map((i) => `<li>${h(i.product_name)} — ${h(i.color_name)}, ${h(i.size)} × ${i.quantity} = ${money(i.line_total)}</li>`).join('')}</ul>
          <ol class="timeline">${o.history.map((x) => `<li class="tl-${x.status}"><time>${date(x.created_at)}</time>
            <strong>${ORDER_STATUS[x.status] || h(x.status)}</strong><span>${h(x.note || '')}${x.by_name ? ` — ${h(x.by_name)}` : ''}</span></li>`).join('')}</ol>
        </div></td></tr>`);
    };
  }

  // Xác nhận thao tác nguy hiểm ngay trên trang (trình duyệt nhúng có thể chặn confirm())
  function confirmInline(el, msg) {
    if (el.dataset.confirmed === '1') { el.dataset.confirmed = ''; return true; }
    el.dataset.confirmed = '1';
    toast(h(msg));
    if (el.tagName === 'SELECT') el.value = el.querySelector('[selected]') ? el.querySelector('[selected]').value : el.value;
    setTimeout(() => { el.dataset.confirmed = ''; }, 5000);
    return false;
  }

  /* ---------- Sản phẩm & tồn kho ---------- */
  let catalog = null;
  // openStock: id sản phẩm cần mở sẵn bảng tồn kho sau khi tải lại
  async function products(openStock) {
    catalog = await api('/api/admin/products');
    const isAdmin = me.role === 'admin';
    const STATUS = { active: 'Đang bán', hidden: 'Ẩn', discontinued: 'Ngừng bán' };
    panel().innerHTML = `
      <div class="admin-toolbar">
        ${isAdmin ? '<button type="button" class="btn btn-primary" data-new>+ Thêm sản phẩm</button>' : '<p class="muted">Nhân viên được cập nhật tồn kho. Thêm/sửa sản phẩm do quản trị viên thực hiện.</p>'}
        <span class="muted">${catalog.products.length} sản phẩm</span>
      </div>
      <div class="table-wrap"><table class="data-table admin-table">
        <thead><tr><th>Sản phẩm</th><th>Danh mục</th><th>Giá</th><th>Tồn kho</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${catalog.products.map((p) => {
          const total = p.variants.reduce((s, v) => s + v.stock, 0);
          return `<tr data-id="${p.id}">
            <td><div class="prod-cell">${p.imageUrl ? `<img class="thumb" src="${h(p.imageUrl)}" alt="" loading="lazy">` : `<span class="thumb" style="background:${(catalog.colors[p.colors[0]] || {}).hex || '#9c7b56'}"></span>`}
              <div><strong>${h(p.name)}</strong><br><small class="muted">${h(p.sku)}</small></div></div></td>
            <td>${h((catalog.categories.find((c) => c.id === p.cat) || {}).name || '')}</td>
            <td class="num">${money(p.price)}${p.oldPrice ? `<br><small class="price-old">${money(p.oldPrice)}</small>` : ''}</td>
            <td class="num"><span class="pill ${total === 0 ? 'bad' : total <= 5 ? 'warn' : 'ok'}">${total}</span></td>
            <td>${STATUS[p.status]}</td>
            <td class="row-actions"><button type="button" class="link-btn" data-stock>Tồn kho</button>${isAdmin ? ' <button type="button" class="link-btn" data-edit>Sửa</button>' : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;

    panel().onclick = (e) => {
      if (e.target.closest('[data-new]')) return productForm(null);
      const save = e.target.closest('[data-save]');
      if (save) return saveStock(save);
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const p = catalog.products.find((x) => x.id === Number(tr.dataset.id));
      if (e.target.closest('[data-edit]')) return productForm(p);
      if (e.target.closest('[data-stock]')) {
        if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('detail-row')) return tr.nextElementSibling.remove();
        openStockRow(tr, p);
      }
    };
    // Nút "Cập nhật" chỉ bật khi số lượng đã thay đổi; Enter trong ô = bấm Cập nhật
    panel().oninput = (e) => {
      const inp = e.target.closest('[data-variant]');
      if (inp) inp.nextElementSibling.disabled = inp.value === inp.defaultValue || inp.value === '';
    };
    panel().onkeydown = (e) => {
      const inp = e.target.closest('[data-variant]');
      if (inp && e.key === 'Enter' && !inp.nextElementSibling.disabled) { e.preventDefault(); inp.nextElementSibling.click(); }
    };
    if (openStock) {
      const tr = panel().querySelector(`tr[data-id="${openStock}"]`);
      if (tr) openStockRow(tr, catalog.products.find((x) => x.id === openStock));
    }
  }

  function openStockRow(tr, p) {
    tr.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="6"><div class="stock-grid">
      ${p.variants.map((v) => `<label>${h(v.size)} · ${h((catalog.colors[v.color] || {}).name || v.color)}
        <span class="stock-edit"><input type="number" class="input" min="0" value="${v.stock}" data-variant="${v.id}" aria-label="Tồn kho ${h(v.size)}">
        <button type="button" class="btn btn-sm" data-save="${p.id}" disabled>Cập nhật</button></span></label>`).join('')}
      </div><p class="muted">Nhập số lượng rồi bấm "Cập nhật" (hoặc Enter).</p></td></tr>`);
  }

  async function saveStock(btn) {
    const inp = btn.previousElementSibling;
    btn.disabled = true;
    btn.textContent = 'Đang lưu…';
    try {
      await api(`/api/admin/variants/${inp.dataset.variant}`, { method: 'PATCH', body: { stock: Number(inp.value) } });
      toast('Đã cập nhật tồn kho.');
      await products(Number(btn.dataset.save));   // tải lại danh sách để tổng tồn kho và các ô hiện số mới nhất
    } catch (err) {
      fail(err);
      btn.disabled = false;
      btn.textContent = 'Cập nhật';
    }
  }

  function productForm(p) {
    const dlg = $('#productDialog');
    const allSizes = ['S', 'M', 'L', 'XL', 'Free size'];
    dlg.innerHTML = `
      <button type="button" class="modal-close" data-close aria-label="Đóng">×</button>
      <h2>${p ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2>
      <form id="productForm" novalidate>
        <div class="form-row">
          <div class="form-field"><label for="pfSku">Mã SKU <span class="req">*</span></label><input id="pfSku" name="sku" value="${h(p ? p.sku : '')}" required></div>
          <div class="form-field"><label for="pfCat">Danh mục</label><select id="pfCat" name="cat">${catalog.categories.map((c) => `<option value="${c.id}"${p && p.cat === c.id ? ' selected' : ''}>${h(c.name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-field"><label for="pfName">Tên sản phẩm <span class="req">*</span></label><input id="pfName" name="name" value="${h(p ? p.name : '')}" required></div>
        <div class="form-row">
          <div class="form-field"><label for="pfPrice">Giá bán (₫) <span class="req">*</span></label><input id="pfPrice" name="price" type="number" min="1000" step="1000" value="${p ? p.price : ''}" required></div>
          <div class="form-field"><label for="pfOld">Giá gốc khi giảm giá (₫)</label><input id="pfOld" name="oldPrice" type="number" min="0" step="1000" value="${p && p.oldPrice ? p.oldPrice : ''}"></div>
        </div>
        <div class="form-field">
          <label for="pfFile">Ảnh sản phẩm <span class="muted small">— ảnh đầu tiên là ảnh đại diện; gõ tên màu cho từng ảnh (màu mới sẽ tự được tạo)</span></label>
          <div class="img-list" id="pfImgs"></div>
          <datalist id="pfColorList">${Object.values(catalog.colors).map((c) => `<option value="${h(c.name)}">`).join('')}</datalist>
          <input type="file" id="pfFile" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
          <p class="muted small">Chọn được nhiều ảnh cùng lúc · JPG, PNG, WEBP, GIF · tối đa 5MB/ảnh · đẹp nhất là ảnh dọc 3:4</p>
          <div class="img-url-row"><input id="pfImgUrl" placeholder="Hoặc dán đường dẫn ảnh: https://… hoặc /images/ten-anh.jpg"><button type="button" class="btn" id="pfAddUrl">Thêm</button></div>
          <p class="small" id="pfImgMsg" role="status"></p>
        </div>
        <div class="form-field"><label for="pfMat">Chất liệu</label><input id="pfMat" name="material" value="${h(p && p.material ? p.material : '')}"></div>
        <div class="form-field"><label for="pfDesc">Mô tả</label><textarea id="pfDesc" name="desc" style="min-height:90px;">${h(p && p.desc ? p.desc : '')}</textarea></div>
        <fieldset class="form-field check-row"><legend>Kích cỡ</legend>${allSizes.map((s) => `<label class="check"><input type="checkbox" name="sizes" value="${s}"${p && p.sizes.includes(s) ? ' checked' : ''}> ${s}</label>`).join('')}</fieldset>
        <fieldset class="form-field check-row"><legend>Màu sắc</legend>${Object.entries(catalog.colors).map(([k, c]) => `<label class="check"><input type="checkbox" name="colors" value="${k}"${p && p.colors.includes(k) ? ' checked' : ''}><span class="dot" style="background:${c.hex}"></span> ${h(c.name)}</label>`).join('')}</fieldset>
        <div class="form-row">
          <div class="form-field"><label for="pfBadge">Nhãn (vd: Mới, Bán chạy)</label><input id="pfBadge" name="badge" value="${h(p && p.badge ? p.badge : '')}"></div>
          <div class="form-field"><label for="pfStatus">Trạng thái</label><select id="pfStatus" name="status">${opts({ active: 'Đang bán', hidden: 'Ẩn', discontinued: 'Ngừng bán' }, p ? p.status : 'active')}</select></div>
        </div>
        <div class="check-row">
          <label class="check"><input type="checkbox" name="featured"${p && p.featured ? ' checked' : ''}> Sản phẩm nổi bật</label>
          <label class="check"><input type="checkbox" name="isNew"${p && p.isNew ? ' checked' : ''}> Hàng mới</label>
        </div>
        <p class="form-note err" id="pfError" hidden></p>
        <button class="btn btn-primary" type="submit">${p ? 'Lưu thay đổi' : 'Thêm sản phẩm'}</button>
        <p class="muted">Size/màu mới được tạo với tồn kho 0 — nhập số lượng ở nút "Tồn kho".</p>
      </form>`;
    dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); };

    // Bộ ảnh: mỗi dòng = 1 ảnh + tên màu (gõ tự do, gợi ý màu có sẵn) + mã màu hex cho màu mới
    const imgMsg = $('#pfImgMsg'), list = $('#pfImgs');
    const byName = (name) => Object.values(catalog.colors).find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    const addRow = (url, color) => {
      const c = catalog.colors[color];
      list.insertAdjacentHTML('beforeend', `<div class="img-row">
        <img src="${h(url)}" alt="" data-url="${h(url)}">
        <input class="img-color" list="pfColorList" placeholder="Màu của ảnh (để trống = ảnh chung)" value="${h(c ? c.name : '')}" aria-label="Màu của ảnh">
        <input type="color" class="img-hex" value="${c ? c.hex : '#9c7b56'}" aria-label="Mã màu" title="Mã màu (dùng khi tạo màu mới)">
        <button type="button" class="link-btn" data-up title="Đưa lên đầu (ảnh đại diện)">↑</button>
        <button type="button" class="link-btn danger" data-del title="Xóa ảnh">×</button>
      </div>`);
    };
    (p ? p.images : []).forEach((i) => addRow(i.url, i.color));
    list.oninput = (e) => {   // gõ đúng tên màu có sẵn -> tự lấy mã màu của nó
      const c = e.target.classList.contains('img-color') && byName(e.target.value);
      if (!c) return;
      e.target.nextElementSibling.value = c.hex;
      const code = Object.keys(catalog.colors).find((k) => catalog.colors[k] === c);
      $(`#productForm input[name="colors"][value="${code}"]`).checked = true;
    };
    list.onclick = (e) => {
      const row = e.target.closest('.img-row');
      if (e.target.closest('[data-del]')) row.remove();
      if (e.target.closest('[data-up]')) list.prepend(row);
    };
    $('#pfAddUrl').onclick = () => {
      const u = $('#pfImgUrl').value.trim();
      if (!/^(https?:\/\/|\/)/.test(u)) { imgMsg.className = 'small danger'; imgMsg.textContent = 'Đường dẫn phải bắt đầu bằng http(s):// hoặc /'; return; }
      addRow(u); $('#pfImgUrl').value = ''; imgMsg.textContent = '';
    };
    $('#pfFile').onchange = async (e) => {
      const files = [...e.target.files];
      for (const [n, file] of files.entries()) {
        imgMsg.className = 'small muted';
        imgMsg.textContent = `Đang tải ảnh ${n + 1}/${files.length}…`;
        try {
          if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} lớn hơn 5MB.`);
          const res = await fetch('/api/admin/uploads', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || 'Tải ảnh thất bại.');
          addRow(d.url);
        } catch (err) { imgMsg.className = 'small danger'; imgMsg.textContent = err.message; e.target.value = ''; return; }
      }
      e.target.value = '';
      imgMsg.className = 'small ok-text';
      imgMsg.textContent = 'Đã tải ảnh lên. Gõ màu cho từng ảnh rồi bấm lưu.';
    };
    $('#productForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        sku: f.sku.value, name: f.elements.name.value, cat: f.cat.value, price: Number(f.price.value), oldPrice: f.oldPrice.value ? Number(f.oldPrice.value) : null,
        images: $$('.img-row', f).map((r) => ({ url: $('img', r).dataset.url, color: $('.img-color', r).value.trim(), hex: $('.img-hex', r).value })),
        material: f.material.value, desc: f.desc.value, badge: f.badge.value, status: f.status.value,
        featured: f.featured.checked, isNew: f.isNew.checked,
        sizes: $$('input[name="sizes"]:checked', f).map((i) => i.value), colors: $$('input[name="colors"]:checked', f).map((i) => i.value)
      };
      try {
        await api(p ? `/api/admin/products/${p.id}` : '/api/admin/products', { method: p ? 'PUT' : 'POST', body });
        dlg.close();
        toast(p ? 'Đã lưu sản phẩm.' : 'Đã thêm sản phẩm.');
        products().catch(fail);
      } catch (err) {
        $('#pfError').textContent = err.message;
        $('#pfError').hidden = false;
      }
    };
    dlg.showModal();
  }

  /* ---------- Giao dịch ngân hàng (SePay) ---------- */
  async function bankTx() {
    const { rows, webhook } = await api('/api/admin/bank-transactions');
    panel().innerHTML = `
      ${me.role === 'admin' ? `
      <form class="admin-card sim-form" id="simForm">
        <h2>Mô phỏng tiền về (demo)</h2>
        <p class="muted small">Giả lập một giao dịch như SePay gửi về.</p>
        <div class="form-row">
          <div class="form-field"><label for="simAmount">Số tiền (₫)</label><input id="simAmount" name="amount" type="number" min="1000" step="1000" required></div>
          <div class="form-field"><label for="simContent">Nội dung chuyển khoản</label><input id="simContent" name="content" placeholder="LUA 0901234567" required></div>
        </div>
        <button class="btn btn-primary" type="submit">Gửi giao dịch</button>
        <p class="small" id="simMsg" role="status"></p>
      </form>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="data-table admin-table">
        <thead><tr><th>Thời gian</th><th>Nguồn</th><th>Số tiền</th><th>Nội dung</th><th>Đơn hàng</th></tr></thead>
        <tbody>${rows.map((t) => `<tr><td>${date(t.created_at)}</td><td>${h(t.gateway)}</td><td class="num">${money(t.amount)}</td>
          <td>${h(t.content || '')}</td><td>${t.order_code ? `<span class="pill ok">${h(t.order_code)}</span>` : '<span class="pill warn">Chưa khớp đơn</span>'}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">Chưa có giao dịch nào.</p>'}`;
    const f = $('#simForm');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/admin/bank-simulate', { method: 'POST', body: { amount: Number(f.amount.value), content: f.content.value } });
        toast(r.matched ? `Đã ghép với đơn ${h(r.matched)} — chuyển sang Đã thanh toán.` : 'Đã ghi giao dịch, chưa khớp đơn nào (sẽ tự ghép nếu khách đặt đơn trong 24 giờ).');
        bankTx().catch(fail);
      } catch (err) { $('#simMsg').className = 'small danger'; $('#simMsg').textContent = err.message; }
    };
  }

  /* ---------- Nhật ký thao tác (admin) ---------- */
  async function logs() {
    const rows = await api('/api/admin/logs');
    panel().innerHTML = rows.length ? `<div class="table-wrap"><table class="data-table admin-table">
      <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Chi tiết</th></tr></thead>
      <tbody>${rows.map((l) => `<tr><td>${date(l.created_at)}</td><td>${h(l.by_name)} ${l.role ? `<span class="pill role-${l.role}">${ROLE_NAME[l.role]}</span>` : ''}</td>
        <td>${h(l.action)}</td><td>${h(l.detail || '')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Chưa có thao tác nào được ghi lại.</p>';
  }

  /* ---------- Tin nhắn ---------- */
  async function messages() {
    const rows = await api('/api/admin/messages');
    panel().innerHTML = rows.length ? `<div class="msg-list">${rows.map((m) => `
      <article class="admin-card msg${m.is_handled ? ' done' : ''}" data-id="${m.id}">
        <header><strong>${h(m.full_name)}</strong> · ${h(m.phone)}${m.email ? ` · ${h(m.email)}` : ''}<time>${date(m.created_at)}</time></header>
        <p>${h(m.message)}</p>
        <label class="check"><input type="checkbox" data-handled${m.is_handled ? ' checked' : ''}> Đã xử lý</label>
      </article>`).join('')}</div>` : '<p class="muted">Chưa có tin nhắn.</p>';
    panel().onchange = async (e) => {
      const cb = e.target.closest('[data-handled]');
      if (!cb) return;
      const card = cb.closest('[data-id]');
      await api(`/api/admin/messages/${card.dataset.id}`, { method: 'PATCH', body: { is_handled: cb.checked } }).catch(fail);
      card.classList.toggle('done', cb.checked);
    };
  }

  /* ---------- Đánh giá ---------- */
  async function reviews() {
    const rows = await api('/api/admin/reviews');
    panel().innerHTML = `<div class="table-wrap"><table class="data-table admin-table">
      <thead><tr><th>Sản phẩm</th><th>Người viết</th><th>Điểm</th><th>Nội dung</th><th>Ngày</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-id="${r.id}"><td>${h(r.product)}</td><td>${h(r.author)}</td><td>${LUA.stars(r.rating)}</td><td>${h(r.content)}</td><td>${date(r.created_at)}</td>
        <td><button type="button" class="link-btn" data-del>Xóa</button></td></tr>`).join('')}</tbody></table></div>`;
    panel().onclick = async (e) => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Bấm lần nữa để xóa'; b.classList.add('danger'); return; }
      await api(`/api/admin/reviews/${b.closest('tr').dataset.id}`, { method: 'DELETE' }).catch(fail);
      b.closest('tr').remove();
      toast('Đã xóa đánh giá.');
    };
  }

  /* ---------- Mã giảm giá (admin) ---------- */
  async function coupons() {
    const rows = await api('/api/admin/coupons');
    const TYPE = { percent: 'Giảm %', fixed: 'Giảm tiền', freeship: 'Miễn phí ship' };
    panel().innerHTML = `
      <form class="admin-card inline-form" id="couponForm">
        <h2>Tạo mã mới</h2>
        <div class="form-field"><label for="cpCode">Mã</label><input id="cpCode" name="code" placeholder="VD: TET2027" required></div>
        <div class="form-field"><label for="cpType">Loại</label><select id="cpType" name="type">${opts(TYPE, 'percent')}</select></div>
        <div class="form-field"><label for="cpValue">Giá trị (% hoặc ₫)</label><input id="cpValue" name="value" type="number" min="0"></div>
        <div class="form-field"><label for="cpMin">Đơn tối thiểu (₫)</label><input id="cpMin" name="minOrder" type="number" min="0" value="0"></div>
        <div class="form-field"><label for="cpEnd">Hết hạn</label><input id="cpEnd" name="endsAt" type="date"></div>
        <div class="form-field"><label for="cpLimit">Số lượt tối đa</label><input id="cpLimit" name="usageLimit" type="number" min="1" placeholder="Không giới hạn"></div>
        <div class="form-field wide"><label for="cpDesc">Mô tả hiển thị cho khách</label><input id="cpDesc" name="description" placeholder="Giảm 10% cho đơn từ 500.000₫"></div>
        <p class="form-note err wide" id="cpError" hidden></p>
        <button class="btn btn-primary" type="submit">Tạo mã</button>
      </form>
      <div class="table-wrap"><table class="data-table admin-table">
        <thead><tr><th>Mã</th><th>Loại</th><th>Giá trị</th><th>Đơn tối thiểu</th><th>Đã dùng</th><th>Hết hạn</th><th>Kích hoạt</th></tr></thead>
        <tbody>${rows.map((c) => `<tr><td><strong>${h(c.code)}</strong><br><small class="muted">${h(c.description || '')}</small></td><td>${TYPE[c.type]}</td>
          <td class="num">${c.type === 'percent' ? `${c.value}%` : c.type === 'fixed' ? money(c.value) : '—'}</td><td class="num">${money(c.min_order)}</td>
          <td class="num">${c.used_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}</td><td>${date(c.ends_at).slice(0, 10) || '—'}</td>
          <td><label class="switch"><input type="checkbox" data-code="${h(c.code)}"${c.is_active ? ' checked' : ''}><span class="sr-only">Kích hoạt ${h(c.code)}</span></label></td></tr>`).join('')}</tbody>
      </table></div>`;
    $('#couponForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('/api/admin/coupons', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
        toast('Đã tạo mã giảm giá.');
        coupons().catch(fail);
      } catch (err) { $('#cpError').textContent = err.message; $('#cpError').hidden = false; }
    };
    panel().onchange = async (e) => {
      const cb = e.target.closest('[data-code]');
      if (cb) await api(`/api/admin/coupons/${encodeURIComponent(cb.dataset.code)}`, { method: 'PATCH', body: { is_active: cb.checked } }).then(() => toast('Đã cập nhật.'), fail);
    };
  }

  /* ---------- Tài khoản (admin) ---------- */
  async function users() {
    const rows = await api('/api/admin/users');
    panel().innerHTML = `
      <form class="admin-card inline-form" id="userForm">
        <h2>Tạo tài khoản nhân viên / quản trị</h2>
        <div class="form-field"><label for="usName">Họ tên</label><input id="usName" name="fullName" required></div>
        <div class="form-field"><label for="usEmail">Email</label><input id="usEmail" name="email" type="email" required></div>
        <div class="form-field"><label for="usPhone">Điện thoại</label><input id="usPhone" name="phone"></div>
        <div class="form-field"><label for="usRole">Vai trò</label><select id="usRole" name="role">${opts(ROLE_NAME, 'staff')}</select></div>
        <div class="form-field"><label for="usPw">Mật khẩu tạm (≥ 8 ký tự)</label><input id="usPw" name="password" type="text" required></div>
        <p class="form-note err wide" id="usError" hidden></p>
        <button class="btn btn-primary" type="submit">Tạo tài khoản</button>
      </form>
      <div class="table-wrap"><table class="data-table admin-table">
        <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Đơn hàng</th><th>Ngày tạo</th><th>Hoạt động</th></tr></thead>
        <tbody>${rows.map((u) => {
          const self = u.id === me.id;
          return `<tr data-id="${u.id}"><td>${h(u.full_name)}${self ? ' <small class="muted">(bạn)</small>' : ''}</td><td>${h(u.email)}</td>
            <td>${self ? ROLE_NAME[u.role] : `<select class="select sm" data-role aria-label="Vai trò ${h(u.full_name)}">${opts(ROLE_NAME, u.role)}</select>`}</td>
            <td class="num">${u.orders}</td><td>${date(u.created_at).slice(0, 10)}</td>
            <td>${self ? '—' : `<label class="switch"><input type="checkbox" data-active${u.is_active ? ' checked' : ''}><span class="sr-only">Kích hoạt ${h(u.full_name)}</span></label>`}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`;
    $('#userForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        toast('Đã tạo tài khoản.');
        users().catch(fail);
      } catch (err) { $('#usError').textContent = err.message; $('#usError').hidden = false; }
    };
    panel().onchange = async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const body = e.target.matches('[data-role]') ? { role: e.target.value } : e.target.matches('[data-active]') ? { is_active: e.target.checked } : null;
      if (body) await api(`/api/admin/users/${tr.dataset.id}`, { method: 'PATCH', body }).then(() => toast('Đã cập nhật tài khoản.'), fail);
    };
  }

  /* ---------- Đăng ký nhận tin (admin) ---------- */
  async function newsletter() {
    const rows = await api('/api/admin/newsletter');
    panel().innerHTML = `<p class="muted">${rows.length} email đăng ký. Bôi đen và sao chép danh sách dưới đây để gửi thư.</p>
      <textarea class="input" readonly rows="10" aria-label="Danh sách email">${h(rows.map((r) => r.email).join('\n'))}</textarea>`;
  }
})();