-- Giải trình theo từng nhóm nợ trong cùng 1 đơn vị KH × ngành × người giải trình (2026-11-17).
--   theo_nhom = { "A4": { ke_hoach, thang_du_kien, hd_chon, so_tien }, "A2": {...}, "A1": {...} }
-- Các cột ke_hoach / thang_du_kien / hd_chon / so_tien_du_kien vẫn được ghi (gộp các nhóm, tháng sớm nhất, tổng tiền)
-- để báo cáo / màn cũ dùng tiếp. Giải trình lưu trước đó (theo_nhom = null) vẫn hiện như cũ.
-- Chạy TRƯỚC khi deploy debt-api bản mới.
begin;

alter table app_debt.giai_trinh add column if not exists theo_nhom jsonb;

commit;
