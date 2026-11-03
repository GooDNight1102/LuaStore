/* Trang Quên mật khẩu: bước 1 gửi mã về email, bước 2 nhập mã + mật khẩu mới */
(function () {
  const { $ } = LUA;
  const say = (form, msg, ok) => {
    const n = form.querySelector('.form-note');
    n.textContent = msg;
    n.className = `form-note ${ok ? 'ok' : 'err'}`;
    n.hidden = !msg;
  };
  let email = '';

  async function sendCode(form) {
    email = $('#fpEmail').value.trim();
    await LUA.api('/api/auth/forgot', { method: 'POST', body: { email } });
    $('#forgotForm').hidden = true;
    $('#resetForm').hidden = false;
    $('#sentTo').textContent = `Nếu ${email} đã đăng ký, mã sẽ được gửi tới email này trong ít phút (nhớ xem cả thư mục Spam).`;
    $('#fpCode').focus();
  }

  $('#forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');
    btn.disabled = true;
    try { await sendCode(f); } catch (err) { say(f, err.message); } finally { btn.disabled = false; }
  });

  $('#resend').addEventListener('click', async () => {
    const f = $('#resetForm');
    try { await sendCode(f); say(f, 'Đã gửi lại mã mới.', true); } catch (err) { say(f, err.message); }
  });

  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await LUA.api('/api/auth/reset', { method: 'POST', body: { email, code: f.code.value.trim(), password: f.password.value } });
      f.innerHTML = '<p class="form-note ok">Đã đặt lại mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.</p><a class="btn btn-primary btn-block" href="dangnhap.html">Đăng nhập</a>';
    } catch (err) { say(f, err.message); }
  });
})();