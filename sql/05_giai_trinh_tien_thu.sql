-- Lưu tổng tiền dự kiến thu theo các hóa đơn đã tích chọn trong popup giải trình (2026-11-17).
--   hd_chon          : danh sách khoá hóa đơn đã chọn ("số HĐ|ngày HĐ|ngày đến hạn", trùng thì thêm "#n")
--   so_tien_du_kien  : tổng còn nợ của các hóa đơn đó lúc lưu (VND), do debt-api tự cộng
-- Chạy TRƯỚC khi deploy debt-api bản mới (bản mới ghi 2 cột này khi lưu giải trình).
begin;

alter table app_debt.giai_trinh add column if not exists so_tien_du_kien numeric;
alter table app_debt.giai_trinh add column if not exists hd_chon jsonb;

commit;
