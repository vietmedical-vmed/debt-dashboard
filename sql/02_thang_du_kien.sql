-- Form giải trình rút gọn (2026-11-11): chỉ còn "Giải trình & kế hoạch xử lý" + "Tháng dự kiến thu" (yyyy-mm).
-- Cột cũ (nguyen_nhan, chi_tiet, ngay_du_kien, so_tien_du_kien) giữ lại, không còn dùng.
alter table app_debt.giai_trinh
  add column if not exists thang_du_kien text check (thang_du_kien ~ '^\d{4}-(0[1-9]|1[0-2])$');
