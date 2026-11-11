// Backend giả cho chế độ demo (?demo=1). Mô phỏng đúng các action của debt-api,
// dữ liệu lưu trong IndexedDB của trình duyệt. KHÔNG dùng cho vận hành thật.
//
// Tài khoản demo (mật khẩu bất kỳ):
//   admin        → admin (nạp file, cấu hình, duyệt tất cả)
//   quanly       → manager (xem + duyệt tất cả)
//   tn_thnk      → product_manager ngành Nội soi tiêu hao
//   <tên không dấu, liền> của sale, ví dụ "nguyenthiduyen" → ps (sau khi nạp file, tự gắn)
(function () {
  if (!window.DEBT_CONFIG.DEMO) return;
  const DB_NAME = "debt-demo", KEY = "state";
  const NHOM = window.DEBT_CONFIG.NHOM_GIAI_TRINH;
  const deaccent = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const slug = (name) => deaccent(name).replace(/[^a-z0-9]/g, "");

  // ── IndexedDB tối giản ──
  function idb() {
    return new Promise((ok, fail) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  }
  async function load() {
    const db = await idb();
    return new Promise((ok) => {
      const q = db.transaction("kv").objectStore("kv").get(KEY);
      q.onsuccess = () => ok(q.result || null);
      q.onerror = () => ok(null);
    });
  }
  async function save(state) {
    const db = await idb();
    return new Promise((ok, fail) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(state, KEY);
      tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
    });
  }

  let S = null;
  const empty = () => ({ batches: {}, ky: {}, cong_no: {}, hang_vay: {}, thu_tien: {}, sale_map: {}, giai_trinh: [], log: [], seq: 1 });
  async function state() { if (!S) S = (await load()) || empty(); return S; }

  const USERS = {
    admin: { username: "admin", ho_ten: "Admin demo", role: "admin", bu: "all" },
    quanly: { username: "quanly", ho_ten: "Quản lý demo", role: "manager", bu: "all" },
    tn_thnk: { username: "tn_thnk", ho_ten: "Trưởng ngành NSTH", role: "product_manager", bu: "thnk" },
  };
  function userOf(username) {
    if (USERS[username]) return USERS[username];
    const m = Object.values(S.sale_map).find((x) => x.username === username);
    return m ? { username, ho_ten: m.ten_nv, role: "ps", bu: "" } : null;
  }

  const err = (code) => { throw new Error(code); };

  // ── Quyền: giống debt-api ──
  function perm(u) {
    const map = Object.values(S.sale_map);
    const role = u.role;
    const buList = String(u.bu || "").split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const p = {
      role, all: role === "admin" || role === "manager", bu: null,
      myNv: map.filter((m) => m.username === u.username).map((m) => m.ten_nv),
      approveNv: map.filter((m) => m.nguoi_duyet === u.username).map((m) => m.ten_nv),
      canImport: role === "admin", approveAll: role === "admin" || role === "manager",
    };
    if (role === "product_manager" || role === "area_manager") {
      if (!buList.length || buList.includes("all")) p.all = true; else p.bu = buList;
    }
    return { p, map };
  }
  const canSee = (p, r) => p.all || (p.bu && r.bu && p.bu.includes(r.bu)) || p.myNv.includes(r.ten_nv) || p.approveNv.includes(r.ten_nv);
  function canApprove(p, map, nv, bus) {
    if (p.approveAll || p.approveNv.includes(nv)) return true;
    const m = map.find((x) => x.ten_nv === nv);
    if ((p.role === "product_manager" || p.role === "area_manager") && !(m && m.nguoi_duyet)) return p.all || (!!p.bu && bus.some((b) => p.bu.includes(b)));
    return false;
  }

  function agg(rows) {
    const m = new Map();
    for (const r of rows) {
      if (r.loai_tru) continue;
      const k = [r.ky, r.ma_kh, r.ten_nv, r.nganh_hang, r.nhom_no, r.khong_chung_tu].join("|");
      let a = m.get(k);
      if (!a) m.set(k, a = { ky: r.ky, ma_kh: r.ma_kh, ten_kh: r.ten_kh, ten_nv: r.ten_nv, nganh_hang: r.nganh_hang, bu: r.bu, loai_hinh: r.loai_hinh, khu_vuc: r.khu_vuc, nhom_no: r.nhom_no, khong_chung_tu: r.khong_chung_tu, con_no: 0, so_hd: 0, max_ngay_qua_han: 0 });
      a.con_no += r.con_no; a.so_hd++; a.max_ngay_qua_han = Math.max(a.max_ngay_qua_han, r.so_ngay_qua_han || 0);
    }
    return [...m.values()];
  }
  const now = () => new Date().toISOString();
  const kyRow = (ky) => S.ky[ky];

  async function call(action, p, token) {
    await state();
    if (action === "login") {
      const u = userOf(String(p.username || "").trim());
      if (!u) err("invalid");
      if (p.newPassword) return { ok: true, changed: true };
      return { ok: true, token: "demo:" + u.username, ...u };
    }
    const u = token && token.startsWith("demo:") ? userOf(token.slice(5)) : null;
    if (!u) err("unauthorized");
    const { p: P, map } = perm(u);

    switch (action) {
      case "whoami":
        return { ok: true, user: u, permission: { all: P.all, bu: P.bu, myNv: P.myNv, approveNv: P.approveNv, canImport: P.canImport, approveAll: P.approveAll } };
      case "list_ky":
        return { ok: true, rows: Object.values(S.ky).filter((k) => k.import_id).sort((a, b) => b.ky.localeCompare(a.ky))
          .map((k) => (P.all ? k : { ...k, bien_dong: null, doi_chieu: null })) };
      case "get_ky": {
        const meta = kyRow(p.ky); if (!meta) err("not_found");
        const kys = [p.ky, meta.ky_truoc];
        const all = agg((S.cong_no[meta.import_id] || []).filter((r) => kys.includes(r.ky)));
        const buByNv = new Map();
        for (const r of all) { if (!buByNv.has(r.ten_nv)) buByNv.set(r.ten_nv, new Set()); if (r.bu) buByNv.get(r.ten_nv).add(r.bu); }
        const seeNv = (nv) => canSee(P, { ten_nv: nv }) || [...(buByNv.get(nv) || [])].some((b) => canSee(P, { ten_nv: nv, bu: b }));
        return {
          ok: true, meta: P.all ? meta : { ...meta, bien_dong: null, doi_chieu: null },
          agg: all.filter((r) => canSee(P, r)),
          hang_vay: (S.hang_vay[meta.import_id] || []).filter((r) => canSee(P, r)),
          thu_tien: (S.thu_tien[meta.import_id] || []).filter((r) => canSee(P, r)),
          giai_trinh: S.giai_trinh.filter((g) => kys.includes(g.ky) && seeNv(g.ten_nv)).map((g) => ({ ...g, _can_approve: canApprove(P, map, g.ten_nv, [...(buByNv.get(g.ten_nv) || [])]) })),
          can_edit_nv: P.role === "admin" ? null : P.myNv,
          can_approve_nv: [...buByNv.keys()].filter((nv) => canApprove(P, map, nv, [...(buByNv.get(nv) || [])])),
        };
      }
      case "get_kh": {
        const meta = kyRow(p.ky); if (!meta) err("not_found");
        const hd = (S.cong_no[meta.import_id] || []).filter((r) => r.ky === p.ky && r.ma_kh === p.ma_kh && r.ten_nv === p.ten_nv && !r.loai_tru && canSee(P, r))
          .sort((a, b) => b.so_ngay_qua_han - a.so_ngay_qua_han);
        const hist = S.giai_trinh.filter((g) => g.ma_kh === p.ma_kh && g.ten_nv === p.ten_nv).sort((a, b) => b.ky.localeCompare(a.ky));
        const ids = hist.map((h) => h.id);
        return { ok: true, hoa_don: hd, lich_su: hist, log: S.log.filter((l) => ids.includes(l.giai_trinh_id)).sort((a, b) => b.luc.localeCompare(a.luc)) };
      }
      case "save_gt": {
        if (P.role !== "admin" && !P.myNv.includes(p.ten_nv)) err("forbidden");
        const meta = kyRow(p.ky); if (!meta) err("not_found"); if (meta.khoa) err("ky_da_khoa");
        let cur = S.giai_trinh.find((g) => g.ky === p.ky && g.ma_kh === p.ma_kh && g.ten_nv === p.ten_nv);
        if (cur && !["nhap", "tra_lai"].includes(cur.trang_thai)) err("da_gui_khong_sua");
        const qh = (S.cong_no[meta.import_id] || []).filter((r) => r.ky === p.ky && r.ma_kh === p.ma_kh && r.ten_nv === p.ten_nv && !r.loai_tru && NHOM.includes(r.nhom_no));
        const f = p.fields || {};
        const rec = {
          ky: p.ky, ma_kh: p.ma_kh, ten_nv: p.ten_nv, ten_kh: f.ten_kh || (qh[0] && qh[0].ten_kh) || null,
          du_no_qua_han: qh.reduce((t, r) => t + r.con_no, 0),
          nguyen_nhan: f.nguyen_nhan || null, chi_tiet: f.chi_tiet || null, ke_hoach: f.ke_hoach || null,
          ngay_du_kien: f.ngay_du_kien || null, so_tien_du_kien: f.so_tien_du_kien === "" || f.so_tien_du_kien == null ? null : Number(f.so_tien_du_kien),
          trang_thai: p.submit ? "cho_duyet" : "nhap", nguoi_cap_nhat: u.username, cap_nhat_luc: now(),
        };
        if (p.submit) {
          const miss = ["nguyen_nhan", "ke_hoach", "ngay_du_kien"].filter((k) => !rec[k]);
          if (rec.nguyen_nhan === "Khác" && !rec.chi_tiet) miss.push("chi_tiet");
          if (miss.length) err("thieu_thong_tin:" + miss.join(","));
          rec.nguoi_gui = u.username; rec.gui_luc = now();
        }
        if (cur) Object.assign(cur, rec); else S.giai_trinh.push(cur = { id: S.seq++, nhan_xet: null, nguoi_duyet: null, duyet_luc: null, ...rec });
        S.log.push({ id: S.seq++, giai_trinh_id: cur.id, hanh_dong: p.submit ? "gui" : "luu", noi_dung: rec, nguoi: u.username, luc: now() });
        await save(S);
        return { ok: true, row: cur };
      }
      case "review_gt": {
        const cur = S.giai_trinh.find((g) => g.id === Number(p.id)); if (!cur) err("not_found");
        const meta = kyRow(cur.ky); if (meta && meta.khoa) err("ky_da_khoa");
        const bus = [...new Set((S.cong_no[meta.import_id] || []).filter((r) => r.ten_nv === cur.ten_nv).map((r) => r.bu).filter(Boolean))];
        if (!canApprove(P, map, cur.ten_nv, bus)) err("forbidden");
        const decision = p.decision === "duyet" ? "da_duyet" : p.decision === "tra_lai" ? "tra_lai" : null;
        if (!decision) err("bad_payload");
        if (!(cur.trang_thai === "cho_duyet" || (cur.trang_thai === "da_duyet" && decision === "tra_lai"))) err("trang_thai_khong_hop_le");
        if (decision === "tra_lai" && !p.nhan_xet) err("thieu_thong_tin:nhan_xet");
        Object.assign(cur, { trang_thai: decision, nhan_xet: p.nhan_xet || null, nguoi_duyet: u.username, duyet_luc: now() });
        S.log.push({ id: S.seq++, giai_trinh_id: cur.id, hanh_dong: decision === "da_duyet" ? "duyet" : "tra_lai", noi_dung: { nhan_xet: p.nhan_xet }, nguoi: u.username, luc: now() });
        await save(S);
        return { ok: true, row: cur };
      }
      case "import_begin": {
        if (!P.canImport) err("forbidden");
        const id = "b" + S.seq++;
        S.batches[id] = { id, ky: p.ky, trang_thai: "dang_nap" };
        S.cong_no[id] = []; S.hang_vay[id] = []; S.thu_tien[id] = [];
        return { ok: true, import_id: id };
      }
      case "import_rows": {
        if (!P.canImport) err("forbidden");
        const b = S.batches[p.import_id]; if (!b || b.trang_thai !== "dang_nap") err("batch_khong_hop_le");
        S[p.table][p.import_id].push(...p.rows);
        return { ok: true, inserted: p.rows.length };
      }
      case "import_commit": {
        if (!P.canImport) err("forbidden");
        const b = S.batches[p.import_id]; if (!b) err("batch_khong_hop_le");
        const old = S.ky[b.ky];
        if (old && old.import_id && old.import_id !== b.id) { delete S.cong_no[old.import_id]; delete S.hang_vay[old.import_id]; delete S.thu_tien[old.import_id]; delete S.batches[old.import_id]; }
        b.trang_thai = "xong";
        const m = p.meta || {};
        S.ky[b.ky] = { ky: b.ky, ky_truoc: m.ky_truoc, ngay_bao_cao: m.ngay_bao_cao, han_giai_trinh: old ? old.han_giai_trinh : null, khoa: old ? old.khoa : false,
          import_id: b.id, bien_dong: m.bien_dong, doi_chieu: m.doi_chieu, imported_by: u.username, imported_at: now() };
        // Demo: tự tạo tài khoản sale = tên không dấu.
        const names = new Set([...S.cong_no[b.id], ...S.hang_vay[b.id]].map((r) => r.ten_nv));
        for (const n of names) if (!S.sale_map[n]) S.sale_map[n] = { ten_nv: n, username: slug(n), nguoi_duyet: null };
        await save(S);
        return { ok: true };
      }
      case "import_abort": {
        delete S.batches[p.import_id]; delete S.cong_no[p.import_id]; delete S.hang_vay[p.import_id]; delete S.thu_tien[p.import_id];
        return { ok: true };
      }
      case "set_ky": {
        if (P.role !== "admin") err("forbidden");
        const k = S.ky[p.ky]; if (!k) err("not_found");
        if ("han_giai_trinh" in p) k.han_giai_trinh = p.han_giai_trinh || null;
        if ("khoa" in p) k.khoa = !!p.khoa;
        await save(S);
        return { ok: true };
      }
      case "list_sale_map": {
        if (P.role !== "admin") err("forbidden");
        const latest = Object.values(S.ky).sort((a, b) => b.ky.localeCompare(a.ky))[0];
        const names = latest ? [...new Set([...(S.cong_no[latest.import_id] || []), ...(S.hang_vay[latest.import_id] || [])].map((r) => r.ten_nv))].sort() : [];
        const users = [...Object.values(USERS), ...Object.values(S.sale_map).filter((m) => m.username).map((m) => ({ username: m.username, ho_va_ten: m.ten_nv, role: "ps" }))]
          .map((x) => ({ username: x.username, ho_va_ten: x.ho_va_ten || x.ho_ten, role: x.role, bu: x.bu }));
        return { ok: true, rows: Object.values(S.sale_map), users, ten_nv: names };
      }
      case "save_sale_map": {
        if (P.role !== "admin") err("forbidden");
        for (const r of p.rows) S.sale_map[r.ten_nv] = { ten_nv: r.ten_nv, username: r.username || null, nguoi_duyet: r.nguoi_duyet || null, ghi_chu: r.ghi_chu || null };
        await save(S);
        return { ok: true, saved: p.rows.length };
      }
      default: err("unknown_action");
    }
  }

  async function reset() { S = empty(); await save(S); }
  window.DEBT_MOCK = { call, reset };
})();
