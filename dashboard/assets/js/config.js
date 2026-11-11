// Cấu hình endpoint. Cùng Supabase project với sale-target/order/kpi/ccdc
// nên tài khoản shared.users dùng chung, token do debt-login phát ra.
window.DEBT_CONFIG = {
  SUPABASE_URL: "https://nrfxymnfmjhbsgpipvkb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZnh5bW5mbWpoYnNncGlwdmtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODk2OTQsImV4cCI6MjA5ODQ2NTY5NH0.cN-jTdPOLWKd9kNa1nNMENzHcY0_BftyYgPEbuVTWeo",
  FN_LOGIN_NAME: "debt-login",
  FN_API_NAME:   "debt-api",
  TOKEN_STORAGE_KEY: "debt.token.v1",
  USER_STORAGE_KEY:  "debt.user.v1",

  // Chế độ demo: mở trang với ?demo=1 → không gọi Supabase, dữ liệu lưu trong trình duyệt (IndexedDB).
  DEMO: new URLSearchParams(location.search).has("demo"),

  // Nhóm nợ bắt buộc giải trình.
  NHOM_GIAI_TRINH: ["A2", "A3", "A4"],

  // Danh sách nguyên nhân cho sale chọn. Sửa tại đây nếu cần thêm/bớt.
  NGUYEN_NHAN: [
    "Đã đủ hồ sơ, chờ BV thanh toán theo quy trình",
    "Thiếu hồ sơ/chứng từ (BBBG, phiếu SDVT, ĐCCN, HĐ)",
    "BV chưa có nguồn/ngân sách, chờ cấp vốn hoặc BHYT",
    "Vướng thủ tục thầu/hợp đồng",
    "Sai lệch số liệu, đang đối chiếu với BV",
    "Chờ xuất hóa đơn điều chỉnh/thay thế",
    "Khác",
  ],
};
