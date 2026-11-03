// SERVICE REGISTRY — danh sách các service của hệ thống LỤA.
// API Gateway (app.js) đọc danh sách này để gắn từng service vào đường dẫn:
//   service.router -> /api/...         (API công khai cho website)
//   service.admin  -> /api/admin/...   (API quản trị, cần đăng nhập nhân viên/admin)
// Thêm service mới = tạo file *.service.js rồi thêm vào mảng dưới đây.
const services = [
  require('./identity.service'),
  require('./catalog.service'),
  require('./order.service'),
  require('./payment.service'),
  require('./support.service'),
  require('./media.service'),
  require('./reporting.service'),
  require('./notification.service')
];

// Hợp đồng (contract) của từng service: liệt kê các endpoint đang cung cấp — xem tại GET /api/services
const endpoints = (router, prefix) => (router ? router.stack : [])
  .filter((l) => l.route)
  .flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${prefix}${l.route.path}`));

const describe = () => services.map((s) => ({
  name: s.name, version: s.version, description: s.description,
  endpoints: [...endpoints(s.router, '/api'), ...endpoints(s.admin, '/api/admin')]
}));

module.exports = { services, describe };
