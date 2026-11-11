# Công nợ Khối Ngoại khoa — Dashboard & giải trình

Web app thay cho quy trình "kế toán gửi file công nợ → quản lý email yêu cầu sale giải trình".
Kế toán gửi file như cũ; admin nạp file lên web; sale đăng nhập và giải trình từng khách hàng có nợ quá hạn
trên mức an toàn (A2–A4); quản lý duyệt hoặc trả lại ngay trên web.

Hướng dẫn triển khai từng bước: [docs/HUONG_DAN_TRIEN_KHAI.md](docs/HUONG_DAN_TRIEN_KHAI.md).

## Kiến trúc

Cùng chuẩn với ccdc-management, contract, sale-target:

```
Frontend (GitHub Pages)            Backend (Supabase nrfxymnfmjhbsgpipvkb)
┌────────────────────────┐         ┌──────────────────────────────────┐
│ dashboard/ (SPA)       │  HTTPS  │ Edge Functions                   │
│  React 18 + Tailwind   │ ──────► │  • debt-login (shared.users)     │
│  SheetJS đọc file xlsb │         │  • debt-api   (nghiệp vụ, quyền)  │
└────────────────────────┘         │ Postgres: schema app_debt         │
                                   └──────────────────────────────────┘
```

- File `.xlsb` được đọc ngay trên trình duyệt (`importer.js`), đối chiếu với sheet BC rồi mới tải lên.
- Mỗi lần nạp = 1 batch; kỳ báo cáo chỉ chuyển sang batch mới khi tải lên xong. Nạp lại cùng kỳ không làm mất giải trình.
- Mỗi batch chứa cả kỳ báo cáo và kỳ trước của cùng file, nên số so sánh khớp đúng báo cáo kế toán.

## Màn hình

| Tab | Ai dùng | Nội dung |
|---|---|---|
| Tổng quan | Tất cả | KPI, tiến độ giải trình, biến động dư nợ, cơ cấu nhóm nợ / nhóm KH, top 15 KH quá hạn |
| Giải trình | Sale, quản lý | Danh sách KH × sale có nợ A2–A4; popup chi tiết hóa đơn, form giải trình, duyệt / trả lại, lịch sử |
| Theo sale | Quản lý | Dư nợ, tiến độ giải trình, cam kết kỳ trước vs thực thu từng sale |
| Hàng vay chưa xuất HĐ | Tất cả | Theo KH × sale, xem chứng từ, xuất Excel |
| Quản trị | Admin | Nạp file, hạn giải trình, khoá kỳ, gắn tên sale ↔ tài khoản + người duyệt |

## Phân quyền (theo `shared.users.role`)

| Role | Xem | Giải trình | Duyệt |
|---|---|---|---|
| admin | Tất cả | Sửa thay mọi sale | Tất cả · nạp file · cấu hình |
| manager | Tất cả | — | Tất cả |
| product_manager | Ngành hàng theo `users.bu` (chcs = CTCH, thnk = Nội soi tiêu hao, cttm = CTTM; `all` = tất cả) | — | Sale trong ngành chưa gán người duyệt riêng |
| area_manager | Toàn bộ KH của các PS mình phụ trách: `shared.dm_ps` cùng `bu_code` với `users.bu` và `area` thuộc `users.scope` (tên miền; nếu trống lấy `users.mien` MB/MN/BOTH). Khớp `dm_ps.ten_ps` với tên NV trong file | — | Các PS đó, trừ khi đã gán người duyệt khác |
| ps (sale) | Chỉ KH của mình (theo bảng gắn tên) | KH của mình | — |
| purchasing | Không vào được | | |

Số tổng toàn khối (biến động dư nợ, đối chiếu) chỉ trả về cho người xem được tất cả.

## Cấu trúc

```
dashboard/                 → deploy GitHub Pages
  index.html
  assets/js/config.js      endpoint, danh sách nguyên nhân, nhóm nợ bắt buộc giải trình
  assets/js/importer.js    đọc file xlsb kế toán (chạy được cả Node để kiểm thử)
  assets/js/mock.js        backend giả cho chế độ demo (?demo=1)
  assets/js/data.js        tải + tổng hợp số liệu kỳ, bộ lọc chung
  assets/js/screens/*.js   tong-quan, giai-trinh, theo-sale, hang-vay, quan-tri
supabase/functions/debt-login, debt-api
sql/01_schema_app_debt.sql
```

## Chạy thử không cần máy chủ

```bash
python -m http.server 5178 --directory dashboard
```

Mở `http://localhost:5178/?demo=1`, đăng nhập `admin` (mật khẩu bất kỳ), vào **Quản trị** nạp file xlsb.
Sau đó đăng nhập `quanly`, `tn_thnk` hoặc tên sale viết liền không dấu (ví dụ `nguyenthiduyen`).
Dữ liệu demo chỉ nằm trong IndexedDB của trình duyệt.
