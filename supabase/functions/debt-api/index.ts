// Supabase Edge Function: debt-api
// Verify token HMAC (do debt-login phát) rồi dispatch theo `action`. Body: { action, token, payload }.
//
// Deploy:
//   supabase functions deploy debt-api --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
//
// Phân quyền (role lấy từ shared.users, nằm trong token):
//   admin            : xem tất cả, nạp file, cấu hình, duyệt tất cả, sửa giải trình thay sale
//   manager          : xem tất cả, duyệt tất cả
//   product_manager,
//   area_manager     : xem theo ngành hàng (users.bu: chcs/thnk/cttm, "all" = tất cả);
//                      duyệt sale mà mình là người duyệt (sale_map.nguoi_duyet), hoặc sale chưa gán người duyệt trong ngành mình
//   ps (và role khác): chỉ xem + giải trình khách hàng của chính mình (sale_map.username = mình)
// Ai được gán là người duyệt của một sale thì luôn xem được khách hàng của sale đó.

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
  amNv: Set<string>;          // area_manager: tên PS phụ trách (đã chuẩn hoá) theo shared.dm_ps
  myNv: string[];             // tên NV trong file kế toán = chính mình
  approveNv: string[];        // tên NV mình là người duyệt (gán cứng ở sale_map)
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

async function getPerm(db: SupabaseClient, s: Session): Promise<{ perm: Perm; map: SaleMap[] }> {
  const { data, error } = await db.schema("app_debt").from("sale_map").select("ten_nv, username, nguoi_duyet");
  if (error) throw new Error(error.message);
  const map = (data ?? []) as SaleMap[];
  const role = (s.role || "").toLowerCase();
  const me = s.username;
  const buList = String(s.bu || "").split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const perm: Perm = {
    role,
    all: role === "admin" || role === "manager",
    bu: null,
    amNv: new Set(),
    myNv: map.filter((m) => m.username === me).map((m) => m.ten_nv),
    approveNv: map.filter((m) => m.nguoi_duyet === me).map((m) => m.ten_nv),
    canImport: role === "admin",
    approveAll: role === "admin" || role === "manager",
    noAccess: role === "purchasing",
  };
  if (role === "product_manager") {
    if (!buList.length || buList.includes("all")) perm.all = true;
    else perm.bu = buList;
  }
  if (role === "area_manager") {
    // PS phụ trách = shared.dm_ps cùng BU (bu_code) và thuộc miền phụ trách. Khớp tên PS (ten_ps) với tên NV trong file kế toán.
    const mien = mienOfManager(s);
    const { data: ps, error: e2 } = await db.schema("shared").from("dm_ps").select("ten_ps, bu_code, area");
    if (e2) throw new Error(e2.message);
    for (const p of ps ?? []) {
      const buOk = buList.includes("all") || buList.includes(String(p.bu_code || "").toLowerCase());
      const mienOk = mien.includes(String(p.area || "").normalize("NFC").trim());
      if (buOk && mienOk && p.ten_ps) perm.amNv.add(normName(p.ten_ps));
    }
  }
  return { perm, map };
}

function canSee(p: Perm, row: { bu?: string | null; ten_nv: string }) {
  if (p.noAccess) return false;
  if (p.all) return true;
  if (p.bu && row.bu && p.bu.includes(row.bu)) return true;
  if (p.amNv.has(normName(row.ten_nv))) return true;
  return p.myNv.includes(row.ten_nv) || p.approveNv.includes(row.ten_nv);
}

function canApprove(p: Perm, map: SaleMap[], tenNv: string, buOfRow: string[]) {
  if (p.approveAll) return true;
  if (p.approveNv.includes(tenNv)) return true;
  const m = map.find((x) => x.ten_nv === tenNv);
  if (m && m.nguoi_duyet) return false; // đã gán người duyệt cụ thể
  if (p.role === "area_manager") return p.amNv.has(normName(tenNv));
  if (p.role === "product_manager") return p.all || (!!p.bu && buOfRow.some((b) => p.bu!.includes(b)));
  return false;
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
const numOrNull = (v: unknown) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const QUA_HAN = ["A2", "A3", "A4"];

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

// ─── Actions ───────────────────────────────────────────────────────────
async function handle(db: SupabaseClient, s: Session, action: string, p: any) {
  const { perm, map } = await getPerm(db, s);
  if (perm.noAccess) throw new HttpError("forbidden", 403);
  const D = () => db.schema("app_debt");

  switch (action) {
    case "whoami":
      return {
        user: { username: s.username, ho_ten: s.ho_ten, role: s.role, bu: s.bu, mien: s.mien },
        permission: { all: perm.all, bu: perm.bu, myNv: perm.myNv, approveNv: perm.approveNv, canImport: perm.canImport, approveAll: perm.approveAll },
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
      const buByNv = new Map<string, Set<string>>();
      for (const r of agg) { if (!buByNv.has(r.ten_nv)) buByNv.set(r.ten_nv, new Set()); if (r.bu) buByNv.get(r.ten_nv)!.add(r.bu); }
      const seeNv = (nv: string) => canSee(perm, { ten_nv: nv, bu: null }) || [...(buByNv.get(nv) ?? [])].some((b) => canSee(perm, { ten_nv: nv, bu: b }));
      return {
        meta: perm.all ? meta : { ...meta, bien_dong: null, doi_chieu: null },
        agg: agg.filter((r) => canSee(perm, r)),
        hang_vay: hv.filter((r) => canSee(perm, r)),
        thu_tien: tt.filter((r) => canSee(perm, r)),
        giai_trinh: gt.filter((r) => seeNv(r.ten_nv)).map((r) => ({
          ...r, _can_approve: canApprove(perm, map, r.ten_nv, [...(buByNv.get(r.ten_nv) ?? [])]),
        })),
        can_edit_nv: perm.role === "admin" ? null : perm.myNv,
        can_approve_nv: [...buByNv.keys()].filter((nv) => canApprove(perm, map, nv, [...(buByNv.get(nv) ?? [])])),
      };
    }

    // Chi tiết hóa đơn của 1 KH × NV + lịch sử giải trình các kỳ.
    case "get_kh": {
      const ky = needKy(p.ky);
      const ma = String(p.ma_kh || ""), nv = String(p.ten_nv || "");
      const meta = await getKyRow(db, ky);
      if (!meta?.import_id) throw new HttpError("not_found", 404);
      const rows = await fetchAll((a, b) => D().from("cong_no")
        .select("ky, so_hd, ngay_hd, ngay_den_han, so_ngay_qua_han, nhom_no, nganh_hang, bu, gia_tri_hd, da_thanh_toan, con_no, so_hop_dong, bbbg, hop_dong_ban, khong_chung_tu, ghi_chu, note")
        .eq("import_id", meta.import_id).eq("ky", ky).eq("ma_kh", ma).eq("ten_nv", nv).eq("loai_tru", false)
        .order("so_ngay_qua_han", { ascending: false }).order("id").range(a, b));
      const visible = rows.filter((r) => canSee(perm, { ...r, ten_nv: nv }));
      if (!visible.length && !canSee(perm, { ten_nv: nv, bu: null })) throw new HttpError("forbidden", 403);
      const { data: hist, error } = await D().from("giai_trinh").select("*").eq("ma_kh", ma).eq("ten_nv", nv).order("ky", { ascending: false });
      if (error) throw new Error(error.message);
      const ids = (hist ?? []).map((h) => h.id);
      const { data: logs } = ids.length
        ? await D().from("giai_trinh_log").select("*").in("giai_trinh_id", ids).order("luc", { ascending: false })
        : { data: [] };
      return { hoa_don: visible, lich_su: hist ?? [], log: logs ?? [] };
    }

    // Sale lưu nháp hoặc gửi duyệt.
    case "save_gt": {
      const ky = needKy(p.ky);
      const ma = String(p.ma_kh || ""), nv = String(p.ten_nv || "");
      if (!ma || !nv) throw new HttpError("bad_payload");
      if (perm.role !== "admin" && !perm.myNv.includes(nv)) throw new HttpError("forbidden", 403);
      const meta = await getKyRow(db, ky);
      if (!meta?.import_id) throw new HttpError("not_found", 404);
      if (meta.khoa) throw new HttpError("ky_da_khoa");

      const { data: cur } = await D().from("giai_trinh").select("*").eq("ky", ky).eq("ma_kh", ma).eq("ten_nv", nv).maybeSingle();
      if (cur && !["nhap", "tra_lai"].includes(cur.trang_thai)) throw new HttpError("da_gui_khong_sua");

      const qh = await fetchAll((a, b) => D().from("cong_no").select("con_no, ten_kh")
        .eq("import_id", meta.import_id).eq("ky", ky).eq("ma_kh", ma).eq("ten_nv", nv).eq("loai_tru", false).in("nhom_no", QUA_HAN).order("id").range(a, b));
      const duNo = qh.reduce((t, r) => t + Number(r.con_no || 0), 0);

      const submit = !!p.submit;
      const f = p.fields || {};
      const rec: Record<string, unknown> = {
        ky, ma_kh: ma, ten_nv: nv,
        ten_kh: str(f.ten_kh, 300) ?? qh[0]?.ten_kh ?? cur?.ten_kh ?? null,
        du_no_qua_han: duNo,
        nguyen_nhan: str(f.nguyen_nhan, 200),
        chi_tiet: str(f.chi_tiet),
        ke_hoach: str(f.ke_hoach),
        ngay_du_kien: dateOrNull(f.ngay_du_kien),
        so_tien_du_kien: numOrNull(f.so_tien_du_kien),
        trang_thai: submit ? "cho_duyet" : "nhap",
        nguoi_cap_nhat: s.username,
        cap_nhat_luc: new Date().toISOString(),
      };
      if (submit) {
        const missing = ["nguyen_nhan", "ke_hoach", "ngay_du_kien"].filter((k) => !rec[k]);
        if (rec.nguyen_nhan === "Khác" && !rec.chi_tiet) missing.push("chi_tiet");
        if (missing.length) throw new HttpError("thieu_thong_tin:" + missing.join(","));
        rec.nguoi_gui = s.username;
        rec.gui_luc = new Date().toISOString();
      }
      const { data: saved, error } = await D().from("giai_trinh").upsert(rec, { onConflict: "ky,ma_kh,ten_nv" }).select("*").single();
      if (error) throw new Error(error.message);
      await D().from("giai_trinh_log").insert({ giai_trinh_id: saved.id, hanh_dong: submit ? "gui" : "luu", noi_dung: rec, nguoi: s.username });
      return { row: saved };
    }

    // Quản lý duyệt / trả lại.
    case "review_gt": {
      const id = Number(p.id);
      const decision = p.decision === "duyet" ? "da_duyet" : p.decision === "tra_lai" ? "tra_lai" : null;
      if (!id || !decision) throw new HttpError("bad_payload");
      const { data: cur, error: e1 } = await D().from("giai_trinh").select("*").eq("id", id).maybeSingle();
      if (e1) throw new Error(e1.message);
      if (!cur) throw new HttpError("not_found", 404);
      const meta = await getKyRow(db, cur.ky);
      if (meta?.khoa) throw new HttpError("ky_da_khoa");
      const { data: buRows } = await D().from("v_cong_no_agg").select("bu").eq("import_id", meta?.import_id).eq("ten_nv", cur.ten_nv).limit(50);
      const bus = [...new Set((buRows ?? []).map((r: any) => r.bu).filter(Boolean))] as string[];
      if (!canApprove(perm, map, cur.ten_nv, bus)) throw new HttpError("forbidden", 403);
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
    case "import_begin": {
      if (!perm.canImport) throw new HttpError("forbidden", 403);
      const ky = needKy(p.ky);
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
      const [{ data: rows }, { data: users }, { data: latest }, { data: psDir }] = await Promise.all([
        D().from("sale_map").select("*").order("ten_nv"),
        db.schema("shared").from("users").select("username, ho_va_ten, role, bu, active").order("username"),
        D().from("ky_bao_cao").select("import_id").not("import_id", "is", null).order("ky", { ascending: false }).limit(1),
        db.schema("shared").from("dm_ps").select("ps, ten_ps"),
      ]);
      let names: string[] = [];
      if (latest?.[0]?.import_id) {
        const agg = await fetchAll((a, b) => D().from("v_cong_no_agg").select("ten_nv").eq("import_id", latest[0].import_id).order("ten_nv").range(a, b));
        const hv = await fetchAll((a, b) => D().from("hang_vay").select("ten_nv").eq("import_id", latest[0].import_id).order("id").range(a, b));
        names = [...new Set([...agg, ...hv].map((r) => r.ten_nv))].sort();
      }
      return { rows: rows ?? [], users: (users ?? []).filter((u: any) => u.active !== false), ten_nv: names, ps_dir: psDir ?? [] };
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
