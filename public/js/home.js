/* Trang chủ: danh mục, nổi bật, hàng mới, vừa xem, Instagram */
(function () {
  const { $, $$, productCard, swatchHTML, money, escapeHTML, skeletonCards } = LUA;

  $('#featuredGrid').innerHTML = skeletonCards(4);

  LUA.ready.then(() => {
    $$('[data-cat-count]').forEach((el) => {
      el.textContent = `${PRODUCTS.filter((p) => p.cat === el.dataset.catCount).length} sản phẩm`;
    });

    $('#featuredGrid').innerHTML = PRODUCTS.filter((p) => p.featured).slice(0, 4).map(productCard).join('');

    // Có ảnh sản phẩm thì dùng ảnh thật cho thẻ danh mục, banner và khối lookbook (không có thì giữ ô màu vải)
    const byPriority = (list) => list.slice().sort((a, b) => (b.featured - a.featured) || (b.sold - a.sold));
    $$('.category-card').forEach((card) => {
      const cat = card.querySelector('[data-cat-count]').dataset.catCount;
      LUA.fillPhoto(card.querySelector('.swatch'), LUA.withPhoto(byPriority(PRODUCTS.filter((p) => p.cat === cat)))[0]);
    });
    const heroPics = LUA.withPhoto(byPriority(PRODUCTS));
    $$('.hero .swatch-grid .swatch').forEach((el, i) => LUA.fillPhoto(el, heroPics[i]));
    const edPics = LUA.withPhoto([1, 2, 3, 4, 5].map(LUA.getProduct));
    $$('.ed-media .swatch').forEach((el, i) => LUA.fillPhoto(el, edPics[i]));

    $('#newGrid').innerHTML = PRODUCTS.filter((p) => p.isNew).slice(0, 5).map((p) => `
      <a href="chitiet.html?id=${p.id}">
        ${swatchHTML(p)}
        <h3>${escapeHTML(p.name)}</h3>
        <span class="price">${money(p.price)}</span>
      </a>`).join('');

    // Bạn vừa xem
    const recent = LUA.getRecent().map(LUA.getProduct).filter(Boolean).slice(0, 4);
    if (recent.length) {
      $('#recentSection').hidden = false;
      $('#recentGrid').innerHTML = recent.map(productCard).join('');
    }

    // Instagram: ảnh mẫu dựng từ sản phẩm — thay bằng ảnh thật trong public/images khi có
    $('#instaGrid').innerHTML = PRODUCTS.slice().sort((a, b) => b.sold - a.sold).slice(0, 6).map((p) => `
      <a href="https://www.instagram.com/luastudio.vn" target="_blank" rel="noopener" aria-label="Xem ${escapeHTML(p.name)} trên Instagram">
        ${swatchHTML(p)}<span class="insta-cap">♥ ${Math.round(p.sold * 3.7)}</span>
      </a>`).join('');
  }).catch(() => {
    $('#featuredGrid').innerHTML = '<p class="muted">Không tải được sản phẩm. Kiểm tra máy chủ và kết nối MySQL.</p>';
  });
})();
