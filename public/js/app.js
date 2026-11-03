/* =========================================================
   LỤA — JavaScript dùng chung cho mọi trang
   - Gọi API (fetch) và nạp danh mục sản phẩm từ MySQL
   - Giỏ hàng, yêu thích, sản phẩm vừa xem (localStorage)
   - Thẻ sản phẩm, xem nhanh (quick view), khung chờ (skeleton), thông báo
   ========================================================= */

// Được điền sau khi gọi /api/catalog (xem LUA.ready)
let CATEGORIES = [],
  COLORS = {},
  PRODUCTS = [],
  SHIPPING_REGIONS = {},
  BANK = null;
const COD_LIMIT = 5000000;

// Chế độ sáng/tối người dùng đã chọn (nút trên header) — áp dụng sớm để không bị nháy màu
try {
  const t = localStorage.getItem("lua_theme");
  if (t) document.documentElement.dataset.theme = t;
} catch (e) {
  /* bỏ qua */
}

const LUA = (function () {
  "use strict";

  /* ---------- Lưu trữ an toàn ---------- */
  const memory = {};
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return key in memory ? memory[key] : fallback;
      }
    },
    set(key, value) {
      memory[key] = value;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* bỏ qua */
      }
    },
    remove(key) {
      delete memory[key];
      try {
        localStorage.removeItem(key);
      } catch (e) {
        /* bỏ qua */
      }
    },
  };

  /* ---------- Gọi API ---------- */
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Không kết nối được máy chủ.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Danh mục sản phẩm: nạp 1 lần cho mỗi trang
  const ready = api("/api/catalog").then((d) => {
    CATEGORIES = d.categories;
    COLORS = d.colors;
    PRODUCTS = d.products;
    SHIPPING_REGIONS = d.regions;
    BANK = d.bank;
    return d;
  });
  ready.catch((e) => toast(`Không tải được dữ liệu: ${escapeHTML(e.message)}`));

  // Người dùng đang đăng nhập (hoặc null)
  let mePromise;
  const me = (refresh) => {
    if (!mePromise || refresh)
      mePromise = api("/api/auth/me")
        .then((r) => r.user)
        .catch(() => null);
    return mePromise;
  };

  /* ---------- Tiện ích ---------- */
  const money = (n) => Math.round(n).toLocaleString("vi-VN") + "₫";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) =>
    Array.from((root || document).querySelectorAll(sel));
  const escapeHTML = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const param = (name) => new URLSearchParams(location.search).get(name);
  // Bỏ dấu tiếng Việt để tìm "ao so mi" vẫn ra "Áo sơ mi"
  const norm = (s) =>
    String(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();

  const getProduct = (id) => PRODUCTS.find((p) => p.id === Number(id));
  const categoryName = (id) =>
    (CATEGORIES.find((c) => c.id === id) || {}).name || "";
  const discountPercent = (p) =>
    p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
  const stockOf = (p, size, color) => (p.stock || {})[`${size}|${color}`] ?? 0;
  const colorName = (c) => (COLORS[c] ? COLORS[c].name : c);

  function isLight(hex) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substr(0, 2), 16),
      g = parseInt(h.substr(2, 2), 16),
      b = parseInt(h.substr(4, 2), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 170;
  }

  /* Hình dáng sản phẩm dạng nét vẽ — dùng khi sản phẩm chưa có ảnh (image_url) */
  const SILHOUETTES = {
    ao: '<path d="M37 18 L24 23 L10 42 L20 50 L28 42 L28 112 L72 112 L72 42 L80 50 L90 42 L76 23 L63 18 Q50 30 37 18 Z"/><path d="M50 28 L50 112"/>',
    quan: '<path d="M30 16 L70 16 L74 114 L56 114 L50 46 L44 114 L26 114 Z"/><path d="M30 26 L70 26"/>',
    vay: '<path d="M41 14 L59 14 L57 42 L80 114 L20 114 L43 42 Z"/><path d="M43 42 L57 42"/><path d="M41 14 L38 4 M59 14 L62 4"/>',
    phukien:
      '<path d="M24 52 L76 52 L80 110 L20 110 Z"/><path d="M38 52 Q38 26 50 26 Q62 26 62 52"/><path d="M24 70 L76 70"/>',
    skirt:
      '<path d="M36 30 L64 30 L80 108 L20 108 Z"/><path d="M36 38 L64 38"/><path d="M43 38 L36 108 M50 38 L50 108 M57 38 L64 108"/>',
    scarf:
      '<path d="M50 20 L86 56 L50 92 L14 56 Z"/><path d="M50 92 L44 116 M50 92 L57 113"/><path d="M32 56 L50 38 L68 56"/>',
    belt: '<rect x="8" y="56" width="84" height="16" rx="2"/><rect x="28" y="51" width="20" height="26" rx="2"/><path d="M38 64 L58 64"/><circle cx="70" cy="64" r="1.6"/><circle cx="78" cy="64" r="1.6"/>',
    earring:
      '<circle cx="36" cy="42" r="4"/><path d="M36 46 L36 58"/><circle cx="36" cy="70" r="11"/><circle cx="64" cy="42" r="4"/><path d="M64 46 L64 58"/><circle cx="64" cy="70" r="11"/>',
    hat: '<ellipse cx="50" cy="80" rx="42" ry="11"/><path d="M29 78 Q29 44 50 44 Q71 44 71 78"/><path d="M30 68 Q50 75 70 68"/>',
  };
  const SHAPE_WORDS = [
    ["chân váy", "skirt"],
    ["khăn", "scarf"],
    ["thắt lưng", "belt"],
    ["bông tai", "earring"],
    ["mũ", "hat"],
  ];
  const shapeOf = (p) =>
    (SHAPE_WORDS.find(([w]) => p.name.toLowerCase().includes(w)) || [
      0,
      p.cat,
    ])[1];

  function swatchHTML(p, colorKey, extraClass) {
    if (p.imageUrl) {
      return `<div class="swatch photo ${extraClass || ""}"><img src="${escapeHTML(p.imageUrl)}" alt="${escapeHTML(p.name)}" loading="lazy"></div>`;
    }
    const hex = (COLORS[colorKey || p.colors[0]] || { hex: "#9c7b56" }).hex;
    const stroke = isLight(hex)
      ? "rgba(28,26,23,.45)"
      : "rgba(255,255,255,.55)";
    return `<div class="swatch tone ${extraClass || ""}" style="--tone:${hex}">
      <svg class="silhouette" viewBox="0 0 100 130" aria-hidden="true" fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round">${SILHOUETTES[shapeOf(p)] || SILHOUETTES.ao}</svg>
    </div>`;
  }

  // Thay một ô màu trang trí (.swatch) bằng ảnh thật của sản phẩm
  function fillPhoto(el, p) {
    if (!el || !p || !p.imageUrl) return;
    el.classList.add("photo");
    el.innerHTML = `<img src="${escapeHTML(p.imageUrl)}" alt="${escapeHTML(p.name)}" loading="lazy">`;
  }
  const withPhoto = (list) => list.filter((p) => p && p.imageUrl);

  function stars(rating, count) {
    if (!rating) return "";
    const full = Math.round(rating);
    return `<span class="stars" aria-label="${rating} trên 5 sao"><span aria-hidden="true">${"★".repeat(full)}${"☆".repeat(5 - full)}</span>${count !== undefined ? ` <small>(${count})</small>` : ""}</span>`;
  }

  // Tên trạng thái đơn hàng — dùng chung cho trang Tài khoản và Quản trị
  const ORDER_STATUS = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    shipping: "Đang giao",
    completed: "Hoàn tất",
    cancelled: "Đã hủy",
    returned: "Trả hàng",
  };
  const PAY_STATUS = {
    unpaid: "Chưa thanh toán",
    paid: "Đã thanh toán",
    refunded: "Đã hoàn tiền",
  };
  const statusPill = (s) =>
    `<span class="pill st-${s}">${ORDER_STATUS[s] || s}</span>`;

  const HEART =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';

  function productCard(p) {
    const off = discountPercent(p);
    const badge = off
      ? `<span class="badge badge-sale">-${off}%</span>`
      : p.badge
        ? `<span class="badge">${escapeHTML(p.badge)}</span>`
        : "";
    // Chấm màu có ảnh riêng: rê chuột vào thì ảnh thẻ đổi sang màu đó
    const dots = p.colors
      .map((c) => {
        const img = (p.images || []).find((i) => i.color === c);
        return `<span class="dot${img ? " has-img" : ""}" style="background:${(COLORS[c] || {}).hex}" title="${escapeHTML(colorName(c))}"${img ? ` data-img="${escapeHTML(img.url)}"` : ""}></span>`;
      })
      .join("");
    const soldOut = Object.values(p.stock || {}).every((n) => n === 0);
    return `<article class="product-card">
      <div class="pc-media">
        <a href="chitiet.html?id=${p.id}" aria-label="${escapeHTML(p.name)}">${swatchHTML(p)}</a>
        ${soldOut ? '<span class="badge badge-out">Hết hàng</span>' : badge}
        <button type="button" class="wish-btn" data-wish="${p.id}" aria-pressed="${isWished(p.id)}" aria-label="Yêu thích ${escapeHTML(p.name)}">${HEART}</button>
        <button type="button" class="quick-btn" data-quick="${p.id}">Xem nhanh</button>
      </div>
      <span class="pc-cat">${escapeHTML(categoryName(p.cat))}</span>
      <h3><a href="chitiet.html?id=${p.id}">${escapeHTML(p.name)}</a></h3>
      ${stars(p.rating, p.reviewCount)}
      <div class="product-meta">
        <span>${p.oldPrice ? `<span class="price-old">${money(p.oldPrice)}</span>` : ""}<span class="price">${money(p.price)}</span></span>
        <span class="dots">${dots}</span>
      </div>
    </article>`;
  }

  // Khung chờ trong lúc tải dữ liệu
  const skeletonCards = (n) =>
    Array.from(
      { length: n },
      () =>
        '<div class="product-card skeleton" aria-hidden="true"><div class="sk-media"></div><div class="sk-line short"></div><div class="sk-line"></div><div class="sk-line short"></div></div>',
    ).join("");

  /* ---------- Giỏ hàng ---------- */
  const KEY_CART = "lua_cart",
    KEY_COUPON = "lua_coupon2";
  const lineKey = (id, size, color) => `${id}|${size}|${color}`;
  const getCart = () => store.get(KEY_CART, []);
  function saveCart(cart) {
    store.set(KEY_CART, cart);
    updateBadges();
  }

  function addToCart(id, size, color, qty) {
    const cart = getCart();
    const key = lineKey(id, size, color);
    const line = cart.find((l) => l.key === key);
    if (line) line.qty = Math.min(line.qty + qty, 10);
    else
      cart.push({ key, id: Number(id), size, color, qty: Math.min(qty, 10) });
    saveCart(cart);
  }

  function setQty(key, qty) {
    let cart = getCart();
    if (qty <= 0) cart = cart.filter((l) => l.key !== key);
    else
      cart.forEach((l) => {
        if (l.key === key) l.qty = Math.min(qty, 10);
      });
    saveCart(cart);
  }
  const removeLine = (key) => saveCart(getCart().filter((l) => l.key !== key));
  function clearCart() {
    saveCart([]);
    store.remove(KEY_COUPON);
  }

  // Ghép giỏ với dữ liệu sản phẩm mới nhất; bỏ dòng sản phẩm đã ngừng bán
  const cartLines = () =>
    getCart()
      .map((l) => ({ ...l, product: getProduct(l.id) }))
      .filter((l) => l.product)
      .map((l) => ({
        ...l,
        lineTotal: l.product.price * l.qty,
        stock: stockOf(l.product, l.size, l.color),
      }));
  const cartCount = () => getCart().reduce((s, l) => s + l.qty, 0);

  /* ---------- Mã giảm giá (kiểm tra với server, lưu điều kiện để tính trước) ---------- */
  const getCoupon = () => store.get(KEY_COUPON, null);
  async function applyCoupon(code) {
    const c = await api(`/api/coupons/${encodeURIComponent(code.trim())}`);
    store.set(KEY_COUPON, c);
    return c;
  }
  const removeCoupon = () => store.remove(KEY_COUPON);

  /* Tạm tính ở trình duyệt để hiển thị; số tiền cuối cùng do server tính lại khi đặt hàng.
     region: mã khu vực hoặc null (chưa chọn) */
  function totals(region) {
    const lines = cartLines();
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    let discount = 0,
      freeship = false,
      couponError = null;
    const c = getCoupon();
    if (c) {
      if (subtotal < c.minOrder)
        couponError = `Mã ${c.code} áp dụng cho đơn từ ${money(c.minOrder)}.`;
      else if (c.type === "percent")
        discount = Math.round((subtotal * c.value) / 100 / 1000) * 1000;
      else if (c.type === "fixed") discount = Math.min(c.value, subtotal);
      else if (c.type === "freeship") freeship = true;
    }
    let shipping = null;
    const r = region && SHIPPING_REGIONS[region];
    if (r)
      shipping =
        freeship || (r.freeFrom !== null && subtotal >= r.freeFrom) || !subtotal
          ? 0
          : r.fee;
    return {
      lines,
      subtotal,
      discount,
      shipping,
      freeship,
      total: subtotal - discount + (shipping || 0),
      coupon: c,
      couponError,
    };
  }

  /* ---------- Kho voucher (giỏ hàng + thanh toán) ----------
     Khối thu gọn được (<details>), nhớ trạng thái mở/đóng. Giao diện ở file voucher.css.
     root: thẻ <details class="vbox">, onChange: hàm vẽ lại tổng tiền của trang */
  const VB_ICON = {
    ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v2m0 3v2m0 3v2"/></svg>',
    freeship: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 6h11v9H2zM13 9h4l3 3v3h-7z"/><circle cx="6" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/></svg>',
    percent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="m8 15 6-6"/><circle cx="8.5" cy="9.5" r=".8"/><circle cx="13.5" cy="14.5" r=".8"/></svg>',
    fixed: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8m0 8v1.5"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  };
  const vbValue = (v) => (v.type === 'percent' ? `${v.value}%` : v.type === 'fixed' ? (v.value >= 1000 ? `${Math.round(v.value / 1000)}K` : money(v.value)) : 'FREE');
  const vbTitle = (v) => (v.type === 'percent' ? `Giảm ${v.value}%` : v.type === 'fixed' ? `Giảm ${money(v.value)}` : 'Miễn phí vận chuyển');
  const vbDate = (d) => d.slice(0, 10).split('-').reverse().join('/');

  function voucherBox(root, onChange) {
    let list = [], last = null, loaded = false;
    root.classList.add('vbox');
    root.open = store.get('lua_vbox_open', true);
    root.innerHTML = `
      <summary class="vbox-head">
        <span class="vbox-ico">${VB_ICON.ticket}</span>
        <span class="vbox-titles"><b>Kho voucher</b><small class="vbox-sub">Đang tải ưu đãi…</small></span>
        <span class="vbox-applied" hidden></span>
        <span class="vbox-chev">${VB_ICON.chevron}</span>
      </summary>
      <div class="vbox-body">
        <form class="vbox-form" novalidate>
          <span class="vbox-form-ico">${VB_ICON.tag}</span>
          <input type="text" placeholder="Nhập mã voucher" aria-label="Nhập mã voucher" autocomplete="off" spellcheck="false" maxlength="30">
          <button type="submit">Áp dụng</button>
        </form>
        <p class="vbox-msg" role="status" aria-live="polite"></p>
        <div class="vbox-list" role="radiogroup" aria-label="Chọn voucher"></div>
      </div>`;
    const msg = $('.vbox-msg', root), input = $('input', root);
    const say = (type, text) => { msg.dataset.type = type || ''; msg.innerHTML = text ? `${type === 'ok' ? VB_ICON.check : ''}<span>${escapeHTML(text)}</span>` : ''; };

    async function use(code) {
      root.classList.add('is-busy');
      try {
        const c = await applyCoupon(code);
        input.value = '';
        say('ok', `Đã áp dụng mã ${c.code}`);
      } catch (e) {
        say('err', e.message);
      }
      root.classList.remove('is-busy');
      onChange();
    }

    function card(v, t, i) {
      const lack = Math.max(0, v.minOrder - t.subtotal);
      const on = !!(t.coupon && t.coupon.code === v.code);
      const pct = v.minOrder ? Math.min(100, Math.round((t.subtotal / v.minOrder) * 100)) : 100;
      const meta = [
        v.minOrder ? `Đơn tối thiểu ${money(v.minOrder)}` : 'Áp dụng mọi đơn',
        v.endsAt ? `HSD ${vbDate(v.endsAt)}` : '',
        v.remaining !== null && v.remaining !== undefined ? `Còn ${v.remaining} lượt` : '',
      ].filter(Boolean).join(' · ');
      return `<button type="button" class="vc vc-${v.type}${lack ? ' is-locked' : ''}" role="radio" aria-checked="${on}" data-voucher="${escapeHTML(v.code)}"
                ${lack && !on ? 'aria-disabled="true"' : ''} style="--d:${i * 40}ms">
        <span class="vc-ticket">
          <span class="vc-stub">
            <span class="vc-stub-ico">${VB_ICON[v.type] || VB_ICON.tag}</span>
            <span class="vc-stub-val">${escapeHTML(vbValue(v))}</span>
            <span class="vc-stub-lbl">${v.type === 'freeship' ? 'SHIP' : 'GIẢM'}</span>
          </span>
          <span class="vc-main">
            <span class="vc-title">${escapeHTML(vbTitle(v))}</span>
            ${v.label && v.label !== vbTitle(v) ? `<span class="vc-desc">${escapeHTML(v.label)}</span>` : ''}
            <span class="vc-meta"><span class="vc-code">${escapeHTML(v.code)}</span>${escapeHTML(meta)}</span>
            ${lack ? `<span class="vc-progress"><span class="vc-bar"><i style="width:${pct}%"></i></span><span>Mua thêm <b>${money(lack)}</b> để dùng</span></span>` : ''}
          </span>
          <span class="vc-radio" aria-hidden="true">${VB_ICON.check}</span>
        </span>
      </button>`;
    }

    function render(t) {
      last = t;
      const code = t.coupon && !t.couponError ? t.coupon.code : null;
      const saved = t.discount || 0;
      const applied = $('.vbox-applied', root);
      applied.hidden = !code;
      applied.innerHTML = code ? `<b>${escapeHTML(code)}</b>${t.discount ? `−${money(t.discount)}` : t.freeship ? 'Freeship' : ''}` : '';
      const usable = list.filter((v) => v.minOrder <= t.subtotal), locked = list.filter((v) => v.minOrder > t.subtotal);
      $('.vbox-sub', root).textContent = !loaded ? 'Đang tải ưu đãi…'
        : code ? `Đang dùng ${code} · ${saved ? `−${money(saved)}` : 'miễn phí ship'}`
        : usable.length ? `${usable.length} voucher dùng được cho đơn này` : list.length ? 'Mua thêm để mở khóa voucher' : 'Chưa có voucher';
      if (t.couponError && msg.dataset.type !== 'err') say('err', t.couponError);
      if (!loaded) { $('.vbox-list', root).innerHTML = '<span class="vc-skel"></span><span class="vc-skel"></span>'; return; }
      $('.vbox-list', root).innerHTML = !list.length
        ? '<p class="vbox-empty">Hiện chưa có voucher nào. Bạn vẫn có thể nhập mã ở ô phía trên.</p>'
        : usable.map((v, i) => card(v, t, i)).join('') +
          (locked.length ? `<p class="vbox-divider"><span>Chưa đủ điều kiện</span></p>${locked.map((v, i) => card(v, t, usable.length + i)).join('')}` : '');
    }

    api('/api/coupons')
      .then((v) => { list = v; })
      .catch(() => { list = []; })
      .finally(() => { loaded = true; if (last) render(last); });
    root.addEventListener('toggle', () => store.set('lua_vbox_open', root.open));
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-voucher]');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      if (b.getAttribute('aria-checked') === 'true') { removeCoupon(); say('', ''); onChange(); }
      else use(b.dataset.voucher);
    });
    $('form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (code) use(code); else { say('err', 'Vui lòng nhập mã voucher.'); input.focus(); }
    });
    return { render };
  }

  /* ---------- Yêu thích & vừa xem ---------- */
  const getWish = () => store.get("lua_wish", []);
  const isWished = (id) => getWish().includes(Number(id));
  function toggleWish(id) {
    id = Number(id);
    const list = getWish();
    const on = !list.includes(id);
    store.set("lua_wish", on ? [id, ...list] : list.filter((x) => x !== id));
    updateBadges();
    return on;
  }
  const getRecent = () => store.get("lua_recent", []);
  const pushRecent = (id) =>
    store.set(
      "lua_recent",
      [Number(id), ...getRecent().filter((x) => x !== Number(id))].slice(0, 8),
    );

  function updateBadges() {
    const set = (sel, n) =>
      $$(sel).forEach((el) => {
        el.textContent = n;
        el.hidden = n === 0;
      });
    set("[data-cart-count]", cartCount());
    set("[data-wish-count]", getWish().length);
  }

  /* ---------- Thông báo ---------- */
  let toastTimer;
  function toast(html) {
    let el = $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
  }

  /* ---------- Xem nhanh (dùng thẻ <dialog> có sẵn của trình duyệt) ---------- */
  let qv = null; // { p, color, size } của sản phẩm đang xem nhanh

  function renderQuickView() {
    const { p, color, size } = qv;
    $("#quickView").innerHTML = `
      <button type="button" class="modal-close" data-close aria-label="Đóng">×</button>
      <div class="qv-grid">
        ${swatchHTML(p, color, "qv-media")}
        <div>
          <span class="pc-cat">${escapeHTML(categoryName(p.cat))}</span>
          <h2>${escapeHTML(p.name)}</h2>
          ${stars(p.rating, p.reviewCount)}
          <p class="qv-price">${p.oldPrice ? `<span class="price-old">${money(p.oldPrice)}</span>` : ""}<span class="price">${money(p.price)}</span></p>
          <div class="option-label">Màu <span class="value">${escapeHTML(colorName(color))}</span></div>
          <div class="color-options">${p.colors.map((c) => `<button type="button" class="color-opt" data-c="${c}" role="radio" aria-checked="${c === color}" aria-label="${escapeHTML(colorName(c))}" style="background:${COLORS[c].hex}"></button>`).join("")}</div>
          <div class="option-label" style="margin-top:16px;">Kích cỡ</div>
          <div class="chips">${p.sizes.map((s) => `<button type="button" class="chip" data-s="${s}" role="radio" aria-checked="${s === size}" ${stockOf(p, s, color) ? "" : "disabled"}>${s}</button>`).join("")}</div>
          <p class="pd-hint" id="qvHint" aria-live="polite"></p>
          <div class="qv-actions">
            <button type="button" class="btn btn-primary" data-add>Thêm vào giỏ</button>
            <a class="btn" href="chitiet.html?id=${p.id}">Xem chi tiết</a>
          </div>
        </div>
      </div>`;
  }

  function quickView(id) {
    const p = getProduct(id);
    if (!p) return;
    let dlg = $("#quickView");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "quickView";
      dlg.className = "modal qv";
      document.body.appendChild(dlg);
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg || e.target.closest("[data-close]"))
          return dlg.close();
        const c = e.target.closest("[data-c]"),
          s = e.target.closest("[data-s]");
        if (c) {
          qv.color = c.dataset.c;
          if (qv.size && !stockOf(qv.p, qv.size, qv.color)) qv.size = null;
          renderQuickView();
        }
        if (s) {
          qv.size = s.dataset.s;
          renderQuickView();
        }
        if (e.target.closest("[data-add]")) {
          if (!qv.size) {
            $("#qvHint").textContent = "Vui lòng chọn kích cỡ.";
            return;
          }
          addToCart(qv.p.id, qv.size, qv.color, 1);
          dlg.close();
          toast(
            `Đã thêm <strong>${escapeHTML(qv.p.name)}</strong> vào giỏ.<a href="giohang.html">Xem giỏ hàng</a>`,
          );
        }
      });
    }
    const color =
      p.colors.find((c) => p.sizes.some((s) => stockOf(p, s, c) > 0)) ||
      p.colors[0];
    qv = {
      p,
      color,
      size:
        p.sizes.length === 1 && stockOf(p, p.sizes[0], color)
          ? p.sizes[0]
          : null,
    };
    renderQuickView();
    dlg.showModal();
  }

  /* Nút yêu thích và xem nhanh trên mọi thẻ sản phẩm */
  document.addEventListener("mouseover", (e) => {
    const d = e.target.closest(".product-card .dot[data-img]");
    const img = d && d.closest(".product-card").querySelector(".pc-media img");
    if (!img) return;
    if (!img.dataset.orig) img.dataset.orig = img.src;
    img.src = d.dataset.img;
  });
  document.addEventListener("mouseout", (e) => {
    const card = e.target.closest(".product-card");
    if (!card || card.contains(e.relatedTarget)) return;
    const img = card.querySelector(".pc-media img[data-orig]");
    if (img) img.src = img.dataset.orig;
  });

  document.addEventListener("click", (e) => {
    const w = e.target.closest("[data-wish]");
    if (w) {
      const on = toggleWish(w.dataset.wish);
      $$(`[data-wish="${w.dataset.wish}"]`).forEach((b) =>
        b.setAttribute("aria-pressed", on),
      );
      toast(
        on
          ? 'Đã thêm vào danh sách yêu thích.<a href="yeuthich.html">Xem</a>'
          : "Đã bỏ khỏi danh sách yêu thích.",
      );
    }
    const q = e.target.closest("[data-quick]");
    if (q) ready.then(() => quickView(q.dataset.quick));
  });
  /* Tự động thêm nút hiện/ẩn cho mọi ô mật khẩu */
  function addPasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.dataset.pwToggle || !input.id) return; // tránh gắn 2 lần
      input.dataset.pwToggle = "1";

      // Bọc input trong div.password-wrap
      const wrap = document.createElement("div");
      wrap.className = "password-wrap";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      // Tạo nút con mắt
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toggle-password";
      btn.setAttribute("aria-label", "Hiện mật khẩu");
      btn.innerHTML = `
        <svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="display:none">
          <path d="M3 3l18 18M10.5 10.7a3 3 0 0 0 4.2 4.2"/>
          <path d="M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.6 6.6C3.8 8.2 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4.2-.9"/>
        </svg>`;
      wrap.appendChild(btn);

      // Xử lý sự kiện click
      btn.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
        btn.querySelector(".eye-open").style.display = show ? "none" : "";
        btn.querySelector(".eye-closed").style.display = show ? "" : "none";
        input.focus();
      });
    });
  }

  // Chạy khi trang load xong
  document.addEventListener("DOMContentLoaded", addPasswordToggles);
  // Chạy lại nếu có form mới xuất hiện (ví dụ form đổi mật khẩu ở trang Tài khoản)
  new MutationObserver(addPasswordToggles).observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("storage", (e) => {
    if (["lua_cart", "lua_wish"].includes(e.key)) updateBadges();
  });

  return {
    store,
    api,
    ready,
    me,
    money,
    $,
    $$,
    escapeHTML,
    param,
    norm,
    getProduct,
    categoryName,
    colorName,
    discountPercent,
    stockOf,
    swatchHTML,
    fillPhoto,
    withPhoto,
    stars,
    productCard,
    skeletonCards,
    HEART,
    getCart,
    addToCart,
    setQty,
    removeLine,
    clearCart,
    cartLines,
    cartCount,
    updateBadges,
    getCoupon,
    applyCoupon,
    removeCoupon,
    totals,
    voucherBox,
    getWish,
    isWished,
    toggleWish,
    getRecent,
    pushRecent,
    toast,
    quickView,
    ORDER_STATUS,
    PAY_STATUS,
    statusPill,
  };
})();