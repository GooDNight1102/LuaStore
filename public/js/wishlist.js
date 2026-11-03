/* Trang Yêu thích + Lookbook: hiển thị sản phẩm theo danh sách id */
(function () {
  const { $, $$, productCard } = LUA;

  function renderWishlist() {
    const grid = $('#wishGrid');
    if (!grid) return;
    const items = LUA.getWish().map(LUA.getProduct).filter(Boolean);
    grid.innerHTML = items.map(productCard).join('');
    $('#wishEmpty').hidden = items.length > 0;
    $('#wishCountText').textContent = `${items.length} sản phẩm`;
  }

  LUA.ready.then(() => {
    renderWishlist();
    // Lookbook: mỗi khối <div data-products="1,2,3"> hiện các sản phẩm của set đồ
    $$('[data-products]').forEach((el) => {
      const items = el.dataset.products.split(',').map(LUA.getProduct).filter(Boolean);
      el.innerHTML = items.map(productCard).join('');
      // Ảnh lớn của set đồ: lấy ảnh thật của các sản phẩm trong set (nếu có)
      const pics = LUA.withPhoto(items);
      const look = el.closest('.look');
      if (look) $$('.look-media .swatch', look).forEach((sw, i) => LUA.fillPhoto(sw, pics[i]));
    });
  });

  // Bỏ tim ngay trên trang yêu thích thì thẻ biến mất
  document.addEventListener('click', (e) => { if (e.target.closest('[data-wish]')) setTimeout(renderWishlist); });
})();
