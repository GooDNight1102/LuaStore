-- =========================================================
--  LỤA — Cơ sở dữ liệu website bán hàng thời trang nữ
--  Hệ quản trị: PostgreSQL trên Supabase
--  Cách dùng:  Supabase > SQL Editor > New query > dán toàn bộ file này > Run
--  CHÚ Ý: chạy lại file sẽ XÓA toàn bộ dữ liệu cũ và tạo lại từ đầu.
--  Nội dung:
--    1. Tạo bảng (18 bảng)
--    2. Trigger kiểm tra & trừ tồn kho khi đặt hàng, hoàn kho khi hủy
--    3. View báo cáo
--    4. Bảo mật: bật Row Level Security, tạo kho ảnh (Storage)
--    5. Dữ liệu mẫu
-- =========================================================

SET timezone = 'Asia/Ho_Chi_Minh';            -- giờ trong dữ liệu mẫu là giờ Việt Nam
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;   -- tìm kiếm không dấu ("dam" ra "Đầm")

DROP VIEW IF EXISTS v_low_stock, v_revenue_by_month, v_product_list;
DROP TABLE IF EXISTS sessions, admin_logs, bank_transactions, order_status_history, password_resets,
  newsletter_subscribers, contact_messages, reviews, order_items, orders, shipping_regions, coupons,
  users, product_images, product_variants, products, colors, categories CASCADE;

-- ---------------------------------------------------------
-- 1. BẢNG
-- ---------------------------------------------------------

-- Danh mục sản phẩm: Áo, Quần, Váy & Đầm, Phụ kiện
CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(50)  NOT NULL UNIQUE,          -- 'ao', 'quan', 'vay', 'phukien'
  name        VARCHAR(100) NOT NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0
);

-- Bảng màu dùng chung
CREATE TABLE colors (
  id    SERIAL PRIMARY KEY,
  code  VARCHAR(20) NOT NULL UNIQUE,                  -- 'ruou', 'kem', ...
  name  VARCHAR(50) NOT NULL,
  hex   CHAR(7)     NOT NULL
);

-- Sản phẩm
CREATE TABLE products (
  id           SERIAL PRIMARY KEY,
  sku          VARCHAR(20)  NOT NULL UNIQUE,
  name         VARCHAR(150) NOT NULL,
  category_id  INT NOT NULL REFERENCES categories(id),
  price        BIGINT NOT NULL CHECK (price > 0),     -- giá bán (VNĐ)
  old_price    BIGINT NULL,                           -- giá gốc khi đang giảm giá
  material     VARCHAR(150) NULL,
  description  TEXT NULL,
  badge        VARCHAR(30)  NULL,                     -- 'Bán chạy', 'Mới', ...
  image_url    VARCHAR(255) NULL,                     -- ảnh đại diện (để trống = dùng ô màu vải)
  is_featured  BOOLEAN NOT NULL DEFAULT FALSE,
  is_new       BOOLEAN NOT NULL DEFAULT FALSE,
  sold_count   INT NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','discontinued')),
  created_at   TIMESTAMPTZ(0) NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ(0) NOT NULL DEFAULT now(),
  CONSTRAINT chk_products_old_price CHECK (old_price IS NULL OR old_price > price)
);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_price ON products (price);

-- Biến thể: mỗi tổ hợp (sản phẩm, size, màu) có tồn kho riêng
CREATE TABLE product_variants (
  id          SERIAL PRIMARY KEY,
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size        VARCHAR(20) NOT NULL,                   -- S, M, L, XL, Free size
  color_id    INT NOT NULL REFERENCES colors(id),
  stock       INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,          -- FALSE = size/màu đã bỏ khỏi sản phẩm (giữ lại cho đơn cũ)
  CONSTRAINT uq_variant UNIQUE (product_id, size, color_id)
);

-- Bộ ảnh sản phẩm: mỗi ảnh có thể gắn với 1 màu (color_code = colors.code, NULL = ảnh chung)
CREATE TABLE product_images (
  id          SERIAL PRIMARY KEY,
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         VARCHAR(255) NOT NULL,
  color_code  VARCHAR(20) NULL,
  sort_order  INT NOT NULL DEFAULT 0
);

-- Tài khoản đăng nhập — một bảng cho cả 3 vai trò: customer (khách hàng), staff (nhân viên), admin (quản trị)
CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  full_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(150) NOT NULL UNIQUE,
  phone          VARCHAR(15)  NULL,
  address        VARCHAR(255) NULL,                   -- địa chỉ giao hàng gần nhất (tự điền khi đặt hàng)
  region_code    VARCHAR(20)  NULL,                   -- khu vực giao hàng gần nhất
  password_hash  VARCHAR(255) NOT NULL,               -- dạng scrypt$salt$hash, không lưu mật khẩu gốc
  role           VARCHAR(20)  NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,       -- FALSE = khóa tài khoản
  created_at     TIMESTAMPTZ(0) NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users (role);

-- Mã giảm giá
CREATE TABLE coupons (
  code         VARCHAR(30) PRIMARY KEY,
  type         VARCHAR(10) NOT NULL CHECK (type IN ('percent','fixed','freeship')),
  value        BIGINT NOT NULL DEFAULT 0,             -- % hoặc số tiền
  min_order    BIGINT NOT NULL DEFAULT 0,
  description  VARCHAR(150) NULL,
  starts_at    TIMESTAMPTZ(0) NULL,
  ends_at      TIMESTAMPTZ(0) NULL,
  usage_limit  INT NULL,                              -- NULL = không giới hạn
  used_count   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_coupon_percent CHECK (type <> 'percent' OR value BETWEEN 1 AND 100)
);

-- Khu vực giao hàng & phí ship
CREATE TABLE shipping_regions (
  code       VARCHAR(20) PRIMARY KEY,                 -- 'local', 'big', 'other'
  name       VARCHAR(100) NOT NULL,
  fee        BIGINT NOT NULL,
  free_from  BIGINT NULL,                             -- miễn phí khi đơn >= mức này
  eta        VARCHAR(30) NULL
);

-- Đơn hàng
CREATE TABLE orders (
  id              SERIAL PRIMARY KEY,
  order_code      VARCHAR(20)  NOT NULL UNIQUE,       -- ví dụ LUA260924-123456
  user_id         INT NULL REFERENCES users(id) ON DELETE SET NULL,   -- NULL = khách không đăng nhập
  full_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(15)  NOT NULL,
  email           VARCHAR(150) NULL,
  region_code     VARCHAR(20)  NOT NULL REFERENCES shipping_regions(code),
  address         VARCHAR(255) NOT NULL,
  note            VARCHAR(500) NULL,
  payment_method  VARCHAR(10)  NOT NULL CHECK (payment_method IN ('cod','bank')),
  payment_status  VARCHAR(10)  NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','shipping','completed','cancelled','returned')),
  coupon_code     VARCHAR(30)  NULL REFERENCES coupons(code),
  subtotal        BIGINT NOT NULL DEFAULT 0,
  discount        BIGINT NOT NULL DEFAULT 0,
  shipping_fee    BIGINT NOT NULL DEFAULT 0,
  total           BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ(0) NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ(0) NOT NULL DEFAULT now(),
  CONSTRAINT chk_orders_cod CHECK (payment_method <> 'cod' OR total < 5000000)   -- COD chỉ cho đơn < 5 triệu
);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_created ON orders (created_at);

-- Chi tiết đơn hàng (lưu lại tên, giá tại thời điểm mua)
CREATE TABLE order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id    INT NOT NULL REFERENCES product_variants(id),
  product_name  VARCHAR(150) NOT NULL,
  size          VARCHAR(20)  NOT NULL,
  color_name    VARCHAR(50)  NOT NULL,
  unit_price    BIGINT NOT NULL,
  quantity      SMALLINT NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  line_total    BIGINT GENERATED ALWAYS AS (unit_price * quantity) STORED
);

-- Đánh giá sản phẩm
CREATE TABLE reviews (
  id           SERIAL PRIMARY KEY,
  product_id   INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id      INT NULL REFERENCES users(id) ON DELETE SET NULL,
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content      VARCHAR(1000) NULL,
  created_at   TIMESTAMPTZ(0) NOT NULL DEFAULT now(),
  CONSTRAINT uq_review_once UNIQUE (product_id, user_id)          -- mỗi người đánh giá 1 lần / sản phẩm
);

-- Tin nhắn từ form Liên hệ
CREATE TABLE contact_messages (
  id          SERIAL PRIMARY KEY,
  full_name   VARCHAR(100) NOT NULL,
  phone       VARCHAR(15)  NOT NULL,
  email       VARCHAR(150) NULL,
  message     TEXT NOT NULL,
  is_handled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ(0) NOT NULL DEFAULT now()
);

-- Email đăng ký nhận tin
CREATE TABLE newsletter_subscribers (
  email       VARCHAR(150) PRIMARY KEY,
  created_at  TIMESTAMPTZ(0) NOT NULL DEFAULT now()
);

-- Mã đặt lại mật khẩu: lưu dạng băm, hết hạn sau 15 phút, tối đa 5 lần nhập sai
CREATE TABLE password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   VARCHAR(255) NOT NULL,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ(0) NOT NULL
);

-- Lịch sử trạng thái đơn hàng (dòng thời gian cho khách & nhân viên)
CREATE TABLE order_status_history (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      VARCHAR(20)  NOT NULL,
  note        VARCHAR(255) NULL,
  changed_by  INT NULL REFERENCES users(id) ON DELETE SET NULL,   -- NULL = khách vãng lai / hệ thống (SePay)
  created_at  TIMESTAMPTZ(0) NOT NULL DEFAULT now()
);

-- Giao dịch tiền vào tài khoản ngân hàng (SePay báo về hoặc admin mô phỏng)
CREATE TABLE bank_transactions (
  id          SERIAL PRIMARY KEY,
  sepay_id    BIGINT NULL UNIQUE,                     -- mã giao dịch của SePay, chống ghi trùng khi SePay gửi lại
  gateway     VARCHAR(50)  NOT NULL,                  -- ngân hàng / nguồn
  amount      BIGINT NOT NULL,
  content     VARCHAR(255) NULL,                      -- nội dung chuyển khoản, vd "LUA 0901234567"
  phone       VARCHAR(15)  NULL,                      -- số điện thoại đọc được từ nội dung
  order_id    INT NULL REFERENCES orders(id) ON DELETE SET NULL,   -- đơn đã ghép (NULL = chưa khớp)
  created_at  TIMESTAMPTZ(0) NOT NULL DEFAULT now()
);

-- Nhật ký thao tác của nhân viên/admin
CREATE TABLE admin_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INT NULL REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50)  NOT NULL,
  detail      VARCHAR(255) NULL,
  created_at  TIMESTAMPTZ(0) NOT NULL DEFAULT now()
);

-- Phiên đăng nhập — nhiều máy chủ (Vercel) dùng chung
CREATE TABLE sessions (
  session_id  VARCHAR(128) PRIMARY KEY,
  expires     BIGINT NOT NULL,                        -- thời điểm hết hạn (giây, Unix time)
  data        TEXT NOT NULL
);

-- ---------------------------------------------------------
-- 2. TRIGGER: kiểm tra tồn kho, trừ kho, cộng lượt bán, hoàn kho khi hủy
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_order_item_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_stock INT;
BEGIN
  SELECT stock INTO v_stock FROM product_variants WHERE id = NEW.variant_id FOR UPDATE;
  IF v_stock IS NULL OR v_stock < NEW.quantity THEN
    RAISE EXCEPTION 'Không đủ hàng tồn kho cho sản phẩm này';     -- mã lỗi P0001, server báo "vừa hết hàng"
  END IF;
  UPDATE product_variants SET stock = stock - NEW.quantity WHERE id = NEW.variant_id;
  UPDATE products SET sold_count = sold_count + NEW.quantity
   WHERE id = (SELECT product_id FROM product_variants WHERE id = NEW.variant_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_order_items_stock BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION fn_order_item_stock();

-- Khi đơn bị hủy: hoàn lại tồn kho
CREATE OR REPLACE FUNCTION fn_order_cancel_restock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE product_variants v SET stock = v.stock + s.qty
    FROM (SELECT variant_id, SUM(quantity) AS qty FROM order_items WHERE order_id = NEW.id GROUP BY variant_id) s
   WHERE v.id = s.variant_id;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_orders_after_cancel AFTER UPDATE OF status ON orders
  FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status <> 'cancelled') EXECUTE FUNCTION fn_order_cancel_restock();

-- Tự cập nhật cột updated_at
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_products_touch BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ---------------------------------------------------------
-- 3. VIEW
-- ---------------------------------------------------------

-- Danh sách sản phẩm hiển thị trên trang Sản phẩm
CREATE VIEW v_product_list AS
SELECT p.id, p.sku, p.name, c.slug AS category, c.name AS category_name,
       p.price, p.old_price,
       CASE WHEN p.old_price IS NULL THEN 0
            ELSE ROUND((1 - p.price::numeric / p.old_price) * 100) END AS discount_percent,
       p.badge, p.is_featured, p.is_new, p.sold_count,
       COALESCE(SUM(v.stock), 0) AS total_stock
FROM products p
JOIN categories c ON c.id = p.category_id
LEFT JOIN product_variants v ON v.product_id = p.id
WHERE p.status = 'active'
GROUP BY p.id, c.slug, c.name;

-- Doanh thu theo tháng (không tính đơn hủy/trả)
CREATE VIEW v_revenue_by_month AS
SELECT to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') AS month,
       COUNT(*)          AS order_count,
       SUM(total)        AS revenue,
       ROUND(AVG(total)) AS avg_order_value
FROM orders
WHERE status NOT IN ('cancelled','returned')
GROUP BY 1;

-- Biến thể sắp hết hàng (tồn <= 3)
CREATE VIEW v_low_stock AS
SELECT p.sku, p.name, v.size, co.name AS color, v.stock
FROM product_variants v
JOIN products p ON p.id = v.product_id
JOIN colors co  ON co.id = v.color_id
WHERE v.stock <= 3
ORDER BY v.stock, p.sku;

-- ---------------------------------------------------------
-- 4. BẢO MẬT
-- ---------------------------------------------------------
-- Bật Row Level Security cho mọi bảng và KHÔNG tạo policy nào: khóa "anon" công khai của Supabase không đọc/ghi được gì.
-- Website kết nối bằng chuỗi DATABASE_URL (tài khoản postgres) nên vẫn đọc/ghi bình thường.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
ALTER VIEW v_product_list SET (security_invoker = true);
ALTER VIEW v_revenue_by_month SET (security_invoker = true);
ALTER VIEW v_low_stock SET (security_invoker = true);

-- Kho ảnh sản phẩm (Supabase Storage): bucket "products", ai cũng xem được ảnh, chỉ server (service_role) được tải lên
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', true) ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------
-- 5. DỮ LIỆU MẪU
-- ---------------------------------------------------------

INSERT INTO categories (slug, name, sort_order) VALUES
  ('ao', 'Áo', 1),
  ('quan', 'Quần', 2),
  ('vay', 'Váy & Đầm', 3),
  ('phukien', 'Phụ kiện', 4);

INSERT INTO colors (code, name, hex) VALUES
  ('ruou', 'Đỏ rượu', '#6b2737'),
  ('kem', 'Kem', '#e8dcc4'),
  ('den', 'Đen', '#1c1a17'),
  ('reu', 'Xanh rêu', '#43533f'),
  ('than', 'Xanh than', '#33454f'),
  ('nghe', 'Vàng nghệ', '#c99a4b'),
  ('nau', 'Nâu bò', '#9c7b56'),
  ('gach', 'Đỏ gạch', '#8a3b3b'),
  ('trang', 'Trắng ngà', '#f4efe4');

INSERT INTO products (id, sku, name, category_id, price, old_price, material, description, badge, image_url, is_featured, is_new, sold_count, created_at) VALUES
  (1, 'LUA-A001', 'Áo sơ mi lụa tay bồng', 1, 890000, NULL, '100% lụa tơ tằm Bảo Lộc', 'Sơ mi lụa mềm rủ với tay bồng nhẹ và cổ đức nhỏ. Mặc sơ vin với quần âu đi làm hoặc thả dáng cùng chân váy cho buổi hẹn cuối tuần.', 'Bán chạy', 'https://img.ltwebstatic.com/v4/j/spmp/2026/01/24/82/1769247254584a6f085bd7bcf67bfa94441f28ecc3_thumbnail_405x.webp', TRUE, FALSE, 312, '2026-04-15 09:00:00'),
  (2, 'LUA-V001', 'Chân váy midi xếp ly', 3, 720000, NULL, 'Voan lụa hai lớp, lót satin', 'Chân váy xếp ly dập máy dài qua gối, cạp chun sau giúp dễ mặc. Ly giữ nếp tốt sau nhiều lần giặt.', NULL, 'https://api.muji.com.vn/media/catalog/product/cache/2e9290695da361a7d6192a4c8c689807/4/5/4550723033688_04_org.jpg', TRUE, FALSE, 205, '2026-05-15 09:00:00'),
  (3, 'LUA-A002', 'Blazer len caro', 1, 1450000, NULL, 'Len pha 70% wool, lót lụa', 'Blazer dáng suông, vai đệm mỏng, họa tiết caro trầm. Một món đầu tư mặc được suốt mùa thu đông.', 'Hết size S', 'https://sakurafashion.vn/upload/sanpham/large/308898-ao-khoac-blazer-nu-2.jpg', TRUE, FALSE, 118, '2026-06-15 09:00:00'),
  (4, 'LUA-Q001', 'Quần âu ống suông', 2, 650000, NULL, 'Tuyết mưa co giãn nhẹ', 'Quần âu cạp cao, ống suông dài chạm gót giúp tôn dáng. Có túi chéo hai bên và đỉa đeo thắt lưng.', NULL, 'https://down-vn.img.susercontent.com/file/sg-11134201-81zu6-mn676olj6ghtb6@resize_w900_nl.webp', TRUE, FALSE, 274, '2026-07-15 09:00:00'),
  (5, 'LUA-V002', 'Đầm hai dây linen', 3, 780000, NULL, '100% linen Hà Lan', 'Đầm hai dây dáng suông, dây điều chỉnh được, xẻ nhẹ tà sau. Linen thoáng mát, càng giặt càng mềm.', 'Mới', 'https://cdn.hstatic.net/products/1000304367/d_92283_8b203ca15ed84f6fb6a3bce0a4034e97_master.jpg', FALSE, TRUE, 41, '2026-09-10 09:00:00'),
  (6, 'LUA-A003', 'Áo khoác dạ ngắn', 1, 1690000, NULL, 'Dạ tweed 80% wool', 'Áo khoác dạ dáng lửng, cổ tròn, cài cúc kim loại mạ đồng. Phối cùng quần âu hoặc đầm liền đều đẹp.', 'Mới', 'https://fas-bee.com/cdn/shop/files/L04772EW00948_001.jpg?v=1760620320&width=1200', FALSE, TRUE, 22, '2026-09-10 09:00:00'),
  (7, 'LUA-A004', 'Áo len cổ lọ', 1, 560000, NULL, 'Len cashmere pha 30%', 'Áo len mỏng cổ lọ ôm vừa người, mặc riêng hoặc làm lớp lót trong blazer, áo khoác dạ.', 'Mới', 'https://image.hm.com/assets/hm/3d/c4/3dc45b494104e729726b8255f00ba7cf1b798c7d.jpg?imwidth=2160', FALSE, TRUE, 64, '2026-09-10 09:00:00'),
  (8, 'LUA-P001', 'Túi da đeo chéo', 4, 1250000, NULL, 'Da bò thật thuộc thực vật', 'Túi hộp nhỏ đủ để điện thoại, ví và son. Quai da tháo rời, điều chỉnh được độ dài.', 'Mới', 'https://images2.thanhnien.vn/thumb_w/640/528068263637045248/2025/12/29/01-176698512527551706540.jpg', FALSE, TRUE, 37, '2026-09-10 09:00:00'),
  (9, 'LUA-P002', 'Khăn lụa họa tiết', 4, 420000, NULL, 'Lụa Hà Đông, in lụa thủ công', 'Khăn vuông 70×70cm, viền cuộn tay. Buộc cổ, buộc tóc hay thắt quai túi đều hợp.', 'Mới', 'https://aaajeans.com/wp-content/uploads/2025/03/z5659783052035_0e2b74c12e80dc14170d0f1270bf6768.jpg', FALSE, TRUE, 58, '2026-09-10 09:00:00'),
  (10, 'LUA-A005', 'Áo thun cotton cổ tròn', 1, 350000, NULL, '100% cotton Supima', 'Áo thun trơn dáng regular, cổ bo dày không bai. Món cơ bản nên có nhiều màu trong tủ.', NULL, 'https://image.hm.com/assets/hm/ea/8f/ea8f03626d39484e902a8ebc16b98ed0e1126ada.jpg?imwidth=2160', FALSE, FALSE, 430, '2026-03-15 09:00:00'),
  (11, 'LUA-Q002', 'Quần jeans ống rộng', 2, 590000, NULL, 'Denim cotton 12oz', 'Jeans cạp cao, ống rộng thẳng, màu wash vừa. Gấu để thô, dễ cắt theo chiều cao.', NULL, 'https://i.ebayimg.com/images/g/qiMAAOSwIs9fbYKs/s-l960.webp', FALSE, FALSE, 196, '2026-04-15 09:00:00'),
  (12, 'LUA-Q003', 'Quần short linen', 2, 420000, 560000, '100% linen', 'Quần short cạp chun bản to, dài giữa đùi, có túi hai bên. Hợp đi biển, đi phố mùa hè.', NULL, 'https://images.openai.com/static-rsc-4/z0yJ3Bvop_QUx5jJCCAOSZ8g8uYNXKuSDnkauoua6todfKxBw3s51ONfMr-WATmg-GYvNAwMYC3VHnnbZEAjMPyU_TrT28Yk7VxMjikVeeZA5uNq1RxHO5bSFIOM2zv_Jb5FEZfjzNLD6CsvkzA2h_ZM6kNaCYHw4o25C1FoWrCrnNm8AxyFb7wedZ-UFNkY?purpose=fullsize', FALSE, FALSE, 88, '2026-05-15 09:00:00'),
  (13, 'LUA-V003', 'Đầm maxi hoa nhí', 3, 720000, 1200000, 'Lụa lạnh in hoa', 'Đầm maxi cổ V, tay lỡ, chân váy xòe tầng. Họa tiết hoa nhí nhỏ, dễ mặc cho nhiều dáng người.', NULL, 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lxna0ymcwna3de.webp', TRUE, FALSE, 167, '2026-06-15 09:00:00'),
  (14, 'LUA-V004', 'Đầm suông cổ vuông', 3, 850000, NULL, 'Tafta lụa', 'Đầm suông dài qua gối, cổ vuông, tay phồng nhẹ. Đi làm hay dự tiệc đều ổn.', NULL, 'https://down-vn.img.susercontent.com/file/sg-11134202-822wh-mi4brdawkzcy38.webp', FALSE, FALSE, 102, '2026-07-15 09:00:00'),
  (15, 'LUA-V005', 'Chân váy chữ A da lộn', 3, 483000, 690000, 'Da lộn nhân tạo mềm', 'Chân váy chữ A ngắn trên gối, khóa kéo sau. Phối cùng áo len cổ lọ và boots cho mùa lạnh.', NULL, 'https://media.routine.vn/1200x1500/prod/variant/10s26kniw021-beige-3-jpg-kwbl.webp', FALSE, FALSE, 76, '2026-03-15 09:00:00'),
  (16, 'LUA-A006', 'Áo croptop len dệt kim', 1, 336000, 480000, 'Len dệt kim cotton', 'Áo len lửng tay ngắn, dệt vặn thừng. Mặc cùng quần cạp cao hoặc chân váy midi.', NULL, 'https://images.openai.com/static-rsc-4/JEHsFOgjKmDrYkGE1QAbghLDx3Yyy4gmwrCOvpCk3lqkUWjw1_9dSfkDNr-XOnb5Chi7fcEBqJ9XNg5YbyO0dA4kxZhhYi8cLYEsJIK4cBapaTdAnXAbA7jTAc7P7YfBkORYvHmioH3r0A-0NUMnoCbHY5Akq5ldgA2CW7-GCQOPQzwbENcCFys8YEDROD6q?purpose=fullsize', FALSE, FALSE, 139, '2026-04-15 09:00:00'),
  (17, 'LUA-Q004', 'Quần culottes lụa', 2, 620000, NULL, 'Lụa satin dày', 'Quần ống rộng dài qua bắp chân, bóng nhẹ, rủ mềm. Thanh lịch khi mặc cùng sơ mi.', NULL, 'https://www.mytheresa.com/image/1094/1238/100/e2/P01054956_b1.jpg', FALSE, FALSE, 93, '2026-05-15 09:00:00'),
  (18, 'LUA-P003', 'Thắt lưng da bản nhỏ', 4, 234000, 390000, 'Da bò, khóa hợp kim', 'Thắt lưng bản 2cm, khóa tròn tối giản. Dùng thắt eo đầm suông hoặc đi cùng quần âu.', NULL, 'https://quatangngoctrai.com/wp-content/uploads/2026/05/Bong-Tai-Ngoc-Trai-Moc-Cau-HE1023-5-1536x1536.jpg', FALSE, FALSE, 151, '2026-06-15 09:00:00'),
  (19, 'LUA-P004', 'Bông tai ngọc trai', 4, 290000, NULL, 'Ngọc trai nước ngọt, chốt bạc 925', 'Bông tai ngọc trai nhỏ 8mm, chốt bạc không gây kích ứng. Hộp quà đi kèm.', NULL, 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lvx0yvokdiaj2c.webp', FALSE, FALSE, 244, '2026-07-15 09:00:00'),
  (20, 'LUA-P005', 'Mũ cói vành rộng', 4, 320000, NULL, 'Cói tự nhiên đan tay', 'Mũ cói vành 10cm, quai ruy băng buộc nơ. Gập gọn được khi đi du lịch.', NULL, 'https://images.openai.com/static-rsc-4/70rsx7BNu1XWH0LvQ0KdF8AkS9h2clYz4dVgm_UhxtqribUgmOvD0PXNxoqi6J-5adyB89yEG9iJEji42II3e4ZtMYijjQ4RyaOd7z2TuIyy9Yxr64fB4zSrGMh1VckPoMfQt4DxtVvzDqv65cMTm5ZeVtx82MCgnkgyu2JzCnquW9AY1ecBEV8ME7aeAYSV?purpose=fullsize', FALSE, FALSE, 67, '2026-03-15 09:00:00');
INSERT INTO product_variants (id, product_id, size, color_id, stock) VALUES
  (1, 1, 'S', 1, 9),
  (2, 1, 'S', 2, 12),
  (3, 1, 'M', 1, 14),
  (4, 1, 'M', 2, 3),
  (5, 1, 'L', 1, 5),
  (6, 1, 'L', 2, 8),
  (7, 2, 'S', 4, 2),
  (8, 2, 'S', 3, 5),
  (9, 2, 'S', 2, 8),
  (10, 2, 'M', 4, 7),
  (11, 2, 'M', 3, 10),
  (12, 2, 'M', 2, 13),
  (13, 2, 'L', 4, 12),
  (14, 2, 'L', 3, 15),
  (15, 2, 'L', 2, 4),
  (16, 3, 'M', 7, 2),
  (17, 3, 'M', 5, 2),
  (18, 3, 'L', 7, 14),
  (19, 3, 'L', 5, 3),
  (20, 3, 'XL', 7, 5),
  (21, 3, 'XL', 5, 8),
  (22, 4, 'S', 5, 2),
  (23, 4, 'S', 3, 5),
  (24, 4, 'S', 2, 8),
  (25, 4, 'M', 5, 7),
  (26, 4, 'M', 3, 10),
  (27, 4, 'M', 2, 13),
  (28, 4, 'L', 5, 12),
  (29, 4, 'L', 3, 15),
  (30, 4, 'L', 2, 4),
  (31, 4, 'XL', 5, 3),
  (32, 4, 'XL', 3, 6),
  (33, 4, 'XL', 2, 9),
  (34, 5, 'S', 6, 9),
  (35, 5, 'S', 2, 12),
  (36, 5, 'M', 6, 14),
  (37, 5, 'M', 2, 3),
  (38, 5, 'L', 6, 5),
  (39, 5, 'L', 2, 8),
  (40, 6, 'S', 8, 2),
  (41, 6, 'S', 3, 5),
  (42, 6, 'M', 8, 7),
  (43, 6, 'M', 3, 10),
  (44, 6, 'L', 8, 12),
  (45, 6, 'L', 3, 15),
  (46, 7, 'S', 2, 9),
  (47, 7, 'S', 7, 12),
  (48, 7, 'S', 3, 15),
  (49, 7, 'M', 2, 14),
  (50, 7, 'M', 7, 3),
  (51, 7, 'M', 3, 6),
  (52, 7, 'L', 2, 5),
  (53, 7, 'L', 7, 8),
  (54, 7, 'L', 3, 11),
  (55, 8, 'Free size', 7, 2),
  (56, 8, 'Free size', 3, 5),
  (57, 9, 'Free size', 1, 9),
  (58, 9, 'Free size', 4, 12),
  (59, 10, 'S', 9, 2),
  (60, 10, 'S', 3, 5),
  (61, 10, 'S', 4, 8),
  (62, 10, 'M', 9, 7),
  (63, 10, 'M', 3, 10),
  (64, 10, 'M', 4, 13),
  (65, 10, 'L', 9, 12),
  (66, 10, 'L', 3, 15),
  (67, 10, 'L', 4, 4),
  (68, 10, 'XL', 9, 3),
  (69, 10, 'XL', 3, 6),
  (70, 10, 'XL', 4, 9),
  (71, 11, 'S', 5, 9),
  (72, 11, 'M', 5, 14),
  (73, 11, 'L', 5, 5),
  (74, 12, 'S', 2, 2),
  (75, 12, 'S', 4, 5),
  (76, 12, 'M', 2, 7),
  (77, 12, 'M', 4, 10),
  (78, 12, 'L', 2, 12),
  (79, 12, 'L', 4, 15),
  (80, 13, 'S', 1, 9),
  (81, 13, 'S', 4, 12),
  (82, 13, 'M', 1, 14),
  (83, 13, 'M', 4, 3),
  (84, 13, 'L', 1, 5),
  (85, 13, 'L', 4, 8),
  (86, 14, 'S', 3, 2),
  (87, 14, 'S', 5, 5),
  (88, 14, 'M', 3, 7),
  (89, 14, 'M', 5, 10),
  (90, 14, 'L', 3, 12),
  (91, 14, 'L', 5, 15),
  (92, 14, 'XL', 3, 3),
  (93, 14, 'XL', 5, 6),
  (94, 15, 'S', 7, 9),
  (95, 15, 'S', 8, 12),
  (96, 15, 'M', 7, 14),
  (97, 15, 'M', 8, 3),
  (98, 15, 'L', 7, 5),
  (99, 15, 'L', 8, 8),
  (100, 16, 'S', 2, 2),
  (101, 16, 'S', 6, 5),
  (102, 16, 'M', 2, 7),
  (103, 16, 'M', 6, 10),
  (104, 17, 'S', 1, 9),
  (105, 17, 'S', 3, 12),
  (106, 17, 'M', 1, 14),
  (107, 17, 'M', 3, 3),
  (108, 17, 'L', 1, 5),
  (109, 17, 'L', 3, 8),
  (110, 18, 'Free size', 3, 2),
  (111, 18, 'Free size', 7, 5),
  (112, 19, 'Free size', 9, 9),
  (113, 20, 'Free size', 6, 2);

INSERT INTO shipping_regions (code, name, fee, free_from, eta) VALUES
  ('local', 'Nội thành Hội An / Đà Nẵng', 30000, 500000, '1–2 ngày'),
  ('big', 'TP.HCM & Hà Nội', 30000, NULL, '2–4 ngày'),
  ('other', 'Các tỉnh thành khác', 35000, NULL, '3–6 ngày');

INSERT INTO coupons (code, type, value, min_order, description, starts_at, ends_at, usage_limit) VALUES
  ('LUA10', 'percent', 10, 500000, 'Giảm 10% cho đơn từ 500.000₫', '2026-09-01 00:00:00', '2026-12-31 23:59:59', NULL),
  ('CHAOTHU', 'fixed', 50000, 800000, 'Giảm 50.000₫ cho đơn từ 800.000₫', '2026-09-01 00:00:00', '2026-12-31 23:59:59', NULL),
  ('FREESHIP', 'freeship', 0, 0, 'Miễn phí vận chuyển', '2026-09-01 00:00:00', '2026-12-31 23:59:59', 500);

-- Tài khoản mẫu (mật khẩu gốc ghi bên cạnh — ĐỔI trước khi dùng thật)
INSERT INTO users (id, full_name, email, phone, password_hash, role, created_at) VALUES
  (1, 'Quản trị LỤA', 'admin@lua.vn', '0901234567', 'scrypt$0fd478b4da9654259aa3b34785f2094f$f1369265be2dcdaceb0eba309009ad630063f2bb7c189cc9b9af21dafaef4b9b7a31fd04343864c2db1e4aa6b0c4da3269da445a535c6a99887211ea6ca60235', 'admin', '2026-01-05 08:00:00'),
  (2, 'Lê Thị Mai', 'nhanvien@lua.vn', '0905556677', 'scrypt$024b93702722c610dcc6aa7e30d07883$1fedaf93ee80528d4452c4a66a10326cc1a2d2329f7613f8ee1bd7519e3d13f96796e658daf5f87424b2e01d35cf08f132092bb1c7ada6965eae4750d263417b', 'staff', '2026-02-10 08:00:00'),
  (3, 'Nguyễn Thị Hoa', 'hoa.nguyen@example.com', '0901112233', 'scrypt$32c878ddb9cc4a83eac7294af4fcdb21$aa6237884ccdcc9a3d5a33140eca8ccf624271091d8d19afeea7d6cd523f76b46f74f3c6dfd691e138c92a0bf88d053c315e50e423497b183fd4c180f2d21c4c', 'customer', '2026-06-02 10:15:00'),
  (4, 'Trần Minh Anh', 'minhanh.tran@example.com', '0987654321', 'scrypt$56edfe5ee1bd0f3806a2bcee9bd2dabb$ed4724abd80be723f554305be7f84a2b6331300c34e20650c0d3370f8f4e2869f35c6d108497d411a29ef06e08e7999761bb5e3696eb1ed2d852d9aa9c804d83', 'customer', '2026-07-19 20:40:00');
UPDATE users SET address = '25 Lê Lợi, Phường Minh An, Hội An, Quảng Nam', region_code = 'local' WHERE id = 3;
UPDATE users SET address = '88 Nguyễn Thị Minh Khai, Phường Đa Kao, Quận 1, TP.HCM', region_code = 'big' WHERE id = 4;

INSERT INTO orders (id, order_code, user_id, full_name, phone, email, region_code, address, payment_method, payment_status, status, coupon_code, subtotal, discount, shipping_fee, total, created_at) VALUES
  (1, 'LUA260812-4821', 3, 'Nguyễn Thị Hoa', '0901112233', 'hoa.nguyen@example.com', 'local', '25 Lê Lợi, Phường Minh An, Hội An, Quảng Nam', 'cod', 'paid', 'completed', NULL, 1610000, 0, 0, 1610000, '2026-08-12 14:22:00');
INSERT INTO order_items (order_id, variant_id, product_name, size, color_name, unit_price, quantity) VALUES
  (1, 3, 'Áo sơ mi lụa tay bồng', 'M', 'Đỏ rượu', 890000, 1),
  (1, 10, 'Chân váy midi xếp ly', 'M', 'Xanh rêu', 720000, 1);

INSERT INTO orders (id, order_code, user_id, full_name, phone, email, region_code, address, payment_method, payment_status, status, coupon_code, subtotal, discount, shipping_fee, total, created_at) VALUES
  (2, 'LUA260903-1177', 4, 'Trần Minh Anh', '0987654321', 'minhanh.tran@example.com', 'big', '88 Nguyễn Thị Minh Khai, Phường Đa Kao, Quận 1, TP.HCM', 'bank', 'paid', 'shipping', 'LUA10', 2010000, 201000, 30000, 1839000, '2026-09-03 09:05:00');
INSERT INTO order_items (order_id, variant_id, product_name, size, color_name, unit_price, quantity) VALUES
  (2, 16, 'Blazer len caro', 'M', 'Nâu bò', 1450000, 1),
  (2, 49, 'Áo len cổ lọ', 'M', 'Kem', 560000, 1);

INSERT INTO orders (id, order_code, user_id, full_name, phone, email, region_code, address, payment_method, payment_status, status, coupon_code, subtotal, discount, shipping_fee, total, created_at) VALUES
  (3, 'LUA260920-3350', NULL, 'Lê Thu Trang', '0356789012', NULL, 'other', '12 Trần Hưng Đạo, Phường Lê Lợi, TP. Quy Nhơn, Bình Định', 'cod', 'unpaid', 'pending', NULL, 1300000, 0, 35000, 1335000, '2026-09-20 19:48:00');
INSERT INTO order_items (order_id, variant_id, product_name, size, color_name, unit_price, quantity) VALUES
  (3, 81, 'Đầm maxi hoa nhí', 'S', 'Xanh rêu', 720000, 1),
  (3, 112, 'Bông tai ngọc trai', 'Free size', 'Trắng ngà', 290000, 2);

UPDATE coupons SET used_count = 1 WHERE code = 'LUA10';

-- Lịch sử trạng thái cho các đơn mẫu
INSERT INTO order_status_history (order_id, status, note, created_at)
  SELECT id, 'pending', 'Đặt hàng', created_at FROM orders;
INSERT INTO order_status_history (order_id, status, note, created_at)
  SELECT id, status, 'Cập nhật trạng thái', created_at + interval '1 day' FROM orders WHERE status <> 'pending';
INSERT INTO newsletter_subscribers (email) VALUES ('hoa.nguyen@example.com');

INSERT INTO reviews (product_id, user_id, rating, content, created_at) VALUES
  (1, 3, 5, 'Lụa mềm, mặc mát, form tay bồng rất xinh. Size M vừa với mình 50kg.', '2026-08-20 21:10:00'),
  (1, 4, 4, 'Màu kem ngoài đời hơi ngả vàng hơn ảnh nhưng vẫn đẹp, đường may kỹ.', '2026-09-05 19:00:00'),
  (1, NULL, 5, 'Mua tặng mẹ, mẹ rất thích. Đóng gói cẩn thận.', '2026-07-11 09:30:00'),
  (2, 3, 4, 'Ly giữ nếp tốt sau khi giặt, màu rêu ngoài đời đẹp hơn ảnh.', '2026-08-21 08:30:00'),
  (3, 4, 5, 'Blazer đứng dáng, lót lụa sờ rất thích. Đáng tiền.', '2026-09-12 12:00:00'),
  (4, NULL, 4, 'Quần dài chạm gót với người cao 1m60, cạp cao tôn dáng.', '2026-06-28 14:20:00'),
  (7, 4, 4, 'Len mỏng, mặc trong blazer vừa đẹp. Hơi xù nhẹ sau vài lần giặt.', '2026-09-15 22:00:00'),
  (10, 4, 5, 'Áo thun dày dặn, cổ không bai. Đã mua thêm màu đen.', '2026-08-02 10:00:00'),
  (13, 3, 5, 'Đầm xòe đẹp, vải lụa lạnh mát, giá sale quá hời.', '2026-09-01 20:45:00'),
  (19, 3, 5, 'Ngọc trai nhỏ xinh, đeo đi làm hằng ngày rất hợp.', '2026-08-25 18:10:00');

INSERT INTO contact_messages (full_name, phone, email, message) VALUES
  ('Phạm Ngọc Lan', '0912345678', 'lan.pham@example.com', 'Mình cao 1m58, nặng 47kg thì nên mặc size S hay M của áo sơ mi lụa tay bồng?');


-- Đặt lại bộ đếm id sau khi chèn dữ liệu mẫu có id cố định
SELECT setval(pg_get_serial_sequence('categories', 'id'), COALESCE((SELECT MAX(id) FROM categories), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('colors', 'id'), COALESCE((SELECT MAX(id) FROM colors), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('products', 'id'), COALESCE((SELECT MAX(id) FROM products), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('product_variants', 'id'), COALESCE((SELECT MAX(id) FROM product_variants), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('product_images', 'id'), COALESCE((SELECT MAX(id) FROM product_images), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('orders', 'id'), COALESCE((SELECT MAX(id) FROM orders), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('order_items', 'id'), COALESCE((SELECT MAX(id) FROM order_items), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('reviews', 'id'), COALESCE((SELECT MAX(id) FROM reviews), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('contact_messages', 'id'), COALESCE((SELECT MAX(id) FROM contact_messages), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('password_resets', 'id'), COALESCE((SELECT MAX(id) FROM password_resets), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('order_status_history', 'id'), COALESCE((SELECT MAX(id) FROM order_status_history), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('bank_transactions', 'id'), COALESCE((SELECT MAX(id) FROM bank_transactions), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('admin_logs', 'id'), COALESCE((SELECT MAX(id) FROM admin_logs), 0) + 1, false);

-- ---------------------------------------------------------
-- 6. DỮ LIỆU MÔ PHỎNG: 60 khách hàng, ~450 đơn hàng rải đều 12 tháng gần nhất, đánh giá, giao dịch, tin nhắn
--    (để trang Tổng quan / biểu đồ doanh thu có số liệu như cửa hàng đang hoạt động)
-- ---------------------------------------------------------
UPDATE product_variants SET stock = floor(random() * 40)::int;      -- nhập kho mô phỏng
ALTER TABLE order_items DISABLE TRIGGER trg_order_items_stock;          -- đơn mô phỏng không trừ kho

DO $$
DECLARE
  ho  text[] := ARRAY['Nguyễn','Trần','Lê','Phạm','Hoàng','Huỳnh','Phan','Vũ','Võ','Đặng','Bùi','Đỗ','Hồ','Ngô','Dương','Lý'];
  dem text[] := ARRAY['Thị','Ngọc','Thu','Thanh','Minh','Bảo','Khánh','Mai','Hồng','Phương','Kim','Diệu'];
  ten text[] := ARRAY['Anh','Trang','Linh','Hương','Lan','Vy','Ngân','Hà','Thảo','My','Quỳnh','Uyên','Nhi','Hạnh','Yến','Châu','Giang','Hiền','Tâm','Trâm'];
  addr text[] := ARRAY['12 Trần Phú, Hội An, Quảng Nam','45 Bạch Đằng, Hải Châu, Đà Nẵng','88 Nguyễn Thị Minh Khai, Quận 1, TP.HCM',
                       '21 Lê Văn Sỹ, Phú Nhuận, TP.HCM','15 Hàng Bông, Hoàn Kiếm, Hà Nội','102 Cầu Giấy, Cầu Giấy, Hà Nội',
                       '7 Lý Thường Kiệt, TP. Huế','33 Trần Hưng Đạo, TP. Quy Nhơn','60 Nguyễn Văn Cừ, Ninh Kiều, Cần Thơ',
                       '19 Hùng Vương, TP. Nha Trang','5 Phan Chu Trinh, TP. Vinh, Nghệ An','27 Lê Lợi, TP. Đà Lạt'];
  reg text[] := ARRAY['local','local','big','big','big','big','other','other','other','other','other','other'];
  cmt text[] := ARRAY['Vải đẹp, mặc mát, form chuẩn.','Giao hàng nhanh, đóng gói cẩn thận.','Màu ngoài đời đẹp hơn ảnh.',
                      'Đường may kỹ, đáng tiền.','Size vừa vặn, sẽ ủng hộ tiếp.','Chất liệu ổn, hơi nhăn sau khi giặt.',
                      'Mặc đi làm rất thanh lịch.','Mua tặng mẹ, mẹ rất thích.'];
  pw text := (SELECT password_hash FROM users WHERE id = 3);                -- mật khẩu chung: Khach@123
  u int; o int; v record; a int; t timestamptz; st text; n int; age int; sub bigint; ship bigint; tot bigint; i int; k int; pay text;
BEGIN
  -- Khách hàng
  FOR i IN 1..60 LOOP
    a := 1 + floor(random() * 12)::int;
    INSERT INTO users (full_name, email, phone, password_hash, role, address, region_code, created_at)
    VALUES (ho[1 + floor(random() * 16)::int] || ' ' || dem[1 + floor(random() * 12)::int] || ' ' || ten[1 + floor(random() * 20)::int],
            'khach' || i || '@example.com', '09' || lpad(floor(random() * 1e8)::text, 8, '0'), pw, 'customer',
            addr[a], reg[a], now() - (floor(random() * 400) || ' days')::interval);
  END LOOP;

  -- Đơn hàng: nhiều hơn vào các tháng gần đây và mùa lễ
  FOR i IN 1..450 LOOP
    age := floor(power(random(), 1.4) * 365)::int;
    t := now() - (age || ' days')::interval - (floor(random() * 600) || ' minutes')::interval;
    SELECT id INTO u FROM users WHERE role = 'customer' ORDER BY random() LIMIT 1;
    IF random() < 0.25 THEN u := NULL; END IF;                               -- 25% khách vãng lai
    a := 1 + floor(random() * 12)::int;
    st := CASE WHEN age > 10 THEN (ARRAY['completed','completed','completed','completed','completed','completed','cancelled','returned'])[1 + floor(random() * 8)::int]
               WHEN age > 4  THEN (ARRAY['shipping','completed','completed','cancelled'])[1 + floor(random() * 4)::int]
               ELSE (ARRAY['pending','pending','confirmed','shipping'])[1 + floor(random() * 4)::int] END;
    INSERT INTO orders (order_code, user_id, full_name, phone, email, region_code, address, payment_method, status, created_at)
    SELECT 'LUA' || to_char(t AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad((200000 + i)::text, 6, '0'), u,
           COALESCE(us.full_name, ho[1 + floor(random() * 16)::int] || ' Thị ' || ten[1 + floor(random() * 20)::int]),
           COALESCE(us.phone, '03' || lpad(floor(random() * 1e8)::text, 8, '0')), us.email,
           COALESCE(us.region_code, reg[a]), COALESCE(us.address, addr[a]), 'bank', st, t
    FROM (SELECT 1) x LEFT JOIN users us ON us.id = u
    RETURNING id INTO o;
    n := 1 + floor(random() * 3)::int;
    FOR v IN SELECT pv.id, p.name, pv.size, co.name AS color, p.price FROM product_variants pv
             JOIN products p ON p.id = pv.product_id JOIN colors co ON co.id = pv.color_id ORDER BY random() LIMIT n LOOP
      INSERT INTO order_items (order_id, variant_id, product_name, size, color_name, unit_price, quantity)
      VALUES (o, v.id, v.name, v.size, v.color, v.price, CASE WHEN random() < 0.8 THEN 1 ELSE 2 END);
    END LOOP;
    SELECT SUM(line_total) INTO sub FROM order_items WHERE order_id = o;
    SELECT CASE WHEN free_from IS NOT NULL AND sub >= free_from THEN 0 ELSE fee END INTO ship
      FROM shipping_regions WHERE code = (SELECT region_code FROM orders WHERE id = o);
    tot := sub + ship;
    pay := CASE WHEN tot < 5000000 AND random() < 0.6 THEN 'cod' ELSE 'bank' END;
    UPDATE orders SET subtotal = sub, shipping_fee = ship, total = tot, payment_method = pay, updated_at = t,
           payment_status = CASE WHEN st = 'completed' OR (pay = 'bank' AND st IN ('confirmed','shipping')) THEN 'paid'
                                 WHEN st = 'returned' THEN 'refunded' ELSE 'unpaid' END
     WHERE id = o;
    -- Dòng thời gian trạng thái
    INSERT INTO order_status_history (order_id, status, note, created_at) VALUES (o, 'pending', 'Đặt hàng', t);
    k := 0;
    FOREACH pay IN ARRAY ARRAY['confirmed','shipping','completed'] LOOP
      EXIT WHEN st IN ('pending','cancelled') OR (st = 'confirmed' AND pay <> 'confirmed') OR (st = 'shipping' AND pay = 'completed');
      k := k + 1;
      INSERT INTO order_status_history (order_id, status, note, created_at)
      VALUES (o, pay, (ARRAY['Đã xác nhận','Đang giao','Hoàn tất'])[k], t + (k || ' days')::interval);
    END LOOP;
    IF st IN ('cancelled','returned') THEN
      INSERT INTO order_status_history (order_id, status, note, created_at)
      VALUES (o, st, CASE st WHEN 'cancelled' THEN 'Đã hủy' ELSE 'Trả hàng' END, t + interval '4 days');
    END IF;
  END LOOP;

  -- Giao dịch ngân hàng cho đơn chuyển khoản đã thanh toán
  INSERT INTO bank_transactions (gateway, amount, content, phone, order_id, created_at)
  SELECT 'SePay · Vietcombank', total, 'LUA ' || phone, phone, id, created_at + interval '7 minutes'
  FROM orders WHERE payment_method = 'bank' AND payment_status IN ('paid','refunded') AND id > 3;

  -- Đánh giá từ khách đã nhận hàng (60%)
  INSERT INTO reviews (product_id, user_id, rating, content, created_at)
  SELECT DISTINCT ON (pv.product_id, o.user_id) pv.product_id, o.user_id,
         (ARRAY[5,5,5,4,4,4,3,5])[1 + floor(random() * 8)::int], cmt[1 + floor(random() * 8)::int], o.created_at + interval '6 days'
  FROM orders o JOIN order_items it ON it.order_id = o.id JOIN product_variants pv ON pv.id = it.variant_id
  WHERE o.status = 'completed' AND o.user_id IS NOT NULL AND random() < 0.6
  ON CONFLICT (product_id, user_id) DO NOTHING;

  INSERT INTO newsletter_subscribers (email, created_at)
  SELECT email, created_at FROM users WHERE role = 'customer' AND random() < 0.5 ON CONFLICT DO NOTHING;

  INSERT INTO contact_messages (full_name, phone, email, message, is_handled, created_at)
  SELECT full_name, phone, email,
         (ARRAY['Shop còn size M màu kem của áo sơ mi lụa không ạ?','Mình muốn đổi size đơn vừa nhận thì làm thế nào?',
                'Đầm maxi có giao hỏa tốc trong ngày ở Đà Nẵng không?','Cho mình hỏi chất liệu quần culottes có nhăn không?'])[1 + floor(random() * 4)::int],
         random() < 0.6, now() - (floor(random() * 30) || ' days')::interval
  FROM users WHERE role = 'customer' ORDER BY random() LIMIT 8;
END $$;

ALTER TABLE order_items ENABLE TRIGGER trg_order_items_stock;
UPDATE products p SET sold_count = s.n FROM (                           -- lượt bán = tổng số lượng trong đơn không hủy/trả
  SELECT pv.product_id, SUM(it.quantity) AS n FROM order_items it JOIN orders o ON o.id = it.order_id
  JOIN product_variants pv ON pv.id = it.variant_id WHERE o.status NOT IN ('cancelled','returned') GROUP BY pv.product_id) s
 WHERE p.id = s.product_id;
