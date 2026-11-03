// NOTIFICATION SERVICE — gửi email (xác nhận đơn, mã quên mật khẩu) qua SMTP.
// Service nội bộ: không có API công khai, các service khác gọi qua hàm orderConfirmation() / passwordReset().
// Chưa cấu hình SMTP_*: in nội dung email ra cửa sổ chạy server (hoặc log của Vercel) để vẫn demo được.
const nodemailer = require('nodemailer');
const { money, esc } = require('../shared/http');

const transport = process.env.SMTP_HOST && process.env.SMTP_USER ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

async function sendMail(to, subject, html) {
  if (!to) return;
  if (!transport) {
    console.log(`✉  [Chưa cấu hình SMTP — email không được gửi thật]\n   Đến: ${to}\n   Tiêu đề: ${subject}\n   ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)}`);
    return;
  }
  try {
    await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html });
  } catch (e) {
    console.error(`✘ Gửi email tới ${to} thất bại: ${e.message}`);   // lỗi email không làm hỏng đơn hàng
  }
}

function orderConfirmation({ code, f, lines, subtotal, discount, shipping, total, region }) {
  const row = (a, b) => `<tr><td style="padding:6px 0">${a}</td><td style="padding:6px 0;text-align:right">${b}</td></tr>`;
  return sendMail(f.email, `Xác nhận đơn hàng ${code} — LỤA`, `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1c1a17">
    <h2 style="color:#6b2737">Cảm ơn ${esc(f.fullName)} đã đặt hàng tại LỤA!</h2>
    <p>Mã đơn: <b>${code}</b> · Thanh toán: ${f.payment === 'bank' ? 'Chuyển khoản' : 'Khi nhận hàng (COD)'}</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #c9bfa9">
      ${lines.map((l) => row(`${esc(l.name)} (${esc(l.size)}, ${esc(l.color_name)}) × ${l.qty}`, money(l.price * l.qty))).join('')}
      ${row('Tạm tính', money(subtotal))}${discount ? row('Giảm giá', '−' + money(discount)) : ''}${row(`Phí giao hàng (${esc(region)})`, money(shipping))}
      ${row('<b>Tổng cộng</b>', `<b>${money(total)}</b>`)}
    </table>
    <p>Giao đến: ${esc(f.address)} — ${esc(f.phone)}</p>
    <p>Nhân viên sẽ gọi xác nhận đơn trong vòng 24 giờ. Bạn có thể theo dõi đơn trong trang Tài khoản.</p>
  </div>`);
}

function passwordReset(email, fullName, code) {
  return sendMail(email, 'Mã đặt lại mật khẩu LỤA', `<div style="font-family:Arial,sans-serif">
    <p>Xin chào ${esc(fullName)},</p><p>Mã đặt lại mật khẩu của bạn là:</p>
    <p style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#6b2737">${code}</p>
    <p>Mã có hiệu lực trong 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p></div>`);
}

module.exports = {
  name: 'notification', version: '1.0', description: 'Gửi email thông báo (nội bộ, không có API công khai)',
  sendMail, orderConfirmation, passwordReset
};
