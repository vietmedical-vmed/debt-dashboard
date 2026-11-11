// Backend giả cho chế độ demo (?demo=1). Mô phỏng đúng các action của debt-api,
// dữ liệu lưu trong IndexedDB của trình duyệt. KHÔNG dùng cho vận hành thật.
//
// Tài khoản demo (mật khẩu bất kỳ):
//   admin        → admin (nạp file, cấu hình, duyệt tất cả)
//   quanly       → manager (xem + duyệt tất cả)
//   am_bac, am_nam → area_manager Miền Bắc / Miền Nam, mọi ngành (người giải trình)
//   <tên không dấu, liền> của sale, ví dụ "nguyenthiduyen" → ps (chỉ xem KH của mình)
// Danh mục PS (dm_ps) demo tự dựng khi nạp file: miền đoán theo cột Khu vực.
(function () {
  if (!window.DEBT_CONFIG.DEMO) return;
  const DB_NAME = "debt-demo", KEY = "state";
  const NHOM = window.DEBT_CONFIG.NHOM_GIAI_TRINH;
  const PHE_DUYET = !!window.DEBT_CONFIG.PHE_DUYET;
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
    am_bac: { username: "am_bac", ho_ten: "AM Miền Bắc (demo)", role: "area_manager", bu: "all", scope: "Miền Bắc" },
    am_nam: { username: "am_nam", ho_ten: "AM Miền Nam (demo)", role: "area_manager", bu: "all", scope: "Miền Nam" },
  };
  const dir = () => S.dm_ps || [];
  function userOf(username) {
    if (USERS[username]) return USERS[username];
    const d = dir().find((x) => x.ps === username);
    if (d) return { username, ho_ten: d.ten_ps, role: "ps", bu: d.bu_code, scope: d.ps };
    const m = Object.values(S.sale_map).find((x) => x.username === username);
    return m ? { username, ho_ten: m.ten_nv, role: "ps", bu: "" } : null;
  }
  const NAM_RE = /Nam|Hồ Chí Minh|Cần Thơ|Đồng Nai|Long An|Bình Dương|Tiền Giang|Kiên Giang|Gia Lai|Trà Vinh|Khánh Hòa|Lâm Đồng|Đắk Lắk/;
  function buildDir(rows) {
    const by = new Map();
    for (const r of rows) {
      const x = by.get(r.ten_nv) || { bu: {}, nam: 0, bac: 0 };
      if (r.bu) x.bu[r.bu] = (x.bu[r.bu] || 0) + 1;
      if (NAM_RE.test(r.khu_vuc || "")) x.nam++; else x.bac++;
      by.set(r.ten_nv, x);
    }
    const BU = { chcs: ["CH&CS", "CHCS"], cttm: ["CTTM & CTUT", "CTTM"], thnk: ["THNS & CSVT", "NSCT"] };
    return [...by.entries()].map(([n, x]) => {
      const bu = Object.entries(x.bu).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const area = x.nam > x.bac ? "Miền Nam" : "Miền Bắc";
      return { ps: slug(n), ten_ps: n, bu_code: bu, bu: bu ? BU[bu][0] : null, team: bu ? BU[bu][1] + (area === "Miền Nam" ? " MN" : " MB") : null, area };
    });
  }

  const err = (code) => { throw new Error(code); };

  // ── Quyền: giống debt-api ──
  const norm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  function perm(u) {
    const map = Object.values(S.sale_map);
    const role = u.role;
    const buList = String(u.bu || "").split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const keys = new Set([norm(u.scope), norm(u.username)].filter(Boolean));
    const p = {
      role, all: role === "admin" || role === "manager", bu: null, amNv: new Set(),
      myNv: new Set([...map.filter((m) => m.username === u.username).map((m) => norm(m.ten_nv)),
        ...dir().filter((d) => keys.has(norm(d.ps)) || norm(d.ten_ps) === norm(u.ho_ten)).map((d) => norm(d.ten_ps))]),
      approveNv: new Set(map.filter((m) => m.nguoi_duyet === u.username).map((m) => norm(m.ten_nv))),
      canImport: role === "admin", approveAll: role === "admin" || role === "manager",
    };
    if (role === "product_manager") { if (!buList.length || buList.includes("all")) p.all = true; else p.bu = buList; }
    if (role === "area_manager") {
      const mien = String(u.scope || "").split(",").map((x) => x.trim());
      for (const d of dir()) if ((buList.includes("all") || buList.includes(d.bu_code)) && mien.includes(d.area)) p.amNv.add(norm(d.ten_ps));
    }
    // Sale không có area manager phụ trách thì tự giải trình (giống debt-api).
    p.selfNv = new Set();
    if (p.myNv.size && role !== "area_manager") {
      const cov = new Set(Object.values(USERS).filter((x) => x.role === "area_manager").flatMap((x) => [...perm(x).p.amNv]));
      for (const n of p.myNv) if (!cov.has(n)) p.selfNv.add(n);
    }
    return { p, map };
  }
  const canSee = (p, r) => { const n = norm(r.ten_nv); return p.all || (p.bu && r.bu && p.bu.includes(r.bu)) || p.amNv.has(n) || p.myNv.has(n) || p.approveNv.has(n); };
  const canEdit = (p, nv) => p.role === "admin" || p.role === "manager" || p.amNv.has(norm(nv)) || p.selfNv.has(norm(nv));
  const canApprove = (p, nv) => p.approveAll || p.approveNv.has(norm(nv));

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
        return { ok: true, user: u, permission: { all: P.all, bu: P.bu, giaiTrinh: P.amNv.size > 0 || P.role === "admin", canImport: P.canImport, approveAll: P.approveAll } };
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
          giai_trinh: S.giai_trinh.filter((g) => kys.includes(g.ky) && seeNv(g.ten_nv)).map((g) => ({ ...g, _can_approve: canApprove(P, g.ten_nv) })),
          can_edit_nv: P.role === "admin" || P.role === "manager" ? null : [...buByNv.keys()].filter((nv) => canEdit(P, nv)),
          can_approve_nv: PHE_DUYET ? [...buByNv.keys()].filter((nv) => canApprove(P, nv)) : [],
          phe_duyet: PHE_DUYET,
          ps_dir: [...new Set([...all, ...(S.hang_vay[meta.import_id] || [])].filter((r) => canSee(P, r)).map((r) => r.ten_nv))].map((nv) => {
            const d = dir().find((x) => norm(x.ten_ps) === norm(nv));
            return { ten_nv: nv, bu: d ? d.bu : null, bu_code: d ? d.bu_code : null, team: d ? d.team : null, area: d ? d.area : null };
          }),
        };
      }
      case "get_kh": {
        const meta = kyRow(p.ky); if (!meta) err("not_found");
        const hd = (S.cong_no[meta.import_id] || []).filter((r) => r.ky === p.ky && r.ma_kh === p.ma_kh && r.ten_nv === p.ten_nv && !r.loai_tru && NHOM.includes(r.nhom_no) && canSee(P, r))
          .sort((a, b) => b.so_ngay_qua_han - a.so_ngay_qua_han);
        const hist = S.giai_trinh.filter((g) => g.ma_kh === p.ma_kh && g.ten_nv === p.ten_nv).sort((a, b) => b.ky.localeCompare(a.ky));
        const ids = hist.map((h) => h.id);
        return { ok: true, hoa_don: hd, lich_su: hist, log: S.log.filter((l) => ids.includes(l.giai_trinh_id)).sort((a, b) => b.luc.localeCompare(a.luc)) };
      }
      case "save_gt": {
        if (!canEdit(P, p.ten_nv)) err("forbidden");
        const meta = kyRow(p.ky); if (!meta) err("not_found"); if (meta.khoa) err("ky_da_khoa");
        let cur = S.giai_trinh.find((g) => g.ky === p.ky && g.ma_kh === p.ma_kh && g.ten_nv === p.ten_nv);
        if (PHE_DUYET && cur && !["nhap", "tra_lai"].includes(cur.trang_thai)) err("da_gui_khong_sua");
        if (!PHE_DUYET) p = { ...p, submit: true };
        const qh = (S.cong_no[meta.import_id] || []).filter((r) => r.ky === p.ky && r.ma_kh === p.ma_kh && r.ten_nv === p.ten_nv && !r.loai_tru && NHOM.includes(r.nhom_no));
        const f = p.fields || {};
        const rec = {
          ky: p.ky, ma_kh: p.ma_kh, ten_nv: p.ten_nv, ten_kh: f.ten_kh || (qh[0] && qh[0].ten_kh) || null,
          du_no_qua_han: qh.reduce((t, r) => t + r.con_no, 0),
          ke_hoach: f.ke_hoach || null, thang_du_kien: /^\d{4}-(0[1-9]|1[0-2])$/.test(f.thang_du_kien || "") ? f.thang_du_kien : null,
          trang_thai: p.submit ? "cho_duyet" : "nhap", nguoi_cap_nhat: u.username, cap_nhat_luc: now(),
        };
        if (p.submit) {
          const miss = ["ke_hoach", "thang_du_kien"].filter((k) => !rec[k]);
          if (miss.length) err("thieu_thong_tin:" + miss.join(","));
          rec.nguoi_gui = u.username; rec.gui_luc = now();
        }
        if (cur) Object.assign(cur, rec); else S.giai_trinh.push(cur = { id: S.seq++, nhan_xet: null, nguoi_duyet: null, duyet_luc: null, ...rec });
        S.log.push({ id: S.seq++, giai_trinh_id: cur.id, hanh_dong: p.submit ? "gui" : "luu", noi_dung: rec, nguoi: u.username, luc: now() });
        await save(S);
        return { ok: true, row: cur };
      }
      case "review_gt": {
        if (!PHE_DUYET) err("phe_duyet_tat");
        const cur = S.giai_trinh.find((g) => g.id === Number(p.id)); if (!cur) err("not_found");
        const meta = kyRow(cur.ky); if (meta && meta.khoa) err("ky_da_khoa");
        const bus = [...new Set((S.cong_no[meta.import_id] || []).filter((r) => r.ten_nv === cur.ten_nv).map((r) => r.bu).filter(Boolean))];
        if (!canApprove(P, cur.ten_nv)) err("forbidden");
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
        // Demo: dựng danh mục PS (tài khoản sale = tên không dấu, miền đoán theo khu vực).
        const known = new Set(dir().map((d) => d.ten_ps));
        S.dm_ps = [...dir(), ...buildDir(S.cong_no[b.id].filter((r) => r.ky === b.ky && !known.has(r.ten_nv)))];
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
        const all = [...Object.values(USERS), ...dir().map((d) => ({ username: d.ps, ho_ten: d.ten_ps, role: "ps", bu: d.bu_code, scope: d.ps }))];
        const users = all.map((x) => ({ username: x.username, ho_va_ten: x.ho_ten, role: x.role, bu: x.bu }));
        const auto = {};
        for (const n of names) {
          const d = dir().find((x) => norm(x.ten_ps) === norm(n));
          if (!d) { auto[n] = null; continue; }
          const sale = all.filter((x) => x.role === "ps" && norm(x.scope) === norm(d.ps)).map((x) => x.username);
          const am = all.filter((x) => x.role === "area_manager" && perm(x).p.amNv.has(norm(n))).map((x) => x.username);
          auto[n] = { area: d.area, bu: d.bu_code, bu_name: d.bu, team: d.team, sale, am, tu_gt: !am.length && sale.length > 0 };
        }
        return { ok: true, rows: Object.values(S.sale_map), users, ten_nv: names, auto };
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
