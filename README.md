# Công nợ Khối Ngoại khoa — Dashboard & giải trình

Web app thay cho quy trình "kế toán gửi file công nợ → quản lý email yêu cầu sale giải trình".
Kế toán gửi file như cũ; admin nạp file lên web; area manager giải trình từng khách hàng có nợ quá hạn
trên mức an toàn (A2–A4) của khu vực mình; quản lý duyệt hoặc trả lại ngay trên web; sale xem phần của mình.

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
| Giải trình | Area manager, quản lý, sale (xem) | Danh sách KH × sale có nợ A2–A4; popup hóa đơn A2–A4, giải trình + tháng dự kiến thu, duyệt / trả lại, lịch sử |
| Theo sale | Quản lý | Admin/manager: bảng tổng hợp nợ A2–A4 theo nhóm nợ × BU → team (dm_ps) kèm cột đã/chưa giải trình, xuất Excel. Mọi người: dư nợ, tiến độ giải trình, số KH hẹn thu kỳ trước đã có tiền về theo sale |
| Hàng vay chưa xuất HĐ | Tất cả | Theo KH × sale, xem chứng từ, xuất Excel |
| Quản trị | Admin | Nạp file, hạn giải trình, khoá kỳ, xem phân quyền theo dm_ps, gắn tay / người duyệt riêng |

## Phân quyền (theo `shared.users.role` + danh mục PS `shared.dm_ps`)

Tên NV trong file kế toán = `dm_ps.ten_ps`.

| Role | Xem | Giải trình | Duyệt |
|---|---|---|---|
| admin | Tất cả | Mọi KH (thay khi chưa có area manager) | Tất cả · nạp file · cấu hình |
| manager | Tất cả | — | Tất cả |
| area_manager | KH của các PS phụ trách: `dm_ps.bu_code` thuộc `users.bu`, `dm_ps.area` thuộc `users.scope` (tên miền; trống thì lấy `users.mien` MB/MN/BOTH). Miền nào BU có > 1 team Active (vd CH&CS Miền Nam) thì chỉ team của AM: team trên dòng `dm_ps` của chính AM, hoặc team trùng tên tài khoản (`CHCS 1 Miền Nam` ↔ `CHCS 1 MN`) | **Người giải trình chính** cho các PS đó | — |
| product_manager | Ngành hàng theo `users.bu` (chcs/thnk/cttm, `all` = tất cả) | — | — |
| ps (sale) | Chỉ KH của mình: `dm_ps.ps` = `users.scope` (hoặc username), hoặc `dm_ps.ten_ps` = họ tên | — (chỉ xem) | — |
| purchasing | Không vào được | | |

Màn Quản trị có thể gắn tay tài khoản xem cho tên không có trong `dm_ps`, và chỉ định người duyệt riêng cho từng tên NV.
Số tổng toàn khối (biến động dư nợ, đối chiếu) chỉ trả về cho người xem được tất cả.

## Nội dung giải trình

Mỗi KH × sale có nợ A2–A4: **Giải trình & kế hoạch xử lý** + **Tháng dự kiến thu** (`yyyy-mm`). Popup chỉ hiện hóa đơn A2–A4.
Luồng phê duyệt **đang tắt** (`PHE_DUYET = false` ở `config.js` và `debt-api`): lưu giải trình = "Đã giải trình", area manager sửa lại được tới khi admin khoá kỳ.
Bật lại thì có: lưu nháp / gửi duyệt → admin hoặc manager duyệt hoặc trả lại (bắt buộc nhận xét).

## Cấu trúc

```
dashboard/                 → deploy GitHub Pages
  index.html
  assets/js/config.js      endpoint, nhóm nợ bắt buộc giải trình
  assets/js/importer.js    đọc file xlsb kế toán (chạy được cả Node để kiểm thử)
  assets/js/mock.js        backend giả cho chế độ demo (?demo=1)
  assets/js/data.js        tải + tổng hợp số liệu kỳ, bộ lọc chung
  assets/js/screens/*.js   tong-quan, giai-trinh, theo-sale, hang-vay, quan-tri
supabase/functions/debt-login, debt-api
sql/01_schema_app_debt.sql, sql/02_thang_du_kien.sql
```

## Chạy thử không cần máy chủ

```bash
python -m http.server 5178 --directory dashboard
```

Mở `http://localhost:5178/?demo=1`, đăng nhập `admin` (mật khẩu bất kỳ), vào **Quản trị** nạp file xlsb.
Sau đó đăng nhập `quanly`, `am_bac` / `am_nam` (area manager, giải trình) hoặc tên sale viết liền không dấu (ví dụ `nguyenthiduyen`, chỉ xem).
Dữ liệu demo chỉ nằm trong IndexedDB của trình duyệt.
