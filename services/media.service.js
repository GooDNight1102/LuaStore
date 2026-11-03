// MEDIA SERVICE — tải ảnh sản phẩm lên.
//   - Có SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: lưu vào Supabase Storage (bucket "products", ảnh công khai).
//     Bắt buộc khi chạy trên Vercel vì ổ đĩa ở đó chỉ đọc.
//   - Chưa có: lưu vào thư mục public/uploads trên máy (chạy thử ở máy cá nhân).
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { bad } = require('../shared/http');
const { ADMIN_ONLY } = require('../shared/auth');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const BUCKET = process.env.SUPABASE_BUCKET || 'products';
// Loại ảnh được nhận: đuôi file + "chữ ký" byte đầu file (chặn file giả mạo đổi đuôi)
const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png':  { ext: 'png', ok: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  'image/webp': { ext: 'webp', ok: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif':  { ext: 'gif', ok: (b) => b.subarray(0, 3).toString() === 'GIF' }
};

/* ---------- Interface: lưu 1 ảnh, trả về đường dẫn ---------- */
async function saveImage(buf, type) {
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_TYPES[type].ext}`;
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (base && key) {
    const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${name}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': type }, body: buf
    });
    if (!r.ok) throw new Error(`Supabase Storage: ${r.status} ${await r.text()}`);
    return `${base}/storage/v1/object/public/${BUCKET}/${name}`;
  }
  if (process.env.VERCEL) throw new Error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — Vercel không cho lưu file lên ổ đĩa.');
  // ponytail: ảnh cũ không tự xóa khi đổi ảnh khác — dọn thư mục public/uploads (hoặc bucket) bằng tay nếu cần.
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

const admin = express.Router();

// Trình duyệt gửi thẳng file ảnh, không cần thư viện multer
admin.post('/uploads', ADMIN_ONLY, express.raw({ type: 'image/*', limit: '4mb' }), async (req, res) => {
  const type = (req.headers['content-type'] || '').split(';')[0];
  const t = IMAGE_TYPES[type], buf = req.body;
  if (!t || !Buffer.isBuffer(buf) || buf.length < 12 || !t.ok(buf)) return bad(res, 'Chỉ nhận file ảnh JPG, PNG, WEBP hoặc GIF.');
  res.status(201).json({ url: await saveImage(buf, type) });
});

module.exports = {
  name: 'media', version: '1.0', description: 'Tải ảnh sản phẩm lên Supabase Storage',
  admin, saveImage
};
