// Supabase Edge Function: debt-api
// Verify token HMAC (do debt-login phát) rồi dispatch theo `action`. Body: { action, token, payload }.
//
// Deploy:
//   supabase functions deploy debt-api --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
//
// Phân quyền (role lấy từ shared.users, nằm trong token). Tên NV trong file kế toán = shared.dm_ps.ten_ps.
//   admin            : xem tất cả, nạp file, cấu hình, duyệt tất cả, sửa giải trình mọi KH
//   manager          : xem tất cả, duyệt tất cả
//   area_manager     : NGƯỜI GIẢI TRÌNH CHÍNH — xem + giải trình KH của các PS mình phụ trách
//                      (dm_ps cùng bu_code với users.bu, area thuộc users.scope / users.mien)
//   product_manager  : xem theo ngành hàng (users.bu: chcs/thnk/cttm, "all" = tất cả)
//   ps (và role khác): chỉ xem KH của mình — dm_ps.ps = users.scope (hoặc username), hoặc dm_ps.ten_ps = họ tên
// sale_map (màn Quản trị) bổ sung: gắn tay tài khoản cho tên NV không có trong dm_ps; chỉ định người duyệt riêng.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

// ─── Token ─────────────────────────────────────────────────────────────
const enc = new TextEncoder();
function b64urlDecode(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
type Session = { username: string; ho_ten: string; role: string; bu: string; mien: string; scope: string; exp: number };
async function verifyToken(token: string, secret: string): Promise<Session | null> {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [p, sig] = token.split(".");
  if (!timingSafeEqual(b64url(await hmac(secret, p)), sig || "")) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as Session;
    return s.exp && s.exp >= Math.floor(Date.now() / 1000) ? s : null;
  } catch { return null; }
}

// ─── Quyền ─────────────────────────────────────────────────────────────
type SaleMap = { ten_nv: string; username: string | null; nguoi_duyet: string | null };
type Perm = {
  role: string;
  all: boolean;               // xem tất cả
  bu: string[] | null;        // ngành hàng được xem (product_manager; null = không theo ngành)
  amNv: Set<string>;          // area_manager: tên PS phụ trách (chuẩn hoá) — xem + giải trình
  myNv: Set<string>;          // tên NV = chính mình (dm_ps hoặc gắn tay ở sale_map)
  selfNv: Set<string>;        // tên NV của mình mà không có area manager phụ trách → tự giải trình
  approveNv: Set<string>;     // tên NV mình là người duyệt (gán ở sale_map)
  canImport: boolean;
  approveAll: boolean;
  noAccess: boolean;
};

const normName = (s: unknown) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const MIEN_CODE: Record<string, string[]> = {
  MB: ["Miền Bắc"], MN: ["Miền Nam"], MT: ["Miền Trung"], BOTH: ["Miền Bắc", "Miền Trung", "Miền Nam"], ALL: ["Miền Bắc", "Miền Trung", "Miền Nam"],
};
const MIEN_NAMES = ["Miền Bắc", "Miền Trung", "Miền Nam"];

// Miền area_manager phụ trách: users.scope ("Miền Bắc, Miền Trung"); nếu scope không phải tên miền thì lấy users.mien (MB/MN/BOTH).
function mienOfManager(s: Session): string[] {
  const fromScope = String(s.scope || "").split(/[,;|]/).map((x) => x.normalize("NFC").trim()).filter((x) => MIEN_NAMES.includes(x));
  if (fromScope.length) return fromScope;
  const out = new Set<string>();
  for (const c of String(s.mien || "").split(/[,;|]/).map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    for (const m of MIEN_CODE[c] ?? []) out.add(m);
  }
  return [...out];
}

type PsRow = { ps: string | null; ten_ps: string | null; bu: string | null; bu_code: string | null; team: string | null; area: string | null; trang_thai?: string | null };

// "CHCS 1 Miền Nam" / "CHCS 1 MN" → "chcs1mn" để khớp tên tài khoản với tên team.
const compact = (v: unknown) => normName(v).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
  .replace(/mien bac/g, "mb").replace(/mien nam/g, "mn").replace(/mien trung/g, "mt").replace(/[^a-z0-9]/g, "");

type AmUser = { username: string; scope?: string | null; mien?: string | null; bu?: string | null; ho_ten?: string | null };
// PS mà 1 area manager phụ trách (tên đã chuẩn hoá):
//   - dm_ps cùng BU (users.bu) và thuộc miền phụ trách (users.scope / users.mien);
//   - nếu trong miền đó BU có > 1 team đang Active (vd CH&CS Miền Nam: CHCS 1 MN, CHCS 2 MN) thì chỉ lấy team của AM:
//     team trên dòng dm_ps của chính AM, nếu không có thì team trùng tên tài khoản (vd "CHCS 1 Miền Nam" ↔ "CHCS 1 MN").
//     Không xác định được team → không phụ trách PS nào ở miền đó (màn Quản trị báo "Chưa có area manager").
function managedPs(dir: PsRow[], u: AmUser): Set<string> {
  const bus = String(u.bu || "").split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const own = psOfUser(dir, { username: u.username, scope: u.scope, ho_ten: u.ho_ten });
  const keys = [compact(u.ho_ten), compact(u.username)].filter(Boolean);
  const out = new Set<string>();
  for (const m of mienOfManager({ scope: u.scope, mien: u.mien } as Session)) {
    const rows = dir.filter((p) => (bus.includes("all") || bus.includes(String(p.bu_code || "").toLowerCase()))
      && String(p.area || "").normalize("NFC").trim() === m);
    const active = rows.filter((p) => String(p.trang_thai || "").toLowerCase() === "active");
    const teams = new Set((active.length ? active : rows).map((p) => String(p.team || "")));
    let allowed: Set<string> | null = null;
    if (teams.size > 1) {
      allowed = new Set(own.filter((p) => rows.includes(p)).map((p) => String(p.team || "")));
      if (!allowed.size) for (const t of teams) if (keys.includes(compact(t))) allowed.add(t);
    }
    for (const p of rows) if (p.ten_ps && (!allowed || allowed.has(String(p.team || "")))) out.add(normName(p.ten_ps));
  }
  return out;
}
// Tài khoản ↔ PS: dm_ps.ps = users.scope (chuẩn sale-target) hoặc = username, hoặc dm_ps.ten_ps = họ tên.
function psOfUser(dir: PsRow[], u: { username: string; scope?: string | null; ho_ten?: string | null }) {
  const keys = new Set([normName(u.scope), normName(u.username)].filter(Boolean));
  const hoTen = normName(u.ho_ten);
  return dir.filter((p) => keys.has(normName(p.ps)) || (!!hoTen && normName(p.ten_ps) === hoTen));
}

// Tài khoản area_manager không còn dùng — không tham gia phân quyền giải trình.
const AM_EXCLUDE = new Set(["thnk_manager"]);

type AmRow = { username: string; role: string; bu: string | null; scope: string | null; mien: string | null; ho_va_ten: string | null; active: boolean | null };
async function loadAms(db: SupabaseClient): Promise<AmRow[]> {
  const { data, error } = await db.schema("shared").from("users")
    .select("username, role, bu, scope, mien, ho_va_ten, active").eq("role", "area_manager");
  if (error) throw new Error(error.message);
  return ((data ?? []) as AmRow[]).filter((u) => u.active !== false && !AM_EXCLUDE.has(u.username));
}
// Tên PS (chuẩn hoá) → danh sách AM phụ trách.
function amCoverage(dir: PsRow[], ams: AmRow[]) {
  const cov = new Map<string, string[]>();
  for (const u of ams) {
    for (const k of managedPs(dir, { username: u.username, scope: u.scope, mien: u.mien, bu: u.bu, ho_ten: u.ho_va_ten })) {
      cov.set(k, [...(cov.get(k) ?? []), u.username]);
    }
  }
  return cov;
}

async function getPerm(db: SupabaseClient, s: Session): Promise<{ perm: Perm; map: SaleMap[]; dir: PsRow[] }> {
  const [{ data, error }, { data: dirData, error: e2 }] = await Promise.all([
    db.schema("app_debt").from("sale_map").select("ten_nv, username, nguoi_duyet"),
    db.schema("shared").from("dm_ps").select("ps, ten_ps, bu, bu_code, team, area, trang_thai"),
  ]);
  if (error) throw new Error(error.message);
  if (e2) throw new Error(e2.message);
  const map = (data ?? []) as SaleMap[];
  const dir = (dirData ?? []) as PsRow[];
  const role = (s.role || "").toLowerCase();
  const me = s.username;
  const buList = String(s.bu || "").split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const perm: Perm = {
    role,
    all: role === "admin" || role === "manager",
    bu: null,
    amNv: new Set(),
    myNv: new Set([
      ...map.filter((m) => m.username === me).map((m) => normName(m.ten_nv)),
      ...psOfUser(dir, { username: me, scope: s.scope, ho_ten: s.ho_ten }).map((p) => normName(p.ten_ps)),
    ].filter(Boolean)),
    approveNv: new Set(map.filter((m) => m.nguoi_duyet === me).map((m) => normName(m.ten_nv))),
    selfNv: new Set(),
    canImport: role === "admin",
    approveAll: role === "admin" || role === "manager",
    noAccess: role === "purchasing",
  };
  if (role === "product_manager") {
    if (!buList.length || buList.includes("all")) perm.all = true;
    else perm.bu = buList;
  }
  if (role === "area_manager" && !AM_EXCLUDE.has(me)) {
    perm.amNv = managedPs(dir, { username: me, scope: s.scope, mien: s.mien, bu: s.bu, ho_ten: s.ho_ten });
  }
  // Sale không có area manager phụ trách (vd CTTM Miền Nam) thì tự giải trình KH của mình.
  if (perm.myNv.size) {
    const cov = amCoverage(dir, await loadAms(db));
    for (const n of perm.myNv) if (!cov.has(n)) perm.selfNv.add(n);
  }
  return { perm, map, dir };
}

function canSee(p: Perm, row: { bu?: string | null; ten_nv: string }) {
  if (p.noAccess) return false;
  if (p.all) return true;
  if (p.bu && row.bu && p.bu.includes(row.bu)) return true;
  const n = normName(row.ten_nv);
  return p.amNv.has(n) || p.myNv.has(n) || p.approveNv.has(n);
}

// Người giải trình: admin, manager (mọi KH); area_manager phụ trách PS đó; sale tự giải trình nếu không có AM.
function canEdit(p: Perm, tenNv: string) {
  if (p.role === "admin" || p.role === "manager") return true;
  const n = normName(tenNv);
  return p.amNv.has(n) || p.selfNv.has(n);
}

// Người duyệt: admin, manager, hoặc người được chỉ định ở sale_map.
function canApprove(p: Perm, tenNv: string) {
  return p.approveAll || p.approveNv.has(normName(tenNv));
}

// ─── Utils ─────────────────────────────────────────────────────────────
async function fetchAll(build: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}
const KY_RE = /^\d{4}-\d{2}$/;
const needKy = (ky: unknown) => { if (typeof ky !== "string" || !KY_RE.test(ky)) throw new HttpError("bad_ky"); return ky; };
const str = (v: unknown, max = 2000) => (v == null || v === "" ? null : String(v).slice(0, max));
const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const QUA_HAN = ["A2", "A3", "A4"];
// Tạm tắt luồng phê duyệt (2026-11-11): lưu giải trình = "Đã giải trình", sửa lại được tới khi khoá kỳ.
// Bật lại: đặt true + đổi PHE_DUYET trong dashboard/assets/js/config.js.
const PHE_DUYET = false;

async function getKyRow(db: SupabaseClient, ky: string) {
  const { data, error } = await db.schema("app_debt").from("ky_bao_cao").select("*").eq("ky", ky).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Cột được phép ghi khi nạp file (chống client gửi cột lạ).
const COLS: Record<string, string[]> = {
  cong_no: ["ky", "loai_hinh", "khu_vuc", "ma_kh", "ten_kh", "ten_nv", "gia_tri_hd", "da_thanh_toan", "con_no", "ngay_hd", "so_hd",
    "ngay_hop_dong", "so_hop_dong", "lan_tt", "so_ngay_den_han", "ngay_den_han", "so_ngay_qua_han", "khay", "nganh_hang", "bu",
    "nhom_no", "khong_chung_tu", "hop_dong_ban", "bbbg", "bb_doi_chieu", "ghi_chu", "note", "loai_tru"],
  hang_vay: ["khay", "thang_xuat", "chung_tu", "ma_kh", "ten_kh", "ma_hang", "ten_hang", "dvt", "sl", "don_gia", "gia_tri", "ten_nv",
    "nganh_hang", "bu", "ghi_chu"],
  thu_tien: ["ky", "ma_kh", "ten_kh", "ten_nv", "nganh_hang", "bu", "so_tien", "so_ct"],
};

// ─── Tên khách hàng hiển thị = shared.dm_khach_hang.customer_alias (join customer_id = mã KH) ───
async function aliasById(db: SupabaseClient, ids: string[]) {
  const out = new Map<string, string>();
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await db.schema("shared").from("dm_khach_hang")
      .select("customer_id, customer_alias").in("customer_id", list.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const d of data ?? []) if (d.customer_alias && String(d.customer_alias).trim()) out.set(d.customer_id, String(d.customer_alias).trim());
  }
  return out;
}
// Hàng vay không có mã KH: khớp tên với dòng công nợ cùng kỳ (→ mã KH), không được thì khớp customer_name.
async function aliasByName(db: SupabaseClient, names: string[]) {
  const out = new Map<string, string>();
  const list = [...new Set(names.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await db.schema("shared").from("dm_khach_hang")
      .select("customer_name, customer_alias").in("customer_name", list.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const d of data ?? []) {
      const k = normName(d.customer_name);
      if (d.customer_alias && String(d.customer_alias).trim() && !out.has(k)) out.set(k, String(d.customer_alias).trim());
    }
  }
  return out;
}

// ─── Đơn vị giải trình: kỳ × KH × ngành hàng (không phân biệt sale) ───
const pairKey = (ma: unknown, nganh: unknown) => String(ma ?? "") + "\u0001" + String(nganh ?? "");
// Người giải trình của 1 cặp KH × ngành: admin, manager; area manager phụ trách bất kỳ sale nào trong cặp;
// sale tự giải trình (PS không có AM) nếu chính mình có trong cặp.
function canEditPair(p: Perm, nvs: Iterable<string>) {
  if (p.role === "admin" || p.role === "manager") return true;
  for (const nv of nvs) { const n = normName(nv); if (p.amNv.has(n) || p.selfNv.has(n)) return true; }
  return false;
}
// Xem trọn cặp (mọi sale) hay chỉ phần của mình.
function seeFullPair(p: Perm, nvs: Iterable<string>, bus: Iterable<string>) {
  if (p.all) return true;
  for (const b of bus) if (p.bu && b && p.bu.includes(b)) return true;
  for (const nv of nvs) if (p.amNv.has(normName(nv))) return true;
  return false;
}
async function pairRows(db: SupabaseClient, importId: string, ky: string, ma: string, nganh: string, cols: string, onlyQuaHan: boolean) {
  return await fetchAll((a, b) => {
    let q = db.schema("app_debt").from("cong_no").select(cols)
      .eq("import_id", importId).eq("ky", ky).eq("ma_kh", ma).eq("nganh_hang", nganh).eq("loai_tru", false);
    if (onlyQuaHan) q = q.in("nhom_no", QUA_HAN);
    return q.order("so_ngay_qua_han", { ascending: false }).order("id").range(a, b);
  });
}

// ─── Actions ───────────────────────────────────────────────────────────
async function handle(db: SupabaseClient, s: Session, action: string, p: any) {
  const { perm, dir } = await getPerm(db, s);
  if (perm.noAccess) throw new HttpError("forbidden", 403);
  const D = () => db.schema("app_debt");

  switch (action) {
    case "whoami":
      return {
        user: { username: s.username, ho_ten: s.ho_ten, role: s.role, bu: s.bu, mien: s.mien },
        permission: { all: perm.all, bu: perm.bu, giaiTrinh: perm.amNv.size > 0 || perm.selfNv.size > 0 || perm.all, canImport: perm.canImport, approveAll: perm.approveAll },
      };

    case "list_ky": {
      const { data, error } = await D().from("ky_bao_cao")
        .select("ky, ky_truoc, ngay_bao_cao, han_giai_trinh, khoa, bien_dong, doi_chieu, imported_at, imported_by")
        .not("import_id", "is", null).order("ky", { ascending: false });
      if (error) throw new Error(error.message);
      // Số tổng toàn khối (mục I, đối chiếu) chỉ cho người xem được tất cả.
      return { rows: (data ?? []).map((k) => (perm.all ? k : { ...k, bien_dong: null, doi_chieu: null })) };
    }

    // Toàn bộ số liệu tổng hợp của 1 kỳ (đã lọc theo quyền). Client tự dựng các bảng/biểu đồ.
    case "get_ky": {
      const ky = needKy(p.ky);
      const meta = await getKyRow(db, ky);
      if (!meta || !meta.import_id) throw new HttpError("not_found", 404);
      const kys = [ky, meta.ky_truoc].filter(Boolean);
      const [agg, hv, tt, gt] = await Promise.all([
        fetchAll((a, b) => D().from("v_cong_no_agg").select("ky, ma_kh, ten_kh, ten_nv, nganh_hang, bu, loai_hinh, khu_vuc, nhom_no, khong_chung_tu, con_no, so_hd, max_ngay_qua_han")
          .eq("import_id", meta.import_id).in("ky", kys).order("ky").order("ma_kh").order("ten_nv").order("nganh_hang").order("nhom_no").order("khong_chung_tu").range(a, b)),
        fetchAll((a, b) => D().from("hang_vay").select("thang_xuat, chung_tu, ma_kh, ten_kh, ma_hang, ten_hang, dvt, sl, don_gia, gia_tri, ten_nv, nganh_hang, bu, ghi_chu")
          .eq("import_id", meta.import_id).order("id").range(a, b)),
        fetchAll((a, b) => D().from("thu_tien").select("ky, ma_kh, ten_kh, ten_nv, nganh_hang, bu, so_tien, so_ct")
          .eq("import_id", meta.import_id).order("id").range(a, b)),
        fetchAll((a, b) => D().from("giai_trinh").select("*").in("ky", kys).order("id").range(a, b)),
      ]);
      // Đổi tên KH sang customer_alias (giữ tên kế toán ở ten_kh_goc).
      const alias = await aliasById(db, [...agg.map((r) => r.ma_kh), ...tt.map((r) => r.ma_kh), ...hv.map((r) => r.ma_kh)]);
      const idByName = new Map<string, string>();
      for (const r of agg) if (r.ten_kh) idByName.set(normName(r.ten_kh), r.ma_kh);
      const hvNames = hv.filter((r) => !(r.ma_kh && alias.has(r.ma_kh)) && !alias.has(idByName.get(normName(r.ten_kh)) ?? "")).map((r) => r.ten_kh);
      const aliasName = hvNames.length ? await aliasByName(db, hvNames) : new Map<string, string>();
      const withAlias = (r: any) => ({ ...r, ten_kh_goc: r.ten_kh, ten_kh: (r.ma_kh && alias.get(r.ma_kh)) || r.ten_kh });
      for (let i = 0; i < agg.length; i++) agg[i] = withAlias(agg[i]);
      for (let i = 0; i < tt.length; i++) tt[i] = withAlias(tt[i]);
      for (let i = 0; i < gt.length; i++) gt[i] = withAlias(gt[i]);
      for (let i = 0; i < hv.length; i++) {
        const r = hv[i];
        const id = r.ma_kh || idByName.get(normName(r.ten_kh));
        hv[i] = { ...r, ten_kh_goc: r.ten_kh, ten_kh: (id && alias.get(id)) || aliasName.get(normName(r.ten_kh)) || r.ten_kh };
      }
      // Cặp KH × ngành → các sale / BU có trong cặp (cả kỳ này và kỳ trước).
      const pairNv = new Map<string, Set<string>>(), pairBu = new Map<string, Set<string>>();
      for (const r of agg) {
        const k = pairKey(r.ma_kh, r.nganh_hang);
        if (!pairNv.has(k)) { pairNv.set(k, new Set()); pairBu.set(k, new Set()); }
        pairNv.get(k)!.add(r.ten_nv); if (r.bu) pairBu.get(k)!.add(r.bu);
      }
      // Area manager thấy trọn cặp KH × ngành nếu phụ trách ít nhất 1 sale trong cặp.
      const seeRow = (r: any) => canSee(perm, r) || (perm.amNv.size > 0 && seeFullPair(perm, pairNv.get(pairKey(r.ma_kh, r.nganh_hang)) ?? [], []));
      const aggV = agg.filter(seeRow);
      const visiblePairs = new Set(aggV.map((r) => pairKey(r.ma_kh, r.nganh_hang)));
      return {
        meta: perm.all ? meta : { ...meta, bien_dong: null, doi_chieu: null },
        agg: aggV,
        hang_vay: hv.filter((r) => canSee(perm, r)),
        thu_tien: tt.filter(seeRow),
        giai_trinh: gt.filter((r) => visiblePairs.has(pairKey(r.ma_kh, r.nganh_hang))),
        // null = sửa được tất cả (admin, manager); còn lại: danh sách khoá cặp "ma_kh\u0001ngành"
        can_edit_keys: perm.role === "admin" || perm.role === "manager" ? null
          : [...visiblePairs].filter((k) => canEditPair(perm, pairNv.get(k) ?? [])),
        phe_duyet: PHE_DUYET,
        // BU / team của từng tên NV theo dm_ps (cho bảng tổng hợp theo team)
        ps_dir: [...new Set([...aggV, ...hv.filter((r) => canSee(perm, r))].map((r) => r.ten_nv))].map((nv) => {
          const d = dir.find((x) => normName(x.ten_ps) === normName(nv));
          return { ten_nv: nv, bu: d?.bu ?? null, bu_code: d?.bu_code ?? null, team: d?.team ?? null, area: d?.area ?? null };
        }),
      };
    }

    // Chi tiết hóa đơn A2–A4 của 1 KH × ngành + lịch sử giải trình các kỳ.
    case "get_kh": {
      const ky = needKy(p.ky);
      const ma = String(p.ma_kh || ""), nganh = String(p.nganh_hang || "");
      const meta = await getKyRow(db, ky);
      if (!meta?.import_id) throw new HttpError("not_found", 404);
      const rows = await pairRows(db, meta.import_id, ky, ma, nganh,
        "ten_nv, so_hd, ngay_hd, ngay_den_han, so_ngay_qua_han, nhom_no, nganh_hang, bu, gia_tri_hd, da_thanh_toan, con_no, so_hop_dong, bbbg, hop_dong_ban, khong_chung_tu, ghi_chu, note", true);
      const nvs = [...new Set(rows.map((r) => r.ten_nv))];
      const full = seeFullPair(perm, nvs, rows.map((r) => r.bu));
      const visible = full ? rows : rows.filter((r) => canSee(perm, r));
      if (!visible.length) throw new HttpError("forbidden", 403);
      const { data: hist, error } = await D().from("giai_trinh").select("*").eq("ma_kh", ma).eq("nganh_hang", nganh).order("ky", { ascending: false });
      if (error) throw new Error(error.message);
      const ids = (hist ?? []).map((h) => h.id);
      const { data: logs } = ids.length
        ? await D().from("giai_trinh_log").select("*").in("giai_trinh_id", ids).order("luc", { ascending: false })
        : { data: [] };
      return { hoa_don: visible, lich_su: hist ?? [], log: logs ?? [] };
    }

    // Area manager (hoặc admin) lưu nháp / gửi duyệt.
    case "save_gt": {
      const ky = needKy(p.ky);
      const ma = String(p.ma_kh || ""), nganh = String(p.nganh_hang || "");
      if (!ma || !nganh) throw new HttpError("bad_payload");
      const meta = await getKyRow(db, ky);
      if (!meta?.import_id) throw new HttpError("not_found", 404);
      if (meta.khoa) throw new HttpError("ky_da_khoa");
      const all = await pairRows(db, meta.import_id, ky, ma, nganh, "ten_nv, nhom_no, con_no, ten_kh, so_ngay_qua_han", false);
      const nvs = [...new Set(all.map((r) => r.ten_nv))].sort();
      if (!canEditPair(perm, nvs)) throw new HttpError("forbidden", 403);

      const { data: cur } = await D().from("giai_trinh").select("*").eq("ky", ky).eq("ma_kh", ma).eq("nganh_hang", nganh).maybeSingle();
      if (PHE_DUYET && cur && !["nhap", "tra_lai"].includes(cur.trang_thai)) throw new HttpError("da_gui_khong_sua");

      const qh = all.filter((r) => QUA_HAN.includes(r.nhom_no));
      const duNo = qh.reduce((t, r) => t + Number(r.con_no || 0), 0);

      const submit = PHE_DUYET ? !!p.submit : true; // không duyệt: lưu = đã giải trình
      const f = p.fields || {};
      const rec: Record<string, unknown> = {
        ky, ma_kh: ma, nganh_hang: nganh, ten_nv: nvs.join(", "),
        ten_kh: str(f.ten_kh, 300) ?? all[0]?.ten_kh ?? cur?.ten_kh ?? null,
        du_no_qua_han: duNo,
        ke_hoach: str(f.ke_hoach),
        thang_du_kien: KY_RE.test(String(f.thang_du_kien || "")) && Number(String(f.thang_du_kien).slice(5)) >= 1 && Number(String(f.thang_du_kien).slice(5)) <= 12 ? String(f.thang_du_kien) : null,
        trang_thai: submit ? "cho_duyet" : "nhap",
        nguoi_cap_nhat: s.username,
        cap_nhat_luc: new Date().toISOString(),
      };
      if (submit) {
        const missing = ["ke_hoach", "thang_du_kien"].filter((k) => !rec[k]);
        if (missing.length) throw new HttpError("thieu_thong_tin:" + missing.join(","));
        rec.nguoi_gui = s.username;
        rec.gui_luc = new Date().toISOString();
      }
      const { data: saved, error } = await D().from("giai_trinh").upsert(rec, { onConflict: "ky,ma_kh,nganh_hang" }).select("*").single();
      if (error) throw new Error(error.message);
      await D().from("giai_trinh_log").insert({ giai_trinh_id: saved.id, hanh_dong: submit ? "gui" : "luu", noi_dung: rec, nguoi: s.username });
      return { row: saved };
    }

    // Quản lý duyệt / trả lại.
    case "review_gt": {
      if (!PHE_DUYET) throw new HttpError("phe_duyet_tat");
      const id = Number(p.id);
      const decision = p.decision === "duyet" ? "da_duyet" : p.decision === "tra_lai" ? "tra_lai" : null;
      if (!id || !decision) throw new HttpError("bad_payload");
      const { data: cur, error: e1 } = await D().from("giai_trinh").select("*").eq("id", id).maybeSingle();
      if (e1) throw new Error(e1.message);
      if (!cur) throw new HttpError("not_found", 404);
      const meta = await getKyRow(db, cur.ky);
      if (meta?.khoa) throw new HttpError("ky_da_khoa");
      if (!canApprove(perm, cur.ten_nv)) throw new HttpError("forbidden", 403);
      const ok = cur.trang_thai === "cho_duyet" || (cur.trang_thai === "da_duyet" && decision === "tra_lai");
      if (!ok) throw new HttpError("trang_thai_khong_hop_le");
      const nhanXet = str(p.nhan_xet);
      if (decision === "tra_lai" && !nhanXet) throw new HttpError("thieu_thong_tin:nhan_xet");
      const upd = { trang_thai: decision, nhan_xet: nhanXet, nguoi_duyet: s.username, duyet_luc: new Date().toISOString() };
      const { data: saved, error } = await D().from("giai_trinh").update(upd).eq("id", id).select("*").single();
      if (error) throw new Error(error.message);
      await D().from("giai_trinh_log").insert({ giai_trinh_id: id, hanh_dong: decision === "da_duyet" ? "duyet" : "tra_lai", noi_dung: upd, nguoi: s.username });
      return { row: saved };
    }

    // ── Nạp file (admin) ──
    // Trước khi nạp: kỳ đã có dữ liệu chưa, đã khoá chưa, số tổng hiện tại, giải trình đang có.
    case "import_check": {
      if (!perm.canImport) throw new HttpError("forbidden", 403);
      const ky = needKy(p.ky);
      const meta = await getKyRow(db, ky);
      if (!meta || !meta.import_id) return { exists: false };
      const { data: b } = await D().from("import_batch").select("file_name, created_at, created_by").eq("id", meta.import_id).maybeSingle();
      const gts = await fetchAll((a, z) => D().from("giai_trinh")
        .select("ma_kh, nganh_hang, ten_nv, ten_kh, du_no_qua_han, trang_thai, cap_nhat_luc").eq("ky", ky).order("id").range(a, z));
      return {
        exists: true, khoa: !!meta.khoa, imported_at: meta.imported_at, imported_by: meta.imported_by,
        file_name: b?.file_name ?? null, doi_chieu: meta.doi_chieu, giai_trinh: gts,
      };
    }

    case "import_begin": {
      if (!perm.canImport) throw new HttpError("forbidden", 403);
      const ky = needKy(p.ky);
      const cur = await getKyRow(db, ky);
      if (cur?.khoa) throw new HttpError("ky_da_khoa"); // kỳ đã khoá: phải mở khoá mới nạp lại được
      const { data, error } = await D().from("import_batch")
        .insert({ ky, file_name: str(p.file_name, 300), created_by: s.username }).select("id").single();
      if (error) throw new Error(error.message);
      return { import_id: data.id };
    }
    case "import_rows": {
      if (!perm.canImport) throw new HttpError("forbidden", 403);
      const cols = COLS[p.table];
      if (!cols || !Array.isArray(p.rows) || p.rows.length > 3000) throw new HttpError("bad_payload");
      const { data: b } = await D().from("import_batch").select("trang_thai").eq("id", p.import_id).maybeSingle();
      if (!b || b.trang_thai !== "dang_nap") throw new HttpError("batch_khong_hop_le");
      const rows = p.rows.map((r: any) => {
        const o: Record<string, unknown> = { import_id: p.import_id };
        for (const c of cols) o[c] = r[c] ?? null;
        return o;
      });
      const { error } = await D().from(p.table).insert(rows);
      if (error) throw new Error(error.message);
      return { inserted: rows.length };
    }
    case "import_commit": {
      if (!perm.canImport) throw new HttpError("forbidden", 403);
      const { data: b } = await D().from("import_batch").select("*").eq("id", p.import_id).maybeSingle();
      if (!b || b.trang_thai !== "dang_nap") throw new HttpError("batch_khong_hop_le");
      const m = p.meta || {};
      const old = await getKyRow(db, b.ky);
      if (old?.khoa) throw new HttpError("ky_da_khoa");
      const { error } = await D().from("ky_bao_cao").upsert({
        ky: b.ky,
        ky_truoc: KY_RE.test(m.ky_truoc || "") ? m.ky_truoc : null,
        ngay_bao_cao: dateOrNull(m.ngay_bao_cao),
        han_giai_trinh: old?.han_giai_trinh ?? null,
        khoa: old?.khoa ?? false,
        import_id: b.id,
        bien_dong: m.bien_dong ?? null,
        doi_chieu: m.doi_chieu ?? null,
        imported_by: s.username,
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "ky" });
      if (error) throw new Error(error.message);
      await D().from("import_batch").update({ trang_thai: "xong", so_dong: p.so_dong ?? null }).eq("id", b.id);
      // Xoá batch cũ của cùng kỳ (cascade xoá chi tiết). Giải trình không phụ thuộc batch nên giữ nguyên.
      const { data: olds } = await D().from("import_batch").select("id").eq("ky", b.ky).neq("id", b.id);
      for (const o of olds ?? []) await D().from("import_batch").delete().eq("id", o.id);
      return { ok: true };
    }
    case "import_abort": {
      if (!perm.canImport) throw new HttpError("forbidden", 403);
      await D().from("import_batch").delete().eq("id", p.import_id).eq("trang_thai", "dang_nap");
      return { ok: true };
    }

    case "set_ky": {
      if (perm.role !== "admin") throw new HttpError("forbidden", 403);
      const ky = needKy(p.ky);
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if ("han_giai_trinh" in p) upd.han_giai_trinh = dateOrNull(p.han_giai_trinh);
      if ("khoa" in p) upd.khoa = !!p.khoa;
      const { error } = await D().from("ky_bao_cao").update(upd).eq("ky", ky);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    // ── Gắn tên NV ↔ tài khoản (admin) ──
    case "list_sale_map": {
      if (perm.role !== "admin") throw new HttpError("forbidden", 403);
      const [{ data: rows }, { data: usersRaw }, { data: latest }, { data: psDir }] = await Promise.all([
        D().from("sale_map").select("*").order("ten_nv"),
        db.schema("shared").from("users").select("username, ho_va_ten, role, bu, mien, scope, active").order("username"),
        D().from("ky_bao_cao").select("import_id").not("import_id", "is", null).order("ky", { ascending: false }).limit(1),
        db.schema("shared").from("dm_ps").select("ps, ten_ps, bu, bu_code, team, area, trang_thai"),
      ]);
      const users = (usersRaw ?? []).filter((u: any) => u.active !== false);
      const dir = (psDir ?? []) as PsRow[];
      const cov = amCoverage(dir, users.filter((u: any) => String(u.role || "").toLowerCase() === "area_manager" && !AM_EXCLUDE.has(u.username)) as AmRow[]);
      // Tự gắn theo dm_ps: tài khoản sale (ps), area manager phụ trách; không có AM → sale tự giải trình.
      const auto: Record<string, { sale: string[]; am: string[]; tu_gt: boolean; area: string | null; bu: string | null; bu_name: string | null; team: string | null }> = {};
      for (const p0 of dir) {
        if (!p0.ten_ps) continue;
        const k = normName(p0.ten_ps);
        auto[k] = auto[k] || { sale: [], am: cov.get(k) ?? [], tu_gt: false, area: p0.area, bu: p0.bu_code, bu_name: p0.bu, team: p0.team };
      }
      for (const u of users as any[]) {
        if (String(u.role || "").toLowerCase() === "area_manager") continue;
        for (const p0 of psOfUser(dir, { username: u.username, scope: u.scope, ho_ten: u.ho_va_ten })) {
          if (p0.ten_ps) auto[normName(p0.ten_ps)].sale.push(u.username);
        }
      }
      for (const v of Object.values(auto)) v.tu_gt = !v.am.length && v.sale.length > 0;
      let names: string[] = [];
      if (latest?.[0]?.import_id) {
        const agg = await fetchAll((a, b) => D().from("v_cong_no_agg").select("ten_nv").eq("import_id", latest[0].import_id).order("ten_nv").range(a, b));
        const hv = await fetchAll((a, b) => D().from("hang_vay").select("ten_nv").eq("import_id", latest[0].import_id).order("id").range(a, b));
        names = [...new Set([...agg, ...hv].map((r) => r.ten_nv))].sort();
      }
      return {
        rows: rows ?? [],
        users: users.map((u: any) => ({ username: u.username, ho_va_ten: u.ho_va_ten, role: u.role, bu: u.bu })),
        ten_nv: names,
        auto: Object.fromEntries(names.map((n) => [n, auto[normName(n)] ?? null])),
      };
    }
    case "save_sale_map": {
      if (perm.role !== "admin") throw new HttpError("forbidden", 403);
      if (!Array.isArray(p.rows)) throw new HttpError("bad_payload");
      const rows = p.rows.filter((r: any) => r && r.ten_nv).map((r: any) => ({
        ten_nv: String(r.ten_nv).slice(0, 200), username: str(r.username, 100), nguoi_duyet: str(r.nguoi_duyet, 100),
        ghi_chu: str(r.ghi_chu, 500), updated_by: s.username, updated_at: new Date().toISOString(),
      }));
      const { error } = await D().from("sale_map").upsert(rows, { onConflict: "ten_nv" });
      if (error) throw new Error(error.message);
      return { saved: rows.length };
    }

    default:
      throw new HttpError("unknown_action");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const secret = Deno.env.get("TOKEN_SECRET");
  if (!secret) return json({ ok: false, error: "TOKEN_SECRET chua duoc set" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_body" }, 400); }
  const session = await verifyToken(body?.token, secret);
  if (!session) return json({ ok: false, error: "unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const out = await handle(db, session, String(body.action || ""), body.payload || {});
    return json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.code }, e.status);
    console.error(e);
    return json({ ok: false, error: (e as Error).message || "server_error" }, 500);
  }
});
