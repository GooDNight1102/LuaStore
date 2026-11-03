/* =========================================================
   LỤA — Khung trang dùng chung (tự chèn vào mọi trang khách)
   Header + mega menu, tìm kiếm toàn màn hình, footer,
   nút liên hệ nổi, popup đăng ký nhận tin.
   Sửa menu/footer ở MỘT chỗ này thay vì sửa từng file HTML.
   ========================================================= */
(function () {
  const { $, $$, escapeHTML, money, norm } = LUA;
  const file = location.pathname.split('/').pop() || 'index.html';

  const I = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    user:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    heart:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    bag:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 8h14l-1.2 12H6.2L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    chat:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    moon:   '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    sun:    '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    phone:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>'
  };

  /* ---------- Header ---------- */
  const nav = [
    ['index.html', 'Trang chủ'],
    ['sanpham.html', 'Sản phẩm', true],
    ['lookbook.html', 'Lookbook'],
    ['gioithieu.html', 'Giới thiệu'],
    ['lienhe.html', 'Liên hệ']
  ];
  const current = file === 'chitiet.html' ? 'sanpham.html' : file;
  const link = ([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`;

  const header = `
  <a class="skip-link" href="#main">Bỏ qua menu</a>
  <header class="site-header">
    <div class="wrap">
      <a href="index.html" class="logo">LỤA<span>.</span></a>
      <nav class="main-nav" id="mainNav" aria-label="Menu chính">
        ${nav.map((n) => n[2] ? `
        <div class="has-mega">
          ${link(n)}
          <button type="button" class="mega-toggle" aria-expanded="false" aria-controls="megaMenu" aria-label="Mở danh mục sản phẩm">▾</button>
          <div class="mega" id="megaMenu">
            <div class="wrap mega-inner">
              <div><h4>Danh mục</h4><ul id="megaCats"><li class="muted">Đang tải…</li></ul></div>
              <div><h4>Mua theo</h4><ul>
                <li><a href="sanpham.html?new=1">Hàng mới về</a></li>
                <li><a href="sanpham.html?sale=1">Đang giảm giá</a></li>
                <li><a href="sanpham.html?sort=banchay">Bán chạy nhất</a></li>
                <li><a href="lookbook.html">Lookbook Thu — Đông</a></li>
              </ul></div>
              <div><h4>Hỗ trợ</h4><ul>
                <li><a href="chinhsach.html">Chính sách mua hàng</a></li>
                <li><a href="doitra.html">Đổi trả trong 7 ngày</a></li>
                <li><a href="yeuthich.html">Sản phẩm yêu thích</a></li>
                <li><a href="taikhoan.html">Tra cứu đơn hàng</a></li>
              </ul></div>
              <a class="mega-feature" id="megaFeature" href="sanpham.html"></a>
            </div>
          </div>
        </div>` : link(n)).join('')}
      </nav>
      <div class="header-actions">
        <button type="button" class="icon-btn theme-btn" id="themeToggle" aria-label="Đổi chế độ sáng/tối">${I.moon}${I.sun}</button>
        <button type="button" class="icon-btn" id="searchOpen" aria-label="Tìm kiếm">${I.search}</button>
        <a href="dangnhap.html" class="icon-btn" id="accountLink" aria-label="Đăng nhập">${I.user}</a>
        <a href="yeuthich.html" class="icon-btn"${file === 'yeuthich.html' ? ' aria-current="page"' : ''} aria-label="Sản phẩm yêu thích">${I.heart}<span class="cart-count" data-wish-count hidden>0</span></a>
        <a href="giohang.html" class="icon-btn"${file === 'giohang.html' ? ' aria-current="page"' : ''} aria-label="Giỏ hàng">${I.bag}<span class="cart-count" data-cart-count hidden>0</span></a>
        <button class="nav-toggle" id="navToggle" aria-label="Mở menu" aria-expanded="false" aria-controls="mainNav"><span></span></button>
      </div>
    </div>
  </header>`;

  /* ---------- Tìm kiếm toàn màn hình ---------- */
  const search = `
  <dialog class="search-overlay" id="searchOverlay" aria-label="Tìm kiếm sản phẩm">
    <div class="wrap">
      <form action="sanpham.html" role="search" class="search-form">
        ${I.search}
        <label class="sr-only" for="searchQ">Tìm sản phẩm</label>
        <input type="search" id="searchQ" name="q" placeholder="Tìm áo sơ mi, linen, túi da…" autocomplete="off">
        <button type="button" class="modal-close" id="searchClose" aria-label="Đóng tìm kiếm">×</button>
      </form>
      <p class="search-hint" id="searchHint">Gợi ý: <a href="sanpham.html?q=lụa">lụa</a> · <a href="sanpham.html?q=linen">linen</a> · <a href="sanpham.html?sale=1">đang giảm giá</a></p>
      <div class="search-results" id="searchResults"></div>
    </div>
  </dialog>`;

  /* ---------- Footer ---------- */
  const footer = `
  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div>
          <span class="logo">LỤA<span style="color:var(--brass)">.</span></span>
          <p>Thời trang nữ từ chất liệu tự nhiên, may đo tinh gọn cho nhịp sống hiện đại.</p>
          <form class="footer-news" data-newsletter>
            <label for="footerEmail">Nhận tin bộ sưu tập mới &amp; ưu đãi riêng</label>
            <div><input type="email" id="footerEmail" name="email" placeholder="Email của bạn" required><button class="btn btn-ghost" type="submit">Đăng ký</button></div>
            <p class="news-msg" role="status"></p>
          </form>
        </div>
        <div>
          <h4>DANH MỤC</h4>
          <ul>
            <li><a href="sanpham.html?cat=ao">Áo</a></li>
            <li><a href="sanpham.html?cat=quan">Quần</a></li>
            <li><a href="sanpham.html?cat=vay">Váy &amp; Đầm</a></li>
            <li><a href="sanpham.html?cat=phukien">Phụ kiện</a></li>
            <li><a href="lookbook.html">Lookbook</a></li>
          </ul>
        </div>
        <div>
          <h4>HỖ TRỢ</h4>
          <ul>
            <li><a href="taikhoan.html">Tài khoản &amp; đơn hàng</a></li>
            <li><a href="chinhsach.html">Chính sách mua hàng</a></li>
            <li><a href="doitra.html">Chính sách đổi trả</a></li>
            <li><a href="lienhe.html">Liên hệ</a></li>
            <li><a href="gioithieu.html">Giới thiệu</a></li>
          </ul>
        </div>
        <div>
          <h4>CỬA HÀNG</h4>
          <ul>
            <li>12 Trần Phú, Hội An, Quảng Nam</li>
            <li>hoa@luastudio.vn</li>
            <li>090 123 4567</li>
            <li><a href="https://www.instagram.com/luastudio.vn" target="_blank" rel="noopener">Instagram @luastudio.vn</a></li>
            <li><a href="https://www.facebook.com/luastudio.vn" target="_blank" rel="noopener">Facebook LỤA Studio</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© 2026 LỤA Studio. Đã đăng ký bản quyền.</span>
        <span>Thiết kế bởi LỤA Design Team</span>
      </div>
    </div>
  </footer>`;

  /* ---------- Liên hệ nổi (thẻ <details> có sẵn, không cần JS) ---------- */
  const floating = `
  <details class="float-contact">
    <summary aria-label="Liên hệ nhanh">${I.chat}</summary>
    <div class="fc-links">
      <a href="tel:0901234567">${I.phone}<span>Gọi 090 123 4567</span></a>
      <a href="https://zalo.me/0901234567" target="_blank" rel="noopener"><b>Zalo</b><span>Nhắn Zalo</span></a>
      <a href="https://m.me/luastudio.vn" target="_blank" rel="noopener"><b>M</b><span>Messenger</span></a>
    </div>
  </details>`;

  /* ---------- Popup nhận tin ---------- */
  const popup = `
  <dialog class="modal nl-popup" id="nlPopup" aria-labelledby="nlTitle">
    <button type="button" class="modal-close" data-close aria-label="Đóng">×</button>
    <div class="nl-grid">
      <div class="swatch s6" aria-hidden="true"></div>
      <div>
        <span class="hero-eyebrow">Thư từ LỤA</span>
        <h2 id="nlTitle">Giảm 10% cho đơn đầu tiên</h2>
        <p>Đăng ký để nhận mã giảm giá, lịch ra mắt bộ sưu tập và mẹo chăm sóc vải lụa. Mỗi tháng tối đa 2 thư.</p>
        <form data-newsletter>
          <label class="sr-only" for="nlEmail">Email</label>
          <input type="email" id="nlEmail" name="email" class="input" placeholder="Email của bạn" required>
          <button class="btn btn-primary btn-block" type="submit">Nhận mã giảm giá</button>
          <p class="news-msg" role="status"></p>
        </form>
        <button type="button" class="link-btn" data-close>Để sau</button>
      </div>
    </div>
  </dialog>`;

  /* ---------- Chèn vào trang ---------- */
  document.body.insertAdjacentHTML('afterbegin', header + search);
  document.body.insertAdjacentHTML('beforeend', footer + floating + popup);

  // Menu mobile
  $('#navToggle').addEventListener('click', (e) => {
    const open = $('#mainNav').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });
  // Mega menu: di chuột trên máy tính (CSS), bấm nút ▾ trên điện thoại / bàn phím
  const megaWrap = $('.has-mega');
  $('.mega-toggle').addEventListener('click', (e) => {
    const open = megaWrap.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && megaWrap.classList.contains('open')) {
      megaWrap.classList.remove('open');
      $('.mega-toggle').setAttribute('aria-expanded', 'false');
    }
  });

  LUA.ready.then(() => {
    $('#megaCats').innerHTML = CATEGORIES.map((c) =>
      `<li><a href="sanpham.html?cat=${c.id}">${escapeHTML(c.name)} <small>${PRODUCTS.filter((p) => p.cat === c.id).length}</small></a></li>`).join('');
    const f = PRODUCTS.find((p) => p.featured) || PRODUCTS[0];
    if (f) {
      const feat = $('#megaFeature');
      feat.href = `chitiet.html?id=${f.id}`;
      feat.innerHTML = `${LUA.swatchHTML(f)}<span class="pc-cat">Nổi bật tuần này</span><strong>${escapeHTML(f.name)}</strong><span class="price">${money(f.price)}</span>`;
    }
  });

  // Tài khoản: đổi biểu tượng theo trạng thái đăng nhập
  LUA.me().then((u) => {
    if (!u) return;
    const a = $('#accountLink');
    a.href = u.role === 'customer' ? 'taikhoan.html' : 'admin.html';
    a.setAttribute('aria-label', `Tài khoản: ${u.fullName}`);
    a.title = `${u.fullName} (${{ customer: 'Khách hàng', staff: 'Nhân viên', admin: 'Quản trị' }[u.role]})`;
    a.classList.add('logged');
    if (['taikhoan.html', 'admin.html'].includes(file)) a.setAttribute('aria-current', 'page');
  });

  // Tìm kiếm
  const overlay = $('#searchOverlay');
  $('#searchOpen').addEventListener('click', () => { overlay.showModal(); $('#searchQ').focus(); });

  // Nút sáng/tối: đổi theo lựa chọn hiện tại (hoặc theo cài đặt của máy nếu chưa chọn)
  $('#themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('lua_theme', root.dataset.theme); } catch (e) { /* bỏ qua */ }
  });
  $('#searchClose').addEventListener('click', () => overlay.close());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.close(); });
  // Ô type=search tự "ăn" phím Esc để xóa chữ — đóng hẳn lớp tìm kiếm cho đúng mong đợi
  $('#searchQ').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); overlay.close(); } });
  $('#searchQ').addEventListener('input', (e) => {
    const q = norm(e.target.value.trim());
    const box = $('#searchResults');
    $('#searchHint').hidden = !!q;
    if (!q) { box.innerHTML = ''; return; }
    const hits = PRODUCTS.filter((p) => norm(`${p.name} ${p.material} ${LUA.categoryName(p.cat)}`).includes(q));
    box.innerHTML = hits.length
      ? hits.slice(0, 6).map((p) => `<a class="sr-item" href="chitiet.html?id=${p.id}">${LUA.swatchHTML(p)}<span>${escapeHTML(p.name)}<br><span class="price">${money(p.price)}</span></span></a>`).join('')
        + (hits.length > 6 ? `<a class="view-all" href="sanpham.html?q=${encodeURIComponent(e.target.value.trim())}">Xem tất cả ${hits.length} kết quả</a>` : '')
      : '<p class="muted">Không tìm thấy sản phẩm phù hợp.</p>';
  });

  // Form nhận tin (footer + popup)
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-newsletter]');
    if (!form) return;
    e.preventDefault();
    const msg = form.querySelector('.news-msg');
    try {
      await LUA.api('/api/newsletter', { method: 'POST', body: { email: form.email.value } });
      msg.textContent = 'Cảm ơn bạn! Dùng mã LUA10 để giảm 10% cho đơn từ 500.000₫.';
      msg.className = 'news-msg ok';
      form.reset();
      LUA.store.set('lua_nl_done', 1);
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'news-msg err';
    }
  });

  const nl = $('#nlPopup');
  nl.addEventListener('click', (e) => { if (e.target === nl || e.target.closest('[data-close]')) nl.close(); });
  nl.addEventListener('close', () => LUA.store.set('lua_nl_done', 1));
  // Hiện popup 1 lần, sau 15 giây, không làm phiền ở các trang mua/đăng nhập
  if (!LUA.store.get('lua_nl_done', 0) && !['giohang.html', 'thanhtoan.html', 'dangnhap.html'].includes(file)) {
    setTimeout(() => { if (!document.querySelector('dialog[open]')) nl.showModal(); }, 15000);
  }

  LUA.updateBadges();
})();