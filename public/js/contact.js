/* Trang Liên hệ: kiểm tra form rồi lưu vào bảng contact_messages */
(function () {
  const { $ } = LUA;
  const form = $('#contactForm');

  const rules = {
    name: (v) => v.trim().length < 2 ? 'Vui lòng nhập họ và tên.' : '',
    phone: (v) => /^(0|\+84)(3|5|7|8|9)\d{8}$/.test(v.replace(/[\s.\-]/g, '')) ? '' : 'Số điện thoại không hợp lệ (ví dụ: 0901234567).',
    email: (v) => v.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? 'Email không hợp lệ.' : '',
    message: (v) => v.trim().length < 10 ? 'Nội dung cần ít nhất 10 ký tự.' : ''
  };

  function check(name) {
    const el = form.elements[name];
    const msg = rules[name](el.value);
    $(`#err-${name}`).textContent = msg;
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  }

  Object.keys(rules).forEach((n) => {
    const el = form.elements[n];
    el.addEventListener('blur', () => check(n));
    // Xóa lỗi ngay khi gõ đúng, tránh nút "Gửi" bị dịch chuyển lúc người dùng bấm
    el.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') check(n); });
  });

  // Điền sẵn khi đã đăng nhập
  LUA.me().then((u) => {
    if (!u) return;
    form.elements.name.value = u.fullName;
    form.elements.phone.value = u.phone || '';
    form.elements.email.value = u.email;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!Object.keys(rules).map(check).every(Boolean)) { form.querySelector('[aria-invalid="true"]').focus(); return; }
    const note = $('#contactOk');
    const name = form.elements.name.value.trim();
    try {
      await LUA.api('/api/contact', {
        method: 'POST',
        body: { name, phone: form.elements.phone.value, email: form.elements.email.value, message: form.elements.message.value }
      });
      note.className = 'form-note ok';
      note.textContent = `Cảm ơn ${name}! LỤA đã nhận lời nhắn và sẽ phản hồi trong vòng 1 ngày làm việc.`;
      form.reset();
    } catch (err) {
      note.className = 'form-note err';
      note.textContent = err.message;
    }
    note.hidden = false;
    note.scrollIntoView({ block: 'center' });
  });
})();
