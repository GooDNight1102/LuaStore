# LỤA — Website bán thời trang nữ

Giao diện: **HTML, CSS, JavaScript** · Máy chủ: **Node.js + Express** · Cơ sở dữ liệu: **PostgreSQL trên Supabase** · Triển khai: **Vercel** · Kiến trúc: **SOA (hướng dịch vụ)**

---

## 1. Kiến trúc hướng dịch vụ (SOA)

```
                         Trình duyệt (public/*.html, js/*.js)
                                        │  HTTP/JSON
                                        ▼
┌──────────────────────────── API GATEWAY (app.js) ────────────────────────────┐
│  helmet (CSP) · đọc JSON · phiên đăng nhập · chặn /api/admin/* cho nhân viên  │
│  GET /api/services (danh bạ service) · GET /api/health                        │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────┘
       ▼          ▼          ▼          ▼          ▼          ▼          ▼
   Identity   Catalog     Order     Payment    Support     Media    Reporting
                 │          │  ╲        ▲                   │
                 │          │   ╲───────┘ claimEarlyTransfer│
                 │          ▼                               ▼
                 │     Notification (email)          Supabase Storage
                 ▼
        PostgreSQL (Supabase) ◄── mọi service dùng chung qua shared/db.js
                 ▲
           SePay webhook ──► Payment
```

| Service | File | Phụ trách | API công khai | API quản trị (`/api/admin`) |
|---|---|---|---|---|
| Identity | `services/identity.service.js` | Đăng ký, đăng nhập, quên mật khẩu, hồ sơ | `/api/auth/*`, `/api/me` | `users` |
| Catalog | `services/catalog.service.js` | Sản phẩm, biến thể, tồn kho, đánh giá | `/api/catalog`, `/api/products` | `products`, `variants`, `reviews` |
| Order | `services/order.service.js` | Mã giảm giá, đặt hàng, đơn của khách | `/api/coupons`, `/api/orders`, `/api/me/orders` | `orders`, `coupons` |
| Payment | `services/payment.service.js` | VietQR, webhook SePay, ghép tiền với đơn | `/api/webhooks/sepay`, `/api/orders/:code/payment` | `bank-transactions`, `bank-simulate` |
| Support | `services/support.service.js` | Liên hệ, đăng ký nhận tin | `/api/contact`, `/api/newsletter` | `messages`, `newsletter` |
| Media | `services/media.service.js` | Tải ảnh lên Supabase Storage | — | `uploads` |
| Reporting | `services/reporting.service.js` | Tổng quan, doanh thu, nhật ký | — | `stats`, `logs` |
| Notification | `services/notification.service.js` | Gửi email (service nội bộ) | — | — |

**Các nguyên tắc SOA được áp dụng**

- **Mỗi service một nghiệp vụ, đóng gói riêng:** route, kiểm tra dữ liệu và câu SQL của nghiệp vụ nào nằm trong file service đó.
- **Hợp đồng dịch vụ (service contract):** mỗi service khai báo `name`, `version`, `description` và các endpoint REST. Vào `/api/services` để xem danh bạ đầy đủ, được sinh tự động từ code.
- **Giao tiếp qua interface, không gọi chéo lung tung:**
  - Order gọi `payment.claimEarlyTransfer()` và `notification.orderConfirmation()`.
  - Admin của Payment gọi `receiveTransfer()`.
  - Gateway gọi `catalog.productSeo()`.
- **API Gateway một cửa:** mọi yêu cầu đi qua `app.js`. Bảo mật, phiên và phân quyền quản trị được xử lý tập trung một lần.
- **Service registry:** `services/index.js` là nơi đăng ký service. Thêm service mới chỉ cần tạo file `*.service.js` rồi thêm 1 dòng vào đây.
- **Hạ tầng dùng chung (`shared/`):** kết nối CSDL, bảo mật và tiện ích HTTP.

> Trước đây dự án là một khối (*monolith*): toàn bộ API nằm trong `server.js` và `admin-api.js`, route và SQL trộn chung, phần quản trị nhận hàm của phần bán hàng qua tham số. Bản này đã tách thành 8 service như trên. Đường dẫn API giữ nguyên nên giao diện không phải sửa gì.

---

## 2. Cấu trúc dự án

```
lua/
├── app.js                API Gateway: middleware chung + gắn các service + trả trang HTML
├── server.js             Chạy ở máy: npm start / npm run dev
├── api/index.js          Điểm vào trên Vercel (xuất app thành hàm serverless)
├── vercel.json           Cấu hình Vercel (định tuyến, vùng máy chủ Singapore)
├── services/             Các service nghiệp vụ (xem bảng ở mục 1) + index.js (registry)
├── shared/
│   ├── db.js             Kết nối PostgreSQL (Supabase)
│   ├── auth.js           Băm mật khẩu, phiên đăng nhập trong CSDL, phân quyền, nhật ký thao tác
│   └── http.js           Trả lỗi, làm sạch dữ liệu nhập, giới hạn số lần gọi
├── supabase/schema.sql   Tạo bảng, trigger, view, bảo mật RLS, kho ảnh, dữ liệu mẫu
├── scripts/setup.js      npm run setup: đẩy schema.sql lên Supabase
├── test/api.test.js      Kiểm thử tự động (npm test)
├── .env.example          Mẫu cấu hình → sao chép thành .env
└── public/               Giao diện (HTML, CSS, JS) — không thay đổi
```

---

## 3. Tạo cơ sở dữ liệu trên Supabase

1. Vào **supabase.com**, đăng nhập rồi bấm **New project**.
   - Đặt tên, ví dụ `lua`.
   - **Database Password:** đặt mật khẩu và ghi lại.
   - **Region:** chọn **Southeast Asia (Singapore)**, cùng vùng với Vercel ở `vercel.json`, để web chạy nhanh.
2. Lấy thông tin kết nối:
   - **`DATABASE_URL`:** bấm nút **Connect** ở trên cùng, mục *Connection String* chọn Method **Session pooler** (cổng **5432**, tên người dùng dạng `postgres.<mã-project>`). Copy chuỗi kết nối rồi thay `[YOUR-PASSWORD]` bằng mật khẩu ở bước 1.
   - **`SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`:** vào **Project Settings → API**, lấy *Project URL* và khóa *service_role*. Khóa này chỉ để ở server, tuyệt đối không dán vào file trong `public/`.
3. Tạo bảng và dữ liệu mẫu bằng lệnh `npm run setup` (xem mục 4). Cách khác là dán `supabase/schema.sql` vào **SQL Editor** rồi bấm **Run**.
4. Kiểm tra: vào **Table Editor → products**, phải thấy 20 sản phẩm.

> Vì sao dùng **Session pooler**: kết nối trực tiếp (`db.<mã-project>.supabase.co`) chỉ có IPv6, nhiều mạng gia đình và Vercel không vào được. Session pooler chạy được trên IPv4 và giữ nguyên tính năng của PostgreSQL.

## 4. Chạy ở máy cá nhân (VS Code)

1. Cài **Node.js 20 LTS trở lên**, rồi mở thư mục `lua` bằng VS Code.
2. Mở terminal và cài thư viện:
   ```bash
   npm install
   ```
3. Sao chép `.env.example` thành **`.env`**, rồi điền `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`.
4. Đẩy cơ sở dữ liệu lên Supabase (chỉ cần làm 1 lần):
   ```bash
   npm run setup
   ```
   Thành công sẽ thấy:
   ```
   🔌 Đã kết nối: postgresql://postgres.xxxx:****@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ⏳ Đang tạo bảng, trigger, view và dữ liệu mẫu…
   ✔ Xong: 18 bảng, 20 sản phẩm, 4 tài khoản mẫu. Chạy web: npm run dev
   ```
   - Chạy lại khi CSDL đã có dữ liệu thì lệnh sẽ dừng để tránh mất dữ liệu.
   - Muốn **xóa hết và tạo lại** dữ liệu mẫu: `npm run setup -- --reset`.
5. Chạy website:
   ```bash
   npm run dev
   ```
   Kết nối thành công sẽ thấy:
   ```
   🧩 8 service: identity, catalog, order, payment, support, media, reporting, notification
   ✔ Đã kết nối Supabase (20 sản phẩm). Mở trình duyệt: http://localhost:3000/index.html
   ```
6. Chạy kiểm thử tự động: `npm test`.

| Lỗi | Cách sửa |
|---|---|
| `Chưa đặt DATABASE_URL` | Chưa có file `.env`, hoặc file chưa có dòng `DATABASE_URL`. |
| `28P01` | Sai mật khẩu database trong `DATABASE_URL`. |
| `42P01` | Chưa tạo bảng — chạy `npm run setup`. |
| `Tenant or user not found` | Tên người dùng sai: với Session pooler phải là `postgres.<mã-project>`. |
| `ENOTFOUND` | Chép thiếu hoặc sai địa chỉ trong `DATABASE_URL`. |
| `node: bad option: --env-file` | Node quá cũ. Cài Node 20 trở lên. |

## 5. Đưa lên Vercel

**Cách 1: qua GitHub (khuyên dùng)**

1. Đưa thư mục `lua` lên một repo GitHub. File `.gitignore` đã chặn sẵn `.env` và `node_modules`.
2. Vào **vercel.com → Add New → Project**, chọn repo vừa đưa lên.
   - Nếu repo chứa thư mục cha, chọn **Root Directory** là `lua`.
   - **Framework Preset:** để **Other**.
3. Mở **Environment Variables** và nhập các biến:
   - bắt buộc: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`
   - tùy chọn: `BANK_*`, `SEPAY_API_KEY`, `SMTP_*`
4. Bấm **Deploy**. Khi xong, mở `https://<ten-du-an>.vercel.app/api/health`. Thấy `{"ok":true,...}` là web đã nối được Supabase.

**Cách 2: dòng lệnh**

```bash
npm i -g vercel
vercel          # lần đầu: đăng nhập và tạo project
vercel env add DATABASE_URL     # lặp lại cho từng biến ở bước 3
vercel --prod
```

**Lưu ý khi chạy trên Vercel**

- **Ảnh tải lên:** Vercel không cho ghi file lên ổ đĩa. Ảnh admin tải lên được lưu vào **Supabase Storage** (bucket `products`), tối đa **4MB** mỗi ảnh vì Vercel giới hạn dung lượng mỗi lần gửi.
- **Webhook SePay:** điền URL `https://<ten-du-an>.vercel.app/api/webhooks/sepay`.
- **Phiên đăng nhập:** lưu trong bảng `sessions` nên mọi máy chủ của Vercel dùng chung. Cookie tự bật chế độ an toàn (`Secure`) khi chạy qua HTTPS.
- **Tốc độ:** web chạy ở vùng `sin1` (Singapore). Nếu tạo Supabase ở vùng khác, hãy sửa `regions` trong `vercel.json` cho cùng vùng, nếu không mỗi câu truy vấn phải đi vòng qua nước ngoài.

---

## 6. Tài khoản mẫu

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Quản trị viên | admin@lua.vn | Admin@123 |
| Nhân viên | nhanvien@lua.vn | Staff@123 |
| Khách hàng | hoa.nguyen@example.com | Khach@123 |

Trang đăng nhập có khối "Tài khoản mẫu" để bấm điền nhanh. **Xóa khối đó trong `public/dangnhap.html` và đổi mật khẩu các tài khoản trên trước khi đưa web lên mạng.**

---

## 7. Phân quyền

| Chức năng | Khách vãng lai | Khách hàng | Nhân viên | Admin |
|---|:-:|:-:|:-:|:-:|
| Xem sản phẩm, giỏ hàng, đặt hàng | ✔ | ✔ | ✔ | ✔ |
| Xem & hủy đơn *của mình* (khi còn "Chờ xác nhận") | | ✔ | | |
| Viết đánh giá (1 lần / sản phẩm) | | ✔ | | |
| Vào trang Quản trị | | | ✔ | ✔ |
| Xử lý đơn hàng (đổi trạng thái, thanh toán) | | | ✔ | ✔ |
| Cập nhật tồn kho | | | ✔ | ✔ |
| Đọc tin nhắn liên hệ, xóa đánh giá xấu | | | ✔ | ✔ |
| Xem doanh thu | | | | ✔ |
| Thêm / sửa / ngừng bán sản phẩm, đổi giá | | | | ✔ |
| Tạo & tắt mã giảm giá | | | | ✔ |
| Tạo tài khoản nhân viên, đổi vai trò, khóa tài khoản | | | | ✔ |
| Xem danh sách đăng ký nhận tin | | | | ✔ |

**Quyền được kiểm tra ở server, không chỉ ẩn nút trên giao diện.** Middleware `auth('staff', 'admin')` trong `shared/auth.js` đọc lại tài khoản từ CSDL ở mỗi yêu cầu; API Gateway chặn toàn bộ `/api/admin/*` với người không phải nhân viên/admin. Nhờ vậy khi admin khóa tài khoản hoặc đổi vai trò, thay đổi có hiệu lực ngay. Trang `admin.html` cũng bị chặn ở server: người không đủ quyền bị chuyển về trang đăng nhập.

**Các biện pháp bảo mật khác:**
- Mật khẩu được băm bằng `scrypt` (có sẵn trong Node), không lưu mật khẩu gốc.
- Mọi câu SQL dùng tham số `?` để chống SQL injection.
- Giá, mã giảm giá và phí ship do **server tính lại** khi đặt hàng. Người dùng sửa giá trong trình duyệt cũng không có tác dụng.
- Đặt hàng chạy trong transaction, và trigger PostgreSQL chặn việc bán quá số tồn kho.
- Supabase bật Row Level Security cho mọi bảng: khóa công khai (anon key) của Supabase không đọc được dữ liệu, chỉ server (qua `DATABASE_URL`) mới đọc/ghi.

---

## 8. Tính năng

| Tính năng | Ở đâu |
|---|---|
| Đăng nhập / đăng ký, 3 vai trò | `dangnhap.html`, `taikhoan.html`, `admin.html` |
| Danh sách yêu thích | Nút ♥ trên mọi sản phẩm, trang `yeuthich.html` |
| Xem nhanh (quick view) | Rê chuột lên ảnh sản phẩm, bấm "Xem nhanh" |
| Đánh giá sản phẩm (lấy từ bảng `reviews`) | Trang chi tiết: điểm trung bình, biểu đồ số sao, nhãn "Đã mua hàng" |
| Sản phẩm vừa xem | Trang chủ và trang chi tiết |
| Lookbook / editorial | `lookbook.html`, khối giới thiệu trên trang chủ |
| Popup nhận tin (sau 15 giây, hiện 1 lần) + form ở footer | Lưu vào bảng `newsletter_subscribers` |
| Khối Instagram | Trang chủ (ảnh minh họa, xem ghi chú bên dưới) |
| Thanh "Thêm vào giỏ" dính dưới màn hình | Trang chi tiết trên điện thoại |
| Mega menu, tìm kiếm toàn màn hình, nút liên hệ nổi | `layout.js`, có trên mọi trang |
| OG tags + JSON-LD | Mọi trang. Trang chi tiết được server chèn giá, tồn kho, điểm đánh giá theo từng sản phẩm |
| Skeleton loading | Khung xám nhấp nháy trong lúc chờ dữ liệu |
| Size tự khóa khi hết hàng, cảnh báo "Chỉ còn N sản phẩm" | Trang chi tiết, xem nhanh, giỏ hàng |

---

## 9. Ảnh sản phẩm

**Cách 1: tải ảnh lên trong trang Quản trị** (tài khoản admin)

Vào **Quản trị → Sản phẩm & kho**, bấm **Sửa** (hoặc **+ Thêm sản phẩm**). Ở mục **Ảnh sản phẩm**, chọn ảnh trong máy rồi bấm **Lưu thay đổi**.

- Nhận ảnh JPG, PNG, WEBP, GIF, tối đa **4MB**. Đẹp nhất là ảnh dọc tỉ lệ 3:4.
- Có cấu hình Supabase: ảnh được lưu vào **Supabase Storage**, bucket `products`. Xem trong Supabase ở mục **Storage**. Đường dẫn ảnh nằm trong CSDL, nên chuyển dự án cho người khác vẫn còn ảnh.
- Chưa cấu hình Supabase Storage và đang chạy ở máy: ảnh được lưu vào `public/uploads/`.

**Cách 2: dán đường dẫn ảnh.** Ô **"Hoặc dán đường dẫn ảnh"** nhận link ảnh trên mạng (`https://…`) hoặc ảnh có sẵn trong dự án (`/images/ten-anh.jpg`).

## 10. Thanh toán chuyển khoản bằng mã QR

Khi khách chọn **Chuyển khoản ngân hàng**, trang thanh toán hiện **mã QR VietQR** với số tiền và nội dung `LUA <số điện thoại>` đã điền sẵn. Tài khoản nhận tiền được khai báo bằng các biến `BANK_BIN`, `BANK_LABEL`, `BANK_ACCOUNT`, `BANK_OWNER` (trong `.env` hoặc trên Vercel).

**Tự xác nhận tiền về (Payment Service + SePay)**

1. Đăng ký **my.sepay.vn** và liên kết tài khoản ngân hàng.
2. Tạo webhook với URL `https://<ten-du-an>.vercel.app/api/webhooks/sepay`. Chọn chứng thực **API Key** và đặt cùng giá trị với biến `SEPAY_API_KEY`.
3. Khi tiền về, đơn khớp số điện thoại và số tiền sẽ tự chuyển sang **Đã thanh toán**.

Chưa có SePay thì vào **Quản trị → Giao dịch ngân hàng → Mô phỏng tiền về** để demo.

## 11. Email

Điền `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (Gmail cần tạo *App password*). Website sẽ gửi email xác nhận đơn hàng và mã quên mật khẩu. Để trống thì nội dung email chỉ được in ra log: cửa sổ terminal khi chạy ở máy, hoặc mục **Logs** trên Vercel.
