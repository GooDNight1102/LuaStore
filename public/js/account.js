/* Trang Tài khoản của khách: thông tin, đơn hàng, hủy đơn chờ xác nhận */
(function () {
  const { $, money, escapeHTML, statusPill, PAY_STATUS, ORDER_STATUS } = LUA;

  // Dòng thời gian trạng thái đơn
  const timeline = (o) => `
    <details class="order-track">
      <summary>Theo dõi đơn</summary>
      <ol class="timeline">${(o.history.length ? o.history : [{ status: 'pending', note: 'Đặt hàng', created_at: o.created_at }]).map((h) => `
        <li class="tl-${h.status}"><time>${escapeHTML(String(h.created_at).slice(0, 16))}</time>
          <strong>${ORDER_STATUS[h.status] || h.status}</strong>${h.note ? `<span>${escapeHTML(h.note)}</span>` : ''}</li>`).join('')}
      </ol>
    </details>`;

  const note = (form, msg, ok) => {
    const n = form.querySelector('.form-note');
    n.textContent = msg; n.className = `form-note ${ok ? 'ok' : 'err'}`; n.hidden = !msg;
  };
  function fillProfile(u) {
    const f = $('#profileForm');
    f.fullName.value = u.fullName; f.phone.value = u.phone || ''; f.address.value = u.address || '';
    LUA.ready.then(() => {
      f.regionCode.innerHTML = '<option value="">— Chọn —</option>' + Object.values(SHIPPING_REGIONS)
        .map((r) => `<option value="${escapeHTML(r.code)}">${escapeHTML(r.name)}</option>`).join('');
      f.regionCode.value = u.regionCode || '';
    });
  }

  async function load() {
    let data;
    try {
      data = await LUA.api('/api/me/orders');
    } catch (e) {
      if (e.status === 401) return location.replace('dangnhap.html?next=taikhoan.html');
      $('#orderList').innerHTML = `<p class="muted">${escapeHTML(e.message)}</p>`;
      return;
    }
    const u = data.user;
    $('#hello').textContent = `Xin chào, ${u.fullName}`;
    $('#profile').innerHTML = `
      <dt>Email</dt><dd>${escapeHTML(u.email)}</dd>
      <dt>Điện thoại</dt><dd>${escapeHTML(u.phone || '—')}</dd>
      <dt>Địa chỉ</dt><dd>${escapeHTML(u.address || 'Chưa có — sẽ lưu khi bạn đặt đơn đầu tiên')}</dd>
      <dt>Vai trò</dt><dd>${{ customer: 'Khách hàng', staff: 'Nhân viên', admin: 'Quản trị viên' }[u.role]}</dd>`;
    $('#adminLink').hidden = u.role === 'customer';
    fillProfile(u);
    $('#wishCount').textContent = LUA.getWish().length;

    const orders = data.orders;
    $('#orderCount').textContent = orders.length;
    $('#orderList').innerHTML = orders.length ? orders.map((o) => `
      <article class="order-card">
        <header>
          <div><strong>${escapeHTML(o.order_code)}</strong><time>${escapeHTML(String(o.created_at).slice(0, 16))}</time></div>
          ${statusPill(o.status)}
        </header>
        <ul>${o.items.map((i) => `<li><a href="chitiet.html?id=${i.product_id}">${escapeHTML(i.product_name)}</a> <span class="muted">(${escapeHTML(i.color_name)}, ${escapeHTML(i.size)}) × ${i.quantity}</span><span>${money(i.line_total)}</span></li>`).join('')}</ul>
        <footer>
          <span class="muted">${o.payment_method === 'cod' ? 'COD' : 'Chuyển khoản'} · ${o.claimed_paid && o.payment_status === 'unpaid' ? 'Đã báo chuyển khoản, chờ cửa hàng xác nhận' : PAY_STATUS[o.payment_status]} · Giao ${escapeHTML(o.region)}</span>
          <span>Tổng: <strong class="price">${money(o.total)}</strong></span>
          ${o.status === 'pending' ? `<button type="button" class="link-btn" data-cancel="${escapeHTML(o.order_code)}">Hủy đơn</button>` : ''}
        </footer>
        ${timeline(o)}
      </article>`).join('')
      : '<div class="empty-state"><h3>Bạn chưa có đơn hàng nào</h3><p>Khám phá bộ sưu tập và đặt đơn đầu tiên nhé.</p><a class="btn btn-primary" href="sanpham.html">Mua sắm ngay</a></div>';
  }

  // Hủy đơn: bấm 2 lần để xác nhận
  $('#orderList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]');
    if (!b) return;
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1';
      b.textContent = 'Bấm lần nữa để hủy đơn';
      b.classList.add('danger');
      return;
    }
    try {
      await LUA.api(`/api/me/orders/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: 'POST' });
      LUA.toast('Đã hủy đơn hàng.');
      load();
    } catch (err) { LUA.toast(escapeHTML(err.message)); }
  });

  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await LUA.api('/api/me', { method: 'PUT', body: { fullName: f.fullName.value, phone: f.phone.value, regionCode: f.regionCode.value, address: f.address.value } });
      note(f, 'Đã lưu thông tin. Lần thanh toán sau sẽ tự điền theo thông tin này.', true);
      load();
    } catch (err) { note(f, err.message); }
  });

  $('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.confirm.value) return note(f, 'Mật khẩu nhập lại không khớp.');
    try {
      await LUA.api('/api/me/password', { method: 'POST', body: { current: f.current.value, password: f.password.value } });
      f.reset();
      note(f, 'Đã đổi mật khẩu.', true);
    } catch (err) { note(f, err.message); }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await LUA.api('/api/auth/logout', { method: 'POST' });
    location.href = 'index.html';
  });

  load();
})();