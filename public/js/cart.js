/* Trang Giỏ hàng: sửa số lượng, xóa, mã giảm giá (kiểm tra với server), cảnh báo tồn kho */
(function () {
  const { $, money, escapeHTML, swatchHTML, colorName } = LUA;

  function render() {
    const t = LUA.totals(null);
    const empty = t.lines.length === 0;
    $('#cartEmpty').hidden = !empty;
    $('#cartLayout').hidden = empty;
    if (empty) return;

    $('#cartLines').innerHTML = t.lines.map((l) => `
      <div class="cart-line" data-key="${escapeHTML(l.key)}">
        <div class="cart-item">
          <a href="chitiet.html?id=${l.id}">${swatchHTML(l.product, l.color)}</a>
          <div>
            <h3><a href="chitiet.html?id=${l.id}">${escapeHTML(l.product.name)}</a></h3>
            <div class="variant">Màu: ${escapeHTML(colorName(l.color))} · Size: ${escapeHTML(l.size)}</div>
            <div class="unit">${money(l.product.price)}${l.product.oldPrice ? ` <span class="price-old">${money(l.product.oldPrice)}</span>` : ''}</div>
            ${l.qty > l.stock ? `<div class="stock-note low">${l.stock ? `Chỉ còn ${l.stock} sản phẩm — vui lòng giảm số lượng` : 'Đã hết hàng — vui lòng xóa khỏi giỏ'}</div>` : ''}
            <button type="button" class="link-btn" data-action="remove">Xóa</button>
          </div>
        </div>
        <div class="qty sm">
          <button type="button" data-action="dec" aria-label="Giảm số lượng">−</button>
          <input type="number" min="1" max="10" value="${l.qty}" aria-label="Số lượng ${escapeHTML(l.product.name)}">
          <button type="button" data-action="inc" aria-label="Tăng số lượng">+</button>
        </div>
        <div class="line-total">${money(l.lineTotal)}</div>
      </div>`).join('');

    $('#sumCount').textContent = LUA.cartCount();
    $('#sumSubtotal').textContent = money(t.subtotal);
    $('#sumTotal').textContent = money(t.total);
    $('#rowDiscount').hidden = !(t.discount > 0);
    if (t.discount > 0) { $('#sumCode').textContent = t.coupon.code; $('#sumDiscount').textContent = '−' + money(t.discount); }
    $('#sumShip').textContent = t.freeship ? 'Miễn phí (FREESHIP)' : 'Tính ở bước thanh toán';

    vbox.render(t);
    const blocked = t.lines.some((l) => l.qty > l.stock);
    $('#toCheckout').classList.toggle('is-disabled', blocked);
    $('#toCheckout').setAttribute('aria-disabled', blocked);
  }

  $('#cartLines').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const line = btn.closest('.cart-line');
    const key = line.dataset.key;
    const qty = parseInt(line.querySelector('input').value, 10) || 1;
    if (btn.dataset.action === 'remove') LUA.removeLine(key);
    if (btn.dataset.action === 'inc') LUA.setQty(key, Math.min(qty + 1, 10));
    if (btn.dataset.action === 'dec') LUA.setQty(key, Math.max(qty - 1, 1));
    render();
  });

  $('#cartLines').addEventListener('change', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    const n = parseInt(e.target.value, 10);
    LUA.setQty(e.target.closest('.cart-line').dataset.key, isNaN(n) ? 1 : Math.max(0, n));
    render();
  });

  const vbox = LUA.voucherBox($('#voucherBox'), render);

  $('#toCheckout').addEventListener('click', (e) => {
    if ($('#toCheckout').classList.contains('is-disabled')) {
      e.preventDefault();
      LUA.toast('Có sản phẩm vượt quá tồn kho. Vui lòng cập nhật giỏ hàng.');
    }
  });

  // Xác nhận ngay trên trang: bấm lần 1 để hỏi, bấm lần 2 trong 4 giây để xóa
  let confirmTimer;
  $('#clearCart').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.confirm === '1') { clearTimeout(confirmTimer); LUA.clearCart(); render(); return; }
    btn.dataset.confirm = '1';
    btn.textContent = 'Bấm lần nữa để xác nhận xóa';
    btn.classList.add('danger');
    confirmTimer = setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Xóa toàn bộ giỏ hàng'; btn.classList.remove('danger'); }, 4000);
  });

  LUA.ready.then(render);
})();