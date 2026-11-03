/* Trang Thanh toán: kiểm tra form, xem trước tổng tiền, gửi đơn lên server (server tính lại giá) */
(function () {
  const { $, $$, money, escapeHTML, swatchHTML, colorName } = LUA;
  const form = $('#checkoutForm');

  // Đơn vừa đặt được lưu trong tab này: tải lại trang (F5) vẫn thấy thông tin đơn
  const LAST_KEY = 'lua_last_order';
  function lastOrder() {
    try {
      const o = JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null');
      return o && location.hash === `#don-${o.orderCode}` ? o : null;
    } catch (e) { return null; }
  }

  let currentUser = null;

  LUA.ready.then(async () => {
    const done = lastOrder();
    if (done) { showSuccess(done); return; }
    if (LUA.cartLines().length === 0) { $('#checkoutEmpty').hidden = false; return; }
    $('#checkoutLayout').hidden = false;

    $('#region').insertAdjacentHTML('beforeend', Object.values(SHIPPING_REGIONS)
      .map((r) => `<option value="${r.code}">${escapeHTML(r.name)} (${escapeHTML(r.eta || '')})</option>`).join(''));
    renderSummary();   // hiện ngay sản phẩm + tạm tính, chưa cần chọn khu vực

    // Đã đăng nhập: điền sẵn thông tin; chưa: gợi ý đăng nhập để theo dõi đơn
    const user = currentUser = await LUA.me();
    if (user) {
      form.fullName.value = user.fullName;
      form.phone.value = user.phone || '';
      form.email.value = user.email;
      form.address.value = user.address || '';
      if (SHIPPING_REGIONS[user.regionCode]) form.region.value = user.regionCode;
      $('#loginHint').innerHTML = `Đang đặt hàng với tài khoản <strong>${escapeHTML(user.email)}</strong>. Đơn sẽ hiện trong <a href="taikhoan.html">Tài khoản của tôi</a>.`;
      // Đủ thông tin thì chỉ hiện khung tóm tắt; thiếu gì thì hiện ô nhập để khách bổ sung (lần sau sẽ tự điền)
      const complete = ['fullName', 'phone', 'region', 'address'].every((n) => !rules[n](form.elements[n].value));
      if (complete) { if ($('#savedInfo')) showSavedInfo(); }   // trang không có khung tóm tắt thì giữ nguyên ô đã điền sẵn
      else $('#loginHint').insertAdjacentHTML('beforeend', ' Bổ sung thông tin còn thiếu bên dưới, lần sau sẽ tự điền.');
    }
    renderSummary();
  });

  /* ---------- Mã QR chuyển khoản (chuẩn VietQR — app ngân hàng nào cũng quét được) ---------- */
  function qrHTML(amount, info, note) {
    if (!BANK) return '<p class="form-note err">Cửa hàng chưa cấu hình tài khoản ngân hàng (BANK_ACCOUNT trong file .env).</p>';
    const src = `https://img.vietqr.io/image/${encodeURIComponent(BANK.bin)}-${encodeURIComponent(BANK.account)}-compact2.png`
      + `?amount=${Math.round(amount)}&addInfo=${encodeURIComponent(info)}&accountName=${encodeURIComponent(BANK.owner)}`;
    const copy = (v) => `<button type="button" class="copy-btn" data-copy="${escapeHTML(v)}">Sao chép</button>`;
    return `<div class="qr-box">
      <div class="qr-img"><img src="${escapeHTML(src)}" alt="Mã QR chuyển khoản ${money(amount)} đến ${escapeHTML(BANK.label)}" width="220" height="220"></div>
      <div>
        <h3>Quét mã để chuyển khoản</h3>
        <dl>
          <dt>Ngân hàng</dt><dd>${escapeHTML(BANK.label)}</dd>
          <dt>Số tài khoản</dt><dd><strong>${escapeHTML(BANK.account)}</strong> ${copy(BANK.account)}</dd>
          <dt>Chủ tài khoản</dt><dd>${escapeHTML(BANK.owner)}</dd>
          <dt>Số tiền</dt><dd><strong class="price">${money(amount)}</strong> ${copy(String(Math.round(amount)))}</dd>
          <dt>Nội dung</dt><dd><strong>${escapeHTML(info)}</strong> ${copy(info)}</dd>
        </dl>
        ${note ? `<p class="small muted">${note}</p>` : ''}
      </div>
    </div>`;
  }

  // Ảnh QR tải từ img.vietqr.io; mất mạng thì báo khách chuyển khoản theo thông tin bên cạnh
  function watchQrImage(box) {
    const img = box.querySelector('.qr-img img');
    if (img) img.addEventListener('error', () => { img.parentElement.innerHTML = '<p class="qr-fail">Không tải được mã QR. Vui lòng chuyển khoản theo thông tin bên cạnh.</p>'; });
  }

  // Nội dung chuyển khoản: "LUA" + số điện thoại để cửa hàng đối chiếu
  const transferInfo = () => `LUA ${form.phone.value.replace(/[^0-9]/g, '')}`.trim();
  const isBankSelected = () => form.querySelector('input[name="payment"]:checked').value === 'bank';
  // Chọn chuyển khoản thì nút đặt hàng thành "Tôi đã chuyển khoản xong" (không có bước hiện QR sau khi đặt)
  const submitLabel = () => (isBankSelected() ? 'Tôi đã chuyển khoản xong' : 'Đặt hàng');

  function renderQr(t) {
    const box = $('#qrBox');
    const isBank = isBankSelected();
    $('#placeOrder').textContent = submitLabel();
    box.hidden = !isBank;
    if (!isBank) return;
    if (t.shipping === null) {
      box.innerHTML = '<p class="form-note">Chọn <strong>khu vực giao hàng</strong> ở mục 02 để hiện mã QR với số tiền chính xác (đã gồm phí vận chuyển).</p>';
      return;
    }
    box.innerHTML = qrHTML(t.total, transferInfo(),
      'Chuyển đúng số tiền và nội dung ở trên. Sau khi chuyển xong, bấm nút bên dưới để hoàn tất đặt hàng.')
      + '<button type="submit" class="btn btn-primary btn-block qr-paid">Tôi đã chuyển khoản xong</button>';
    watchQrImage(box);
  }

  // Nút "Sao chép" số tài khoản / số tiền / nội dung
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); LUA.toast(`Đã sao chép: ${escapeHTML(b.dataset.copy)}`); }
    catch (err) { LUA.toast('Không sao chép được. Hãy bôi đen và sao chép thủ công.'); }
  });

  /* ---------- Thông tin giao hàng lấy từ tài khoản ---------- */
  function showSavedInfo() {
    const r = SHIPPING_REGIONS[form.region.value];
    $('#savedInfo').innerHTML = `
      <h2><span class="n">01</span> Giao đến</h2>
      <div class="saved-card">
        <div>
          <strong>${escapeHTML(form.fullName.value)}</strong> · ${escapeHTML(form.phone.value)}<br>
          ${escapeHTML(form.address.value)}<br>
          <span class="muted">${escapeHTML(r ? r.name : '')}${form.email.value ? ` · ${escapeHTML(form.email.value)}` : ''}</span>
        </div>
        <button type="button" class="link-btn" id="editInfo">Thay đổi</button>
      </div>
      <p class="small muted">Lấy từ tài khoản của bạn. Địa chỉ mới sẽ được nhớ cho lần mua sau.</p>`;
    $('#savedInfo').hidden = false;
    $$('[data-profile]').forEach((el) => { el.hidden = true; });
    $('#addrTitle').textContent = 'Ghi chú cho đơn hàng';
    $('#editInfo').onclick = showProfileFields;
  }

  function showProfileFields() {
    $('#savedInfo').hidden = true;
    $$('[data-profile]').forEach((el) => { el.hidden = false; });
    $('#addrTitle').textContent = 'Địa chỉ giao hàng';
    form.fullName.focus();
  }

  function renderSummary() {
    const t = LUA.totals(form.region.value || null);
    $('#coCount').textContent = LUA.cartCount();
    $('#miniLines').innerHTML = t.lines.map((l) => `
      <div class="mini-line">
        ${swatchHTML(l.product, l.color)}
        <div>${escapeHTML(l.product.name)}<br><span class="qty-badge">${escapeHTML(colorName(l.color))} · ${escapeHTML(l.size)} · x${l.qty}</span></div>
        <strong>${money(l.lineTotal)}</strong>
      </div>`).join('');

    $('#coSubtotal').textContent = money(t.subtotal);
    $('#coRowDiscount').hidden = !(t.discount > 0);
    if (t.discount > 0) { $('#coCode').textContent = t.coupon.code; $('#coDiscount').textContent = '−' + money(t.discount); }

    const ship = $('#coShip');
    if (t.shipping === null) { ship.textContent = t.freeship ? 'Miễn phí' : 'Chọn khu vực'; ship.className = 'muted'; }
    else { ship.textContent = t.shipping === 0 ? 'Miễn phí' : money(t.shipping); ship.className = ''; }
    $('#coTotal').textContent = money(t.total);

    const cod = form.querySelector('input[value="cod"]');
    const overLimit = t.total >= COD_LIMIT;
    cod.disabled = overLimit;
    $('#codOption').classList.toggle('disabled', overLimit);
    $('#codNote').textContent = overLimit
      ? 'Không áp dụng cho đơn từ 5.000.000₫ — vui lòng chuyển khoản.'
      : 'Kiểm tra hàng trước khi thanh toán. Áp dụng cho đơn dưới 5.000.000₫.';
    if (overLimit && cod.checked) form.querySelector('input[value="bank"]').checked = true;
    renderQr(t);
    vbox.render(t);
    return t;
  }

  /* ---------- Kho voucher (dùng chung với giỏ hàng) ---------- */
  const vbox = LUA.voucherBox($('#voucherBox'), renderSummary);

  /* ---------- Kiểm tra dữ liệu (server kiểm tra lại lần nữa) ---------- */
  const rules = {
    fullName: (v) => v.trim().length < 2 ? 'Vui lòng nhập họ và tên.' : '',
    phone: (v) => {
      const s = v.replace(/[\s.\-]/g, '');
      if (!s) return 'Vui lòng nhập số điện thoại.';
      return /^(0|\+84)(3|5|7|8|9)\d{8}$/.test(s) ? '' : 'Số điện thoại không hợp lệ (ví dụ: 0901234567).';
    },
    email: (v) => v.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? 'Email không hợp lệ.' : '',
    region: (v) => v ? '' : 'Vui lòng chọn khu vực giao hàng.',
    address: (v) => v.trim().length < 10 ? 'Vui lòng nhập địa chỉ đầy đủ (số nhà, đường, phường/xã…).' : ''
  };

  function validateField(name) {
    const el = form.elements[name];
    const msg = rules[name](el.value);
    $(`#err-${name}`).textContent = msg;
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) el.setAttribute('aria-describedby', `err-${name}`);
    return !msg;
  }

  Object.keys(rules).forEach((name) => {
    const el = form.elements[name];
    el.addEventListener('blur', () => validateField(name));
    el.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') validateField(name); });
  });
  form.region.addEventListener('change', renderSummary);
  form.querySelectorAll('input[name="payment"]').forEach((r) => r.addEventListener('change', renderSummary));
  form.phone.addEventListener('change', renderSummary);
  $('#agree').addEventListener('change', () => { $('#err-agree').textContent = ''; });

  /* ---------- Đặt hàng ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = Object.keys(rules).map(validateField).every(Boolean);
    const agreed = $('#agree').checked;
    $('#err-agree').textContent = agreed ? '' : 'Vui lòng đồng ý với chính sách trước khi đặt hàng.';
    if (!ok) showProfileFields();   // có ô sai trong phần đang thu gọn thì mở ra cho khách sửa
    if (!ok || !agreed) { (form.querySelector('[aria-invalid="true"]') || $('#agree')).focus(); return; }

    const t = renderSummary();
    const btn = $('#placeOrder');
    const paidBtn = form.querySelector('.qr-paid');
    if (paidBtn) { paidBtn.disabled = true; paidBtn.textContent = 'Đang gửi đơn…'; }
    btn.disabled = true;
    btn.textContent = 'Đang gửi đơn…';
    $('#orderError').hidden = true;
    try {
      const order = await LUA.api('/api/orders', {
        method: 'POST',
        body: {
          fullName: form.fullName.value, phone: form.phone.value, email: form.email.value,
          region: form.region.value, address: form.address.value, note: form.note.value,
          payment: form.querySelector('input[name="payment"]:checked').value,
          paidConfirmed: isBankSelected(),          // khách bấm "Tôi đã chuyển khoản xong"
          transferInfo: isBankSelected() ? transferInfo() : null,
          couponCode: t.coupon && !t.couponError ? t.coupon.code : null,
          items: t.lines.map((l) => ({ id: l.id, size: l.size, color: l.color, qty: l.qty }))
        }
      });
      LUA.clearCart();
      showSuccess(order);
    } catch (err) {
      $('#orderError').textContent = err.message;
      $('#orderError').hidden = false;
      btn.disabled = false;
      btn.textContent = submitLabel();
      if (paidBtn) { paidBtn.disabled = false; paidBtn.textContent = 'Tôi đã chuyển khoản xong'; }
    }
  });

  function showSuccess(o) {
    $('#checkoutBanner').hidden = true;
    $('#checkoutSection').hidden = true;
    $('#successSection').hidden = false;
    $('#orderCode').textContent = o.orderCode;
    const pay = o.payment === 'cod'
      ? 'Thanh toán khi nhận hàng (COD)'
      : `Chuyển khoản ngân hàng — bạn đã báo chuyển ${money(o.total)}${o.transferInfo ? `, nội dung "${o.transferInfo}"` : ''}`;
    // Lưu đơn vừa đặt để tải lại trang vẫn xem được
    try { sessionStorage.setItem(LAST_KEY, JSON.stringify(o)); } catch (e) { /* bỏ qua */ }
    history.replaceState(null, '', `#don-${o.orderCode}`);
    const note = $('#successNote');   // kiểm tra trước: thiếu thẻ này trong HTML cũng không làm mất thông tin đơn
    if (note) note.innerHTML = o.payment === 'bank'
      ? 'Cảm ơn bạn đã thanh toán! LỤA sẽ kiểm tra giao dịch và gọi xác nhận đơn trong vòng 24 giờ. Nếu cần hỗ trợ, gọi <strong>090 123 4567</strong> và đọc mã đơn bên dưới.'
      : 'Cảm ơn bạn đã mua sắm tại LỤA. Nhân viên sẽ gọi xác nhận đơn trong vòng 24 giờ.';
    $('#orderInfo').innerHTML = `
      <dt>Người nhận</dt><dd>${escapeHTML(o.fullName)} · ${escapeHTML(o.phone)}</dd>
      <dt>Giao đến</dt><dd>${escapeHTML(o.address)} (${escapeHTML(o.region)})</dd>
      <dt>Sản phẩm</dt><dd>${o.items.map((i) => `${escapeHTML(i.name)} (${escapeHTML(i.color)}, ${escapeHTML(i.size)}) × ${i.qty}`).join('<br>')}</dd>
      <dt>Phí vận chuyển</dt><dd>${o.shipping ? money(o.shipping) : 'Miễn phí'}</dd>
      <dt>Thanh toán</dt><dd>${escapeHTML(pay)}</dd>
      <dt>Tổng tiền</dt><dd><strong style="color:var(--wine)">${money(o.total)}</strong>${o.discount ? ` (đã giảm ${money(o.discount)})` : ''}</dd>
      ${currentUser ? '<dt>Theo dõi đơn</dt><dd><a href="taikhoan.html" style="color:var(--wine); border-bottom:1px solid currentColor;">Tài khoản của tôi</a></dd>' : ''}`;
    window.scrollTo({ top: 0, behavior: 'instant' });
    const h = $('#successSection h1');
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
    watchPayment(o);
  }

  // Chuyển khoản: hỏi server mỗi 5 giây xem cửa hàng đã nhận tiền chưa (SePay tự báo, hoặc nhân viên xác nhận)
  function watchPayment(o) {
    const note = $('#successNote');
    if (!note || o.payment !== 'bank') return;
    const paidMsg = '<strong>✓ LỤA đã nhận được tiền chuyển khoản của bạn.</strong> Đơn đã được xác nhận thanh toán — nhân viên sẽ gọi xác nhận giao hàng trong vòng 24 giờ.';
    if (o.paid) { note.innerHTML = paidMsg; note.classList.add('paid-ok'); return; }
    note.insertAdjacentHTML('beforeend', '<span class="pay-wait" role="status">Đang chờ ngân hàng xác nhận giao dịch — trang sẽ tự cập nhật khi cửa hàng nhận được tiền.</span>');
    const until = Date.now() + 15 * 60 * 1000;
    const tick = async () => {
      if ($('#successSection').hidden || Date.now() > until) return;
      try {
        const r = await LUA.api(`/api/orders/${encodeURIComponent(o.orderCode)}/payment?phone=${encodeURIComponent(o.phone)}`);
        if (r.paymentStatus === 'paid') {
          o.paid = true;
          try { sessionStorage.setItem(LAST_KEY, JSON.stringify(o)); } catch (e) { /* bỏ qua */ }
          note.innerHTML = paidMsg;
          note.classList.add('paid-ok');
          LUA.toast('Đã nhận được tiền chuyển khoản. Cảm ơn bạn!');
          return;
        }
      } catch (e) { /* mạng chập chờn: thử lại lần sau */ }
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 3000);
  }
})();