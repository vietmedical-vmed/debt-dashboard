# Hướng dẫn triển khai & vận hành

## A. Triển khai lần đầu (admin, khoảng 30 phút)

### Bước 1 — Tạo schema trên Supabase
1. Mở Supabase project `nrfxymnfmjhbsgpipvkb` → **SQL Editor**.
2. Dán và chạy lần lượt [sql/01_schema_app_debt.sql](../sql/01_schema_app_debt.sql), [sql/02_thang_du_kien.sql](../sql/02_thang_du_kien.sql).
3. Chạy câu kiểm tra ở cuối file. Cả 3 cột phải là `false` (anon không đọc được dữ liệu công nợ).
4. **Settings → API → Exposed schemas**: thêm `app_debt`, bấm Save.

### Bước 2 — Deploy edge function
`TOKEN_SECRET` đã có sẵn (dùng chung với các app khác), không cần đặt lại.

```bash
supabase functions deploy debt-login --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
```

```bash
supabase functions deploy debt-api --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
```

Thiếu `--no-verify-jwt` thì đăng nhập được nhưng dữ liệu trống (cổng Supabase chặn 401).

### Bước 3 — Đưa frontend lên GitHub Pages
1. Tạo repo `vietmedical-vmed/debt-dashboard` (nên để **private** nếu gói GitHub cho phép Pages private).
2. Push code lên nhánh `main`. Workflow `.github/workflows/deploy-pages.yml` tự deploy thư mục `dashboard/`.
3. Repo → Settings → Pages → Source: **GitHub Actions**.
4. File Excel thật đã bị chặn bởi `.gitignore`; không commit dữ liệu công nợ vào repo.

### Bước 4 — Tài khoản & danh mục PS
Quyền đi theo `shared.dm_ps` (dùng chung với sale-target):
1. Mỗi sale trong file kế toán phải có dòng `dm_ps` với `ten_ps` đúng như tên trong file, `bu_code`, `area` (Miền Bắc/Trung/Nam).
2. Tài khoản sale (role `ps`): `users.scope` = `dm_ps.ps` → sale xem KH của mình.
3. Area manager (role `area_manager`): `users.bu` = BU (chcs/thnk/cttm, hoặc `all`), `users.scope` = miền phụ trách ("Miền Bắc, Miền Trung") → giải trình cho mọi PS cùng BU + miền.
4. Người duyệt: tài khoản `manager` (hoặc admin). Muốn chỉ định riêng cho một sale: màn Quản trị → cột "Người duyệt riêng".

### Bước 5 — Nạp kỳ đầu tiên
1. Đăng nhập admin → tab **Quản trị** → **Chọn file…** → chọn `KNK_Báo cáo công nợ T10.2026.xlsb`.
2. Kiểm bảng đối chiếu: mọi dòng phải "Khớp". Nếu "Lệch", hỏi lại kế toán trước khi nạp.
3. Bấm **Nạp lên hệ thống** (khoảng 15 lần gửi, dưới 1 phút).
4. Mục **Phân quyền theo danh mục PS**: kiểm dòng đỏ "Không có trong dm_ps" và "Chưa có area manager" — bổ sung `dm_ps` / `shared.users`, hoặc gắn tay.
5. Mục **Kỳ báo cáo**: đặt **Hạn giải trình**.

## B. Quy trình hằng tháng

| Ngày | Ai | Việc |
|---|---|---|
| Kế toán gửi file | Admin | Quản trị → nạp file → kiểm đối chiếu → nạp. Đặt hạn giải trình (ví dụ +7 ngày). Gắn tài khoản cho sale mới nếu có. |
| Ngay sau đó | Admin | Gửi link app cho area manager và sale (email/Zalo nhóm). |
| Trong hạn | Area manager | Tab **Giải trình** → bấm từng KH "Chưa giải trình" → ghi giải trình & kế hoạch xử lý, chọn tháng dự kiến thu (yyyy-mm) → **Gửi duyệt**. Từ kỳ thứ 2, nội dung tự điền sẵn từ kỳ trước, tháng phải chọn lại. Sale vào xem phần của mình. |
| Trong hạn | Quản lý | Tab **Giải trình** → lọc **Chờ duyệt** → **Duyệt** hoặc **Trả lại** kèm nhận xét. Sale sửa và gửi lại. |
| Hết hạn | Quản lý | Tab **Theo sale**: ai chưa xong, bao nhiêu KH hẹn thu kỳ trước đã có tiền về. **Xuất Excel** danh sách giải trình để báo cáo. |
| Chốt | Admin | Quản trị → tick **Khoá** kỳ. Không ai sửa/duyệt được nữa. |

## C. Thay đổi thường gặp

- **Bắt buộc giải trình cả A1**: sửa `NHOM_GIAI_TRINH` trong `config.js` **và** hằng `QUA_HAN` trong `supabase/functions/debt-api/index.ts`, rồi deploy lại `debt-api`.
- Mỗi lần sửa file JS: đổi `?v=` trong `dashboard/index.html` để trình duyệt không dùng bản cũ.
- Sửa `supabase/functions/*`: phải deploy tay (push GitHub không deploy edge function).

## D. Kế toán đổi mẫu file

Bộ đọc dò cột theo **tên tiêu đề**, không theo vị trí. Đổi thứ tự cột không sao.
Các tên bắt buộc giữ nguyên:
- Sheet `BC công nợ - NK`: ô "Tháng báo cáo", "Tháng trước", "Ngày báo cáo:", mục "I. Biến động…", dòng "Tổng dư nợ tháng báo cáo".
- Sheet `Dulieutong`: Mã KH, Tên KH, Tên NV, Còn nợ, Nhóm công nợ, Ngành hàng, Tháng báo cáo, Số ngày quá hạn, CN nhóm B, Không lên báo cáo công nợ (x).
- Sheet `Công nợ hàng vay`: Chứng từ, Đối tượng, Tổng giá trị, Tên nhân viên.
- Sheet `Data thu tiền`: Mã KH, Tên nhân viên, Tháng thanh toán, Phân loại, Số tiền (cột thứ 2).

Đổi tên các cột này thì sửa `dashboard/assets/js/importer.js`.

## E. Quy ước số liệu

- "Dư nợ chưa có BBBG/ĐCCN" = dòng có cột *CN nhóm B* = x, **chưa gồm CTTM** (giống báo cáo kế toán).
- Dòng *Không lên báo cáo công nợ* = x bị loại khỏi mọi số.
- "Thu trong tháng" = tổng sheet *Data thu tiền*, phân loại "Thanh toán", tháng thanh toán = kỳ báo cáo.
- "Hẹn thu kỳ trước" = số KH mà giải trình kỳ trước có tháng dự kiến thu ≤ kỳ này; "Đã có thu" = số KH đó có tiền về trong tháng.
