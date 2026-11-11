-- Schema app_debt: dashboard công nợ Khối Ngoại khoa + giải trình của sale.
-- Cùng Supabase project nrfxymnfmjhbsgpipvkb với các app khác; đăng nhập dùng shared.users.
-- Chạy 1 lần trong SQL Editor. Sau đó thêm "app_debt" vào Settings → API → Exposed schemas.
--
-- Mọi truy cập đi qua edge function debt-api (service_role). anon/authenticated KHÔNG có quyền.

begin;

create schema if not exists app_debt;
grant usage on schema app_debt to service_role;

-- 1 lần nạp file = 1 batch. Kỳ báo cáo trỏ tới batch đang dùng → nạp lại không làm mất dữ liệu
-- giữa chừng: batch mới chỉ có hiệu lực khi commit thành công.
create table if not exists app_debt.import_batch (
  id          uuid primary key default gen_random_uuid(),
  ky          text not null check (ky ~ '^\d{4}-\d{2}$'),
  file_name   text,
  trang_thai  text not null default 'dang_nap' check (trang_thai in ('dang_nap', 'xong', 'huy')),
  so_dong     jsonb,
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists app_debt.ky_bao_cao (
  ky              text primary key check (ky ~ '^\d{4}-\d{2}$'),
  ky_truoc        text,
  ngay_bao_cao    date,
  han_giai_trinh  date,
  khoa            boolean not null default false,
  import_id       uuid references app_debt.import_batch(id),
  bien_dong       jsonb,          -- mục I sheet BC (triệu đồng)
  doi_chieu       jsonb,          -- số tổng sheet BC + số tính lại từ chi tiết
  imported_by     text,
  imported_at     timestamptz,
  updated_at      timestamptz not null default now()
);

-- Chi tiết hóa đơn (sheet Dulieutong). Mỗi batch chứa cả kỳ báo cáo và kỳ trước của cùng file,
-- để so sánh đúng số kế toán đã chốt trong file đó.
create table if not exists app_debt.cong_no (
  id               bigserial primary key,
  import_id        uuid not null references app_debt.import_batch(id) on delete cascade,
  ky               text not null,
  loai_hinh        text,
  khu_vuc          text,
  ma_kh            text not null,
  ten_kh           text,
  ten_nv           text not null,
  gia_tri_hd       numeric,
  da_thanh_toan    numeric,
  con_no           numeric not null default 0,
  ngay_hd          date,
  so_hd            text,
  ngay_hop_dong    date,
  so_hop_dong      text,
  lan_tt           text,
  so_ngay_den_han  int,
  ngay_den_han     date,
  so_ngay_qua_han  int,
  khay             text,
  nganh_hang       text,
  bu               text,
  nhom_no          text,
  khong_chung_tu   boolean not null default false,  -- cột "CN nhóm B" = x
  hop_dong_ban     text,
  bbbg             text,
  bb_doi_chieu     text,
  ghi_chu          text,
  note             text,
  loai_tru         boolean not null default false   -- "Không lên báo cáo công nợ (x)"
);
create index if not exists cong_no_import_ky_idx on app_debt.cong_no (import_id, ky);
create index if not exists cong_no_kh_idx on app_debt.cong_no (import_id, ma_kh, ten_nv);

create table if not exists app_debt.hang_vay (
  id          bigserial primary key,
  import_id   uuid not null references app_debt.import_batch(id) on delete cascade,
  khay        text,
  thang_xuat  text,
  chung_tu    text,
  ma_kh       text,
  ten_kh      text,
  ma_hang     text,
  ten_hang    text,
  dvt         text,
  sl          numeric,
  don_gia     numeric,
  gia_tri     numeric not null default 0,
  ten_nv      text not null,
  nganh_hang  text,
  bu          text,
  ghi_chu     text
);
create index if not exists hang_vay_import_idx on app_debt.hang_vay (import_id);

-- Tổng thu trong tháng báo cáo theo KH × NV × ngành (sheet Data thu tiền).
create table if not exists app_debt.thu_tien (
  id          bigserial primary key,
  import_id   uuid not null references app_debt.import_batch(id) on delete cascade,
  ky          text not null,
  ma_kh       text not null,
  ten_kh      text,
  ten_nv      text not null,
  nganh_hang  text,
  bu          text,
  so_tien     numeric not null default 0,
  so_ct       int
);
create index if not exists thu_tien_import_idx on app_debt.thu_tien (import_id);

-- Gắn tên NV trong file kế toán với tài khoản shared.users + người duyệt.
create table if not exists app_debt.sale_map (
  ten_nv       text primary key,
  username     text,          -- tài khoản của sale (shared.users.username)
  nguoi_duyet  text,          -- tài khoản quản lý duyệt giải trình
  ghi_chu      text,
  updated_by   text,
  updated_at   timestamptz not null default now()
);

-- Giải trình: 1 dòng / kỳ × khách hàng × sale.
create table if not exists app_debt.giai_trinh (
  id               bigserial primary key,
  ky               text not null,
  ma_kh            text not null,
  ten_nv           text not null,
  ten_kh           text,
  du_no_qua_han    numeric,       -- A2–A4 tại thời điểm gửi (VND)
  nguyen_nhan      text,
  chi_tiet         text,
  ke_hoach         text,
  ngay_du_kien     date,
  so_tien_du_kien  numeric,
  trang_thai       text not null default 'nhap' check (trang_thai in ('nhap', 'cho_duyet', 'da_duyet', 'tra_lai')),
  nhan_xet         text,
  nguoi_cap_nhat   text,
  cap_nhat_luc     timestamptz not null default now(),
  nguoi_gui        text,
  gui_luc          timestamptz,
  nguoi_duyet      text,
  duyet_luc        timestamptz,
  unique (ky, ma_kh, ten_nv)
);
create index if not exists giai_trinh_ky_idx on app_debt.giai_trinh (ky);

create table if not exists app_debt.giai_trinh_log (
  id             bigserial primary key,
  giai_trinh_id  bigint not null references app_debt.giai_trinh(id) on delete cascade,
  hanh_dong      text not null,   -- luu | gui | duyet | tra_lai
  noi_dung       jsonb,
  nguoi          text,
  luc            timestamptz not null default now()
);
create index if not exists giai_trinh_log_gt_idx on app_debt.giai_trinh_log (giai_trinh_id);

-- Tổng hợp theo KH × NV × ngành × nhóm nợ cho mọi kỳ có trong batch. Dashboard đọc view này.
create or replace view app_debt.v_cong_no_agg as
select c.import_id, c.ky, c.ma_kh, max(c.ten_kh) as ten_kh, c.ten_nv, c.nganh_hang, c.bu,
       max(c.loai_hinh) as loai_hinh, max(c.khu_vuc) as khu_vuc, c.nhom_no, c.khong_chung_tu,
       sum(c.con_no) as con_no, count(*)::int as so_hd, max(c.so_ngay_qua_han) as max_ngay_qua_han
from app_debt.cong_no c
where not c.loai_tru
group by c.import_id, c.ky, c.ma_kh, c.ten_nv, c.nganh_hang, c.bu, c.nhom_no, c.khong_chung_tu;

-- Quyền: chỉ service_role (edge function). Bật RLS, không policy → anon/authenticated bị chặn.
do $$
declare t text;
begin
  foreach t in array array['import_batch','ky_bao_cao','cong_no','hang_vay','thu_tien','sale_map','giai_trinh','giai_trinh_log'] loop
    execute format('alter table app_debt.%I enable row level security', t);
    execute format('revoke all on app_debt.%I from public, anon, authenticated', t);
    execute format('grant all on app_debt.%I to service_role', t);
  end loop;
end $$;
revoke all on app_debt.v_cong_no_agg from public, anon, authenticated;
grant select on app_debt.v_cong_no_agg to service_role;
alter view app_debt.v_cong_no_agg set (security_invoker = true);
grant usage, select on all sequences in schema app_debt to service_role;
alter default privileges in schema app_debt revoke all on tables from public, anon, authenticated;

commit;

-- Kiểm tra sau khi chạy (phải trả false hết):
-- select has_table_privilege('anon', 'app_debt.cong_no', 'select'),
--        has_table_privilege('anon', 'app_debt.giai_trinh', 'select'),
--        has_table_privilege('anon', 'app_debt.v_cong_no_agg', 'select');
