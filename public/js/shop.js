/* Trang Sản phẩm: lọc theo danh mục, giá, size, màu; tìm kiếm; sắp xếp */
LUA.$('#productGrid').innerHTML = LUA.skeletonCards(6);

LUA.ready.then(() => {
  const { $, productCard, param, escapeHTML } = LUA;

  const SIZE_ORDER = ['S', 'M', 'L', 'XL', 'Free size'];
  const SORT_LABELS = { macdinh: 'Nổi bật', moinhat: 'Mới nhất', banchay: 'Bán chạy', giatang: 'Giá tăng dần', giagiam: 'Giá giảm dần' };

  const state = {
    cat: CATEGORIES.some((c) => c.id === param('cat')) ? param('cat') : '',
    price: '',
    sizes: new Set(),
    colors: new Set(),
    sale: param('sale') === '1',
    isNew: param('new') === '1',
    q: param('q') || '',
    sort: SORT_LABELS[param('sort')] ? param('sort') : 'macdinh',
    page: Math.max(1, parseInt(param('page'), 10) || 1)
  };


  /* ---------- Dựng bộ lọc ---------- */
  function renderCategoryFilter() {
    const opts = [{ id: '', name: 'Tất cả', count: PRODUCTS.length }]
      .concat(CATEGORIES.map((c) => ({ ...c, count: PRODUCTS.filter((p) => p.cat === c.id).length })));
    $('#catFilter').innerHTML = opts.map((c) => `
      <label class="check"><input type="radio" name="cat" value="${c.id}" ${state.cat === c.id ? 'checked' : ''}> ${escapeHTML(c.name)} <span class="count">${c.count}</span></label>`).join('');
  }

  function renderSizeFilter() {
    const sizes = SIZE_ORDER.filter((s) => PRODUCTS.some((p) => p.sizes.includes(s)));
    $('#sizeFilter').innerHTML = sizes.map((s) =>
      `<button type="button" class="chip" data-size="${s}" aria-pressed="${state.sizes.has(s)}">${s}</button>`).join('');
  }

  function renderColorFilter() {
    const used = Object.keys(COLORS).filter((k) => PRODUCTS.some((p) => p.colors.includes(k)));
    $('#colorFilter').innerHTML = used.map((k) =>
      `<button type="button" class="color-opt" data-color="${k}" style="background:${COLORS[k].hex}" role="checkbox" aria-checked="${state.colors.has(k)}" title="${COLORS[k].name}" aria-label="${COLORS[k].name}"></button>`).join('');
  }

  /* ---------- Lọc, sắp xếp, phân trang: làm ở server (GET /api/products) ---------- */
  const PER_PAGE = 9;
  function query() {
    const p = new URLSearchParams({ sort: state.sort, page: state.page, limit: PER_PAGE });
    if (state.cat) p.set('cat', state.cat);
    if (state.price) p.set('price', state.price);
    if (state.sizes.size) p.set('sizes', [...state.sizes].join(','));
    if (state.colors.size) p.set('colors', [...state.colors].join(','));
    if (state.sale) p.set('sale', '1');
    if (state.isNew) p.set('new', '1');
    if (state.q.trim()) p.set('q', state.q.trim());
    return p;
  }

  /* ---------- Hiển thị ---------- */
  function renderActiveFilters() {
    const pills = [];
    if (state.cat) pills.push(['cat', LUA.categoryName(state.cat)]);
    if (state.price) pills.push(['price', $(`input[name="price"][value="${state.price}"]`).parentElement.textContent.trim()]);
    state.sizes.forEach((s) => pills.push(['size:' + s, 'Size ' + s]));
    state.colors.forEach((c) => pills.push(['color:' + c, COLORS[c].name]));
    if (state.sale) pills.push(['sale', 'Đang giảm giá']);
    if (state.isNew) pills.push(['new', 'Hàng mới về']);
    if (state.q.trim()) pills.push(['q', `“${state.q.trim()}”`]);
    $('#activeFilters').innerHTML = pills.map(([k, label]) =>
      `<button type="button" data-remove="${escapeHTML(k)}" aria-label="Bỏ lọc ${escapeHTML(label)}">${escapeHTML(label)} <span aria-hidden="true">×</span></button>`).join('');
  }

  function syncURL() {
    const p = new URLSearchParams();
    if (state.cat) p.set('cat', state.cat);
    if (state.sale) p.set('sale', '1');
    if (state.isNew) p.set('new', '1');
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.sort !== 'macdinh') p.set('sort', state.sort);
    if (state.page > 1) p.set('page', state.page);
    const qs = p.toString();
    try { history.replaceState(null, '', qs ? `?${qs}` : location.pathname); } catch (e) { /* bỏ qua */ }
  }

  let seq = 0;   // bỏ kết quả cũ nếu người dùng lọc tiếp trong lúc đang tải
  async function render(keepPage) {
    if (!keepPage) state.page = 1;
    const my = ++seq;
    renderActiveFilters();
    syncURL();
    $('#productGrid').setAttribute('aria-busy', 'true');
    let data;
    try { data = await LUA.api(`/api/products?${query()}`); } catch (e) {
      $('#productGrid').innerHTML = `<p class="muted">${escapeHTML(e.message)}</p>`;
      return;
    }
    if (my !== seq) return;
    $('#productGrid').removeAttribute('aria-busy');
    $('#productGrid').innerHTML = data.items.map(productCard).join('');
    $('#emptyState').hidden = data.total > 0;
    $('#resultCount').textContent = `${data.total} sản phẩm`;
    $('#shopTitle').textContent = state.cat ? LUA.categoryName(state.cat) : (state.sale ? 'Đang giảm giá' : state.isNew ? 'Hàng mới về' : 'Tất cả sản phẩm');
    renderPager(data);
  }

  function renderPager({ page, pages }) {
    const pager = $('#pager');
    pager.hidden = pages < 2;
    const btn = (n, label, extra = '') => `<button type="button" class="chip" data-page="${n}" ${extra}>${label}</button>`;
    pager.innerHTML = btn(page - 1, '‹', `aria-label="Trang trước" ${page === 1 ? 'disabled' : ''}`)
      + Array.from({ length: pages }, (_, i) => btn(i + 1, i + 1, i + 1 === page ? 'aria-current="page"' : '')).join('')
      + btn(page + 1, '›', `aria-label="Trang sau" ${page === pages ? 'disabled' : ''}`);
  }

  function resetAll() {
    Object.assign(state, { cat: '', price: '', sale: false, isNew: false, q: '' });
    state.sizes.clear(); state.colors.clear();
    $('#searchInput').value = '';
    $('input[name="price"][value=""]').checked = true;
    $('#saleOnly').checked = false;
    $('#newOnly').checked = false;
    renderCategoryFilter(); renderSizeFilter(); renderColorFilter();
    render();
  }

  /* ---------- Sự kiện ---------- */
  renderCategoryFilter(); renderSizeFilter(); renderColorFilter();
  $('#searchInput').value = state.q;
  $('#sortSelect').value = state.sort;
  $('#saleOnly').checked = state.sale;
  $('#newOnly').checked = state.isNew;

  $('#filters').addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'cat') state.cat = t.value;
    if (t.name === 'price') state.price = t.value;
    if (t.id === 'saleOnly') state.sale = t.checked;
    if (t.id === 'newOnly') state.isNew = t.checked;
    render();
  });

  $('#filters').addEventListener('click', (e) => {
    const size = e.target.closest('[data-size]');
    const color = e.target.closest('[data-color]');
    if (size) {
      const s = size.dataset.size;
      state.sizes.has(s) ? state.sizes.delete(s) : state.sizes.add(s);
      size.setAttribute('aria-pressed', state.sizes.has(s));
      render();
    }
    if (color) {
      const c = color.dataset.color;
      state.colors.has(c) ? state.colors.delete(c) : state.colors.add(c);
      color.setAttribute('aria-checked', state.colors.has(c));
      render();
    }
  });

  $('#activeFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const k = btn.dataset.remove;
    if (k === 'cat') { state.cat = ''; renderCategoryFilter(); }
    else if (k === 'price') { state.price = ''; $('input[name="price"][value=""]').checked = true; }
    else if (k === 'sale') { state.sale = false; $('#saleOnly').checked = false; }
    else if (k === 'new') { state.isNew = false; $('#newOnly').checked = false; }
    else if (k === 'q') { state.q = ''; $('#searchInput').value = ''; }
    else if (k.startsWith('size:')) { state.sizes.delete(k.slice(5)); renderSizeFilter(); }
    else if (k.startsWith('color:')) { state.colors.delete(k.slice(6)); renderColorFilter(); }
    render();
  });

  let searchTimer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value; render(); }, 200);
  });

  $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    render(true);
    $('#shopTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#clearFilters').addEventListener('click', resetAll);
  $('#emptyReset').addEventListener('click', resetAll);

  $('#filterToggle').addEventListener('click', (e) => {
    const open = $('#filters').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });

  if (location.hash === '#tim-kiem') setTimeout(() => $('#searchInput').focus(), 50);

  render(true);
});