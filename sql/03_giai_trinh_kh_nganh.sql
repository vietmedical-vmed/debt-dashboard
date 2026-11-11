-- Đơn vị giải trình đổi từ kỳ × KH × sale sang kỳ × KH × ngành hàng (2026-11-11):
-- area manager giải trình 1 lần cho mỗi KH × ngành, không phân biệt sale.
-- Lúc áp, prod chưa có dòng giải trình nào; phần UPDATE dưới chỉ để chạy được nếu có.
begin;

alter table app_debt.giai_trinh add column if not exists nganh_hang text;
alter table app_debt.giai_trinh alter column ten_nv drop not null;  -- giờ chỉ lưu danh sách sale lúc lưu (tham khảo)

-- Dòng cũ (nếu có): lấy ngành hàng từ chi tiết công nợ của batch đang dùng.
update app_debt.giai_trinh g set nganh_hang = x.nganh_hang
from (
  select distinct on (c.ky, c.ma_kh, c.ten_nv) c.ky, c.ma_kh, c.ten_nv, c.nganh_hang
  from app_debt.cong_no c join app_debt.ky_bao_cao k on k.import_id = c.import_id and k.ky = c.ky
  order by c.ky, c.ma_kh, c.ten_nv, c.con_no desc
) x
where g.nganh_hang is null and x.ky = g.ky and x.ma_kh = g.ma_kh and x.ten_nv = g.ten_nv;
update app_debt.giai_trinh set nganh_hang = '(không rõ)' where nganh_hang is null;

alter table app_debt.giai_trinh alter column nganh_hang set not null;
alter table app_debt.giai_trinh drop constraint if exists giai_trinh_ky_ma_kh_ten_nv_key;
alter table app_debt.giai_trinh add constraint giai_trinh_ky_ma_kh_nganh_key unique (ky, ma_kh, nganh_hang);

commit;
