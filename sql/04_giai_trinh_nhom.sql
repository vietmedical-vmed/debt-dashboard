-- Tách giải trình theo người phụ trách (2026-11-11):
-- đơn vị = kỳ × KH × ngành hàng × nhóm giải trình.
--   nhom_gt = 'am:<username>'  : các sale do area manager đó phụ trách
--   nhom_gt = 'nv:<tên sale>'  : sale không có area manager (tự giải trình, hoặc admin/manager viết thay)
-- Lúc áp, prod chưa có dòng giải trình nào.
begin;

alter table app_debt.giai_trinh add column if not exists nhom_gt text not null default '';
alter table app_debt.giai_trinh drop constraint if exists giai_trinh_ky_ma_kh_nganh_key;
alter table app_debt.giai_trinh add constraint giai_trinh_ky_ma_kh_nganh_nhom_key unique (ky, ma_kh, nganh_hang, nhom_gt);

commit;
