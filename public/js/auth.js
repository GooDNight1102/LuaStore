/* Trang Đăng nhập / Đăng ký */
(function () {
  const { $, $$ } = LUA;
  const next = LUA.param('next');
  // Chỉ cho quay về trang trong website (chặn chuyển hướng sang trang lạ)
  const safeNext = next && /^[a-z0-9_\-]+\.html([?#].*)?$/i.test(next) ? next : null;
  const home = (u) => safeNext || (u.role === 'customer' ? 'taikhoan.html' : 'admin.html');

  LUA.me().then((u) => {
    if (!u) return;
    // Khách hàng bị đẩy về đây từ trang quản trị: báo không đủ quyền thay vì chuyển trang (tránh vòng lặp)
    if (u.role === 'customer' && safeNext && safeNext.startsWith('admin.html')) {
      const note = $('#loginForm .form-note');
      note.innerHTML = `Bạn đang đăng nhập bằng tài khoản khách hàng <strong>${LUA.escapeHTML(u.email)}</strong>, không có quyền vào trang quản trị. Hãy đăng nhập bằng tài khoản nhân viên hoặc quản trị. <a href="taikhoan.html">Về tài khoản của tôi</a>`;
      note.hidden = false;
      return;
    }
    location.replace(home(u));
  });

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Chuyển tab: vạch chỉ báo trượt sang, form mới trượt vào
  function show(tab) {
    $$('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === tab));
    const tabs = $('.lx-tabs');
    if (tabs) tabs.style.setProperty('--i', tab === 'login' ? 0 : 1);
    ['login', 'register'].forEach((name) => {
      const f = $(`#${name}Form`);
      const on = name === tab;
      if (on && f.hidden) { f.classList.remove('enter'); void f.offsetWidth; f.classList.add('enter'); }
      f.hidden = !on;
    });
  }
  $$('[role="tab"]').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  if (location.hash === '#dang-ky') show('register');

  // Card rung nhẹ khi lỗi
  function shake() {
    const card = $('#lxCard');
    if (!card || reduce) return;
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }

  async function submit(form, url, body) {
    const err = form.querySelector('.form-note');
    const btn = form.querySelector('button[type="submit"]');
    err.hidden = true;
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const { user } = await LUA.api(url, { method: 'POST', body });
      btn.classList.replace('loading', 'done');                 // dấu ✓ rồi mới chuyển trang
      setTimeout(() => { location.href = home(user); }, reduce ? 0 : 550);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
      btn.classList.remove('loading');
      shake();
    }
  }

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    submit(f, '/api/auth/login', { email: f.email.value, password: f.password.value });
  });

  $('#registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const err = f.querySelector('.form-note');
    if (f.password.value !== f.confirm.value) {
      err.textContent = 'Mật khẩu nhập lại không khớp.';
      err.hidden = false;
      f.confirm.focus();
      shake();
      return;
    }
    submit(f, '/api/auth/register', { fullName: f.fullName.value, email: f.email.value, phone: f.phone.value, password: f.password.value });
  });

  // Bấm tài khoản mẫu để điền nhanh (xóa khối này khi đưa web lên mạng thật)
  $$('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    const [email, pw] = b.dataset.demo.split('|');
    show('login');
    $('#loginEmail').value = email;
    $('#loginPassword').value = pw;
    $('#loginForm button[type="submit"]').focus();
  }));

  /* ---------- Hiệu ứng giao diện ---------- */
  // Thanh độ mạnh mật khẩu (đăng ký)
  const meter = $('.lx-meter');
  if (meter) $('#regPassword').addEventListener('input', (e) => {
    const v = e.target.value;
    const score = [v.length >= 8, /\d/.test(v) && /[a-z]/i.test(v), /[A-Z]/.test(v) && /[a-z]/.test(v), /[^a-z0-9]/i.test(v) || v.length >= 12]
      .filter(Boolean).length;
    meter.dataset.score = v ? score : '';
  });

  // Chữ đổi luân phiên ở tiêu đề
  const rot = $('#lxRotate');
  const words = ['mua sắm nhanh hơn', 'theo dõi đơn hàng', 'lưu món yêu thích', 'nhận ưu đãi riêng'];
  if (rot && !reduce) {
    let i = 0;
    setInterval(() => {
      rot.classList.add('out');
      setTimeout(() => { i = (i + 1) % words.length; rot.textContent = words[i]; rot.classList.remove('out'); }, 350);
    }, 2800);
  }

  // Chồng ảnh sản phẩm thật từ CSDL (chưa có ảnh thì dùng ô màu vải), nghiêng theo chuột
  const stack = $('#lxStack');
  if (stack) LUA.ready.then(() => {
    const pick = (LUA.withPhoto(PRODUCTS).length >= 3 ? LUA.withPhoto(PRODUCTS) : PRODUCTS)
      .slice().sort((a, b) => b.sold - a.sold).slice(0, 3);
    stack.innerHTML = pick.map((p, n) => `<figure class="lx-shot s${n}">${LUA.swatchHTML(p)}<figcaption>${LUA.escapeHTML(p.name)}</figcaption></figure>`).join('');
    // Ảnh lỗi (link hỏng / mất mạng) thì thay bằng ô màu vải
    stack.querySelectorAll('.lx-shot').forEach((fig, n) => {
      const img = fig.querySelector('img');
      if (img) img.addEventListener('error', () => { fig.querySelector('.swatch').outerHTML = LUA.swatchHTML({ ...pick[n], imageUrl: null }); }, { once: true });
    });
  });
  const intro = $('.lx-intro');
  if (intro && !reduce && matchMedia('(hover: hover)').matches) {
    intro.addEventListener('pointermove', (e) => {
      const r = intro.getBoundingClientRect();
      intro.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      intro.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    intro.addEventListener('pointerleave', () => { intro.style.setProperty('--mx', 0); intro.style.setProperty('--my', 0); });
  }
})();