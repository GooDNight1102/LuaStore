/* Trang Chi tiết: chọn màu/size theo tồn kho thật, yêu thích, đánh giá, vừa xem, thanh mua dính (mobile) */
(function () {
  const { $, money, escapeHTML, swatchHTML, productCard, categoryName, colorName, discountPercent, stockOf, stars } = LUA;

  LUA.ready.then(() => {
    const p = LUA.getProduct(LUA.param('id'));
    if (!p) {
      ['#pdSection', '#relatedSection', '#reviewSection'].forEach((s) => { $(s).hidden = true; });
      $('#notFound').hidden = false;
      $('#bcName').textContent = 'Không tìm thấy';
      return;
    }
    LUA.pushRecent(p.id);

    const imgOfColor = (c) => (p.images.find((i) => i.color === c) || {}).url;
    // Màu chọn sẵn: ưu tiên màu còn hàng CÓ ảnh riêng
    const inStock = p.colors.filter((c) => p.sizes.some((s) => stockOf(p, s, c) > 0));
    const firstColor = inStock.find(imgOfColor) || inStock[0] || p.colors[0];
    const state = { color: firstColor, size: null, qty: 1 };
    if (p.sizes.length === 1 && stockOf(p, p.sizes[0], firstColor)) state.size = p.sizes[0];
    const stockNow = () => (state.size ? stockOf(p, state.size, state.color) : 0);

    /* ---------- Thông tin ---------- */
    $('#bcCat').textContent = categoryName(p.cat);
    $('#bcCat').href = `sanpham.html?cat=${p.cat}`;
    $('#bcName').textContent = p.name;
    $('#pdCat').textContent = categoryName(p.cat);
    $('#pdName').textContent = p.name;
    $('#pdSku').textContent = `Mã sản phẩm: ${p.sku} · Đã bán ${p.sold}`;
    $('#pdDesc').textContent = p.desc || '';
    $('#pdMaterial').textContent = p.material ? `Chất liệu: ${p.material}.` : '';
    $('#pdRating').innerHTML = p.reviewCount ? `${stars(p.rating)} ${p.rating}/5 · ${p.reviewCount} đánh giá` : 'Chưa có đánh giá — viết đánh giá đầu tiên';
    $('#pdPrice').innerHTML = `<span class="price">${money(p.price)}</span>` +
      (p.oldPrice ? `<span class="price-old">${money(p.oldPrice)}</span><span class="save">Tiết kiệm ${discountPercent(p)}%</span>` : '');
    $('#wishBtn').dataset.wish = p.id;
    $('#wishBtn').setAttribute('aria-pressed', LUA.isWished(p.id));
    $('#stickyName').textContent = p.name;
    $('#stickyPrice').textContent = money(p.price);

    /* ---------- Ảnh, màu, size ---------- */
    // Ảnh theo màu: ảnh gắn màu đó -> ảnh chung. Màu không có ảnh thì hiện ô màu vải, không mượn ảnh của màu khác.
    const imgsOf = (c) => [p.images.filter((i) => i.color === c), p.images.filter((i) => !i.color)].find((l) => l.length) || [];
    const photo = (url) => `<div class="swatch photo"><img src="${escapeHTML(url)}" alt="${escapeHTML(p.name)}"></div>`;

    function render() {
      const pics = imgsOf(state.color);
      if (!pics.some((i) => i.url === state.img)) state.img = pics.length ? pics[0].url : null;
      $('#mainSwatch').innerHTML = state.img ? photo(state.img) : swatchHTML({ ...p, imageUrl: null }, state.color);
      const thumbs = $('#thumbs');
      if (p.images.length) {
        thumbs.hidden = pics.length < 2;
        thumbs.innerHTML = pics.map((i) => `<button type="button" data-img="${escapeHTML(i.url)}" aria-label="Xem ảnh" aria-current="${i.url === state.img}">${photo(i.url)}</button>`).join('');
      } else {
        thumbs.hidden = p.colors.length < 2;
        thumbs.innerHTML = p.colors.map((c) =>
          `<button type="button" data-color="${c}" aria-label="Xem màu ${escapeHTML(colorName(c))}" aria-current="${c === state.color}">${swatchHTML(p, c)}</button>`).join('');
      }

      // Màu có ảnh riêng -> ô chọn màu là ảnh thu nhỏ; màu chưa có ảnh -> ô cùng cỡ tô màu vải
      $('#colorOptions').classList.toggle('tiles', p.images.some((i) => i.color));
      $('#colorOptions').innerHTML = p.colors.map((c) => {
        const url = imgOfColor(c);
        return `<button type="button" class="color-opt${url ? ' has-img' : ''}" role="radio" data-color="${c}" aria-checked="${c === state.color}" aria-label="${escapeHTML(colorName(c))}" style="background:${COLORS[c].hex}">${url ? `<img src="${escapeHTML(url)}" alt="">` : ''}</button>`;
      }).join('');
      $('#colorName').textContent = colorName(state.color);

      $('#sizeOptions').innerHTML = p.sizes.map((s) => {
        const n = stockOf(p, s, state.color);
        return `<button type="button" class="chip" role="radio" data-size="${s}" aria-checked="${s === state.size}" ${n ? '' : 'disabled title="Hết hàng"'}>${s}</button>`;
      }).join('');

      const n = stockNow();
      $('#stockNote').textContent = !state.size ? '' : n <= 3 ? `Chỉ còn ${n} sản phẩm` : 'Còn hàng';
      $('#stockNote').className = 'stock-note' + (state.size && n <= 3 ? ' low' : '');
      const allOut = p.sizes.every((s) => !stockOf(p, s, state.color));
      $('#addBtn').disabled = $('#buyBtn').disabled = allOut;
      $('#pdHint').textContent = allOut ? `Màu ${colorName(state.color)} đã hết hàng. Vui lòng chọn màu khác.` : '';
      setQty(state.qty);
    }

    $('#pdSection').addEventListener('click', (e) => {
      const c = e.target.closest('[data-color]');
      const s = e.target.closest('[data-size]');
      const im = e.target.closest('[data-img]');
      if (im) { state.img = im.dataset.img; render(); }
      if (c) {
        state.color = c.dataset.color;
        if (state.size && !stockOf(p, state.size, state.color)) state.size = null;
        render();
      }
      if (s && !s.disabled) { state.size = s.dataset.size; $('#pdHint').textContent = ''; render(); }
    });

    /* ---------- Số lượng (không vượt tồn kho) ---------- */
    const qtyInput = $('#qtyInput');
    function setQty(n) {
      const max = Math.min(10, stockNow() || 10);
      state.qty = Math.max(1, Math.min(max, n || 1));
      qtyInput.value = state.qty;
    }
    $('#qtyBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (b) setQty(state.qty + Number(b.dataset.step));
    });
    qtyInput.addEventListener('change', () => setQty(parseInt(qtyInput.value, 10)));

    /* ---------- Thêm vào giỏ ---------- */
    function add() {
      if (!state.size) {
        $('#pdHint').textContent = 'Vui lòng chọn kích cỡ trước khi thêm vào giỏ.';
        $('#sizeOptions').scrollIntoView({ block: 'center', behavior: 'smooth' });
        const first = $('#sizeOptions .chip:not(:disabled)');
        if (first) first.focus({ preventScroll: true });
        return false;
      }
      const inCart = LUA.getCart().filter((l) => l.id === p.id && l.size === state.size && l.color === state.color).reduce((s, l) => s + l.qty, 0);
      if (inCart + state.qty > stockNow()) {
        $('#pdHint').textContent = `Kho chỉ còn ${stockNow()} sản phẩm (giỏ của bạn đã có ${inCart}).`;
        return false;
      }
      LUA.addToCart(p.id, state.size, state.color, state.qty);
      return true;
    }
    const onAdd = () => {
      if (add()) LUA.toast(`Đã thêm <strong>${escapeHTML(p.name)}</strong> (${escapeHTML(colorName(state.color))}, ${state.size}) vào giỏ.<a href="giohang.html">Xem giỏ hàng</a>`);
    };
    $('#addBtn').addEventListener('click', onAdd);
    $('#stickyAdd').addEventListener('click', onAdd);
    $('#buyBtn').addEventListener('click', () => { if (add()) location.href = 'thanhtoan.html'; });

    // Thanh "Thêm vào giỏ" dính dưới màn hình khi nút chính đã cuộn khỏi tầm nhìn (chỉ hiện trên điện thoại qua CSS)
    new IntersectionObserver(([entry]) => {
      $('#stickyBar').classList.toggle('show', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    }).observe($('#addBtn'));

    render();

    /* ---------- Rê chuột vào ô màu: ảnh màu đó nổi lên cạnh con trỏ ---------- */
    const float = document.createElement('div');
    float.className = 'color-float';
    float.hidden = true;
    document.body.append(float);
    const opts = $('#colorOptions');
    opts.addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b || e.pointerType !== 'mouse') return;
      const c = b.dataset.color, url = imgOfColor(c);
      float.innerHTML = (url ? `<img src="${escapeHTML(url)}" alt="">` : `<i style="background:${COLORS[c].hex}"></i>`) + `<span>${escapeHTML(colorName(c))}</span>`;
      float.hidden = false;
    });
    opts.addEventListener('pointermove', (e) => {
      if (float.hidden) return;
      const w = float.offsetWidth, h = float.offsetHeight;
      float.style.left = `${Math.min(e.clientX + 18, innerWidth - w - 8)}px`;
      float.style.top = `${Math.max(8, Math.min(e.clientY + 18, innerHeight - h - 8))}px`;
    });
    opts.addEventListener('pointerout', (e) => { if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('#colorOptions [data-color]'))) float.hidden = true; });

    /* ---------- Liên quan & vừa xem ---------- */
    const same = PRODUCTS.filter((x) => x.cat === p.cat && x.id !== p.id);
    const others = PRODUCTS.filter((x) => x.cat !== p.cat).sort((a, b) => b.sold - a.sold);
    $('#relatedGrid').innerHTML = same.concat(others).slice(0, 4).map(productCard).join('');
    $('#relatedAll').href = `sanpham.html?cat=${p.cat}`;

    const recent = LUA.getRecent().filter((id) => id !== p.id).map(LUA.getProduct).filter(Boolean).slice(0, 4);
    if (recent.length) {
      $('#recentSection').hidden = false;
      $('#recentGrid').innerHTML = recent.map(productCard).join('');
    }

    loadReviews(p);
  });

  /* ---------- Đánh giá ---------- */
  const maskName = (n) => { const w = n.trim().split(/\s+/); return w.length > 1 ? `${w.slice(0, -1).join(' ')} ${w[w.length - 1][0]}.` : n; };
  const viDate = (d) => String(d).slice(0, 10).split('-').reverse().join('/');

  async function loadReviews(p) {
    const box = $('#reviewList');
    let data, user;
    try {
      [data, user] = await Promise.all([LUA.api(`/api/products/${p.id}/reviews`), LUA.me()]);
    } catch (e) {
      box.innerHTML = `<p class="muted">${escapeHTML(e.message)}</p>`;
      return;
    }
    const list = data.reviews;
    const avg = list.length ? (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1) : null;

    $('#reviewSummary').innerHTML = list.length ? `
      <div class="rv-score"><strong>${avg}</strong><span>${stars(Number(avg))}</span><small>${list.length} đánh giá</small></div>
      <div class="rv-bars">${[5, 4, 3, 2, 1].map((n) => {
        const c = list.filter((r) => r.rating === n).length;
        return `<div><span>${n}★</span><i><b style="width:${(c / list.length) * 100}%"></b></i><span>${c}</span></div>`;
      }).join('')}</div>` : '<p class="muted">Chưa có đánh giá nào cho sản phẩm này.</p>';

    box.innerHTML = list.map((r) => `
      <article class="review">
        <header>${stars(r.rating)} <strong>${escapeHTML(maskName(r.name))}</strong>
          ${r.verified ? '<span class="pill ok">Đã mua hàng</span>' : ''}<time>${viDate(r.created_at)}</time></header>
        <p>${escapeHTML(r.content)}</p>
      </article>`).join('');

    const formBox = $('#reviewFormBox');
    const next = encodeURIComponent(`chitiet.html?id=${p.id}#danh-gia`);
    if (!user) formBox.innerHTML = `<p><a class="btn" href="dangnhap.html?next=${next}">Đăng nhập để viết đánh giá</a></p>`;
    else if (user.role !== 'customer') formBox.innerHTML = '<p class="muted">Tài khoản nhân viên/quản trị không viết đánh giá. Kiểm duyệt đánh giá trong trang Quản trị.</p>';
    else if (data.reviewedByMe) formBox.innerHTML = '<p class="muted">Bạn đã đánh giá sản phẩm này. Cảm ơn bạn!</p>';
    else {
      formBox.innerHTML = `
        <form id="reviewForm" novalidate>
          <fieldset class="star-input">
            <legend>Chấm điểm của bạn</legend>
            ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="rt${n}" value="${n}"><label for="rt${n}" title="${n} sao">★</label>`).join('')}
          </fieldset>
          <div class="form-field">
            <label for="rvContent">Nhận xét</label>
            <textarea id="rvContent" name="content" maxlength="1000" placeholder="Chất vải, form dáng, size bạn chọn…"></textarea>
          </div>
          <p class="field-error" id="rvError" role="alert"></p>
          <button class="btn btn-primary" type="submit">Gửi đánh giá</button>
        </form>`;
      $('#reviewForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          await LUA.api(`/api/products/${p.id}/reviews`, { method: 'POST', body: { rating: Number((f.rating.value || 0)), content: f.content.value } });
          LUA.toast('Cảm ơn bạn đã đánh giá!');
          loadReviews(p);
        } catch (err) {
          $('#rvError').textContent = err.message;
        }
      });
    }
  }
})();