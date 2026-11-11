// Quản trị (admin): nạp file kế toán, đặt hạn / khoá kỳ, gắn tên sale ↔ tài khoản + người duyệt.
(function () {
  const { useState, useEffect } = React;
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { api, errorText } = window.DEBT_API;
  const { T, fmtTr, fmtKyLabel, fmtDate, btn } = UI;
  const IMP = window.DEBT_IMPORT;
  const CHUNK = 1000;

  // ── 1. Nạp file ───────────────────────────────────────────────────
  function NapFile({ onDone }) {
    const [parsed, setParsed] = useState(null);
    const [fileName, setFileName] = useState("");
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(null);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(null);

    const onFile = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      setParsed(null); setError(null); setDone(null); setFileName(file.name); setBusy(true); setProgress("Đang đọc file…");
      await new Promise((r) => setTimeout(r, 30)); // cho UI vẽ trạng thái trước khi đọc (đồng bộ, ~1–3 giây)
      try {
        const wb = XLSX.read(await file.arrayBuffer(), IMP.READ_OPTS);
        setParsed(IMP.parseWorkbook(wb));
      } catch (err) { setError(err.message || String(err)); }
      setBusy(false); setProgress(null);
    };

    const upload = async () => {
      const p = parsed;
      setBusy(true); setError(null);
      let importId = null;
      try {
        const kys = [p.ky, p.ky_truoc].filter(Boolean);
        const cong_no = p.cong_no.filter((r) => kys.includes(r.ky));
        const tables = [["cong_no", cong_no], ["hang_vay", p.hang_vay], ["thu_tien", p.thu_tien]];
        const total = tables.reduce((t, [, rows]) => t + rows.length, 0);
        let sent = 0;
        setProgress("Tạo lần nạp…");
        importId = (await api("import_begin", { ky: p.ky, file_name: fileName })).import_id;
        for (const [table, rows] of tables) {
          for (let i = 0; i < rows.length; i += CHUNK) {
            await api("import_rows", { import_id: importId, table, rows: rows.slice(i, i + CHUNK) });
            sent += Math.min(CHUNK, rows.length - i);
            setProgress("Đang tải lên " + Math.round((sent / total) * 100) + "% (" + sent.toLocaleString("vi-VN") + "/" + total.toLocaleString("vi-VN") + " dòng)");
          }
        }
        setProgress("Hoàn tất…");
        await api("import_commit", {
          import_id: importId,
          meta: { ky_truoc: p.ky_truoc, ngay_bao_cao: p.ngay_bao_cao, bien_dong: p.bien_dong, doi_chieu: p.doi_chieu },
          so_dong: { cong_no: cong_no.length, hang_vay: p.hang_vay.length, thu_tien: p.thu_tien.length },
        });
        D.invalidate();
        setDone("Đã nạp kỳ " + fmtKyLabel(p.ky) + " (" + total.toLocaleString("vi-VN") + " dòng). Giải trình đã nhập trước đó được giữ nguyên.");
        setParsed(null);
        onDone && onDone();
      } catch (err) {
        setError(errorText(err.message));
        if (importId) api("import_abort", { import_id: importId }).catch(() => {});
      }
      setBusy(false); setProgress(null);
    };

    const dc = parsed && parsed.doi_chieu;
    const line = (label, bc, tinh) => {
      const lech = bc != null && Math.abs(bc - tinh) > 1;
      return h("tr", { key: label, className: lech ? "bg-red-50" : "" },
        h("td", { className: T.td }, label),
        h("td", { className: T.num }, bc == null ? "—" : Math.round(bc).toLocaleString("vi-VN")),
        h("td", { className: T.num }, Math.round(tinh).toLocaleString("vi-VN")),
        h("td", { className: T.td }, bc == null ? h("span", { className: "text-slate-400" }, "—") : lech ? h(UI.Badge, { tone: "red" }, "Lệch") : h(UI.Badge, { tone: "green" }, "Khớp")));
    };

    return h(UI.Panel, { title: "1. Nạp file công nợ kế toán gửi", subtitle: "File .xlsb dạng \"KNK_Báo cáo công nợ Txx.yyyy\" · đọc ngay trên trình duyệt, đối chiếu số trước khi tải lên" },
      h("div", { className: "flex flex-col gap-3 p-4" },
        h("label", { className: btn.primary + " w-fit cursor-pointer" + (busy ? " pointer-events-none opacity-50" : "") },
          h(UI.I.Upload, { size: 14 }), "Chọn file…",
          h("input", { type: "file", accept: ".xlsb,.xlsx,.xlsm", className: "hidden", onChange: onFile, disabled: busy })),
        progress && h("div", { className: "flex items-center gap-2 text-[13px] text-blue-700" }, h(UI.I.Loader2, { size: 14, className: "animate-spin" }), progress),
        error && h(UI.ErrorBox, null, error),
        done && h("div", { className: "flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[13px] text-green-800" }, h(UI.I.Check, { size: 14 }), done),
        parsed && h("div", { className: "flex flex-col gap-3" },
          h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-5" },
            h(UI.StatCard, { label: "KỲ BÁO CÁO", value: fmtKyLabel(parsed.ky), sub: "Ngày BC " + fmtDate(parsed.ngay_bao_cao) }),
            h(UI.StatCard, { label: "KỲ SO SÁNH", value: fmtKyLabel(parsed.ky_truoc) }),
            h(UI.StatCard, { label: "DÒNG HÓA ĐƠN", value: parsed.cong_no.filter((r) => [parsed.ky, parsed.ky_truoc].includes(r.ky)).length.toLocaleString("vi-VN") }),
            h(UI.StatCard, { label: "DÒNG HÀNG VAY", value: parsed.hang_vay.length.toLocaleString("vi-VN") }),
            h(UI.StatCard, { label: "KH × NV CÓ THU TRONG THÁNG", value: parsed.thu_tien.length.toLocaleString("vi-VN") })),
          h("table", { className: T.table + " max-w-2xl" },
            h("thead", null, h("tr", { className: T.headRow }, ["Chỉ tiêu (triệu đồng)", "Sheet BC", "Tính từ chi tiết", ""].map((x, i) => h("th", { key: i, className: T.th(i === 1 || i === 2) }, x)))),
            h("tbody", null,
              ["A0", "A1", "A2", "A3", "A4", "tong"].map((g) => line(g === "tong" ? "Tổng dư nợ" : "Nhóm " + g, dc.ky && dc.ky[g], dc.tinh_lai[g])),
              line("Dư nợ chưa có BBBG/ĐCCN (chưa gồm CTTM)", dc.chua_bbbg, dc.tinh_lai.chua_bbbg),
              line("Hàng vay chưa xuất HĐ", dc.hang_vay, dc.hang_vay_tinh_lai))),
          parsed.warnings.length > 0 && h("div", { className: "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" },
            h("b", null, "Cảnh báo:"), h("ul", { className: "ml-4 list-disc" }, parsed.warnings.map((w) => h("li", { key: w }, w)))),
          h("div", { className: "flex gap-2" },
            h("button", { type: "button", disabled: busy, onClick: upload, className: btn.primary }, h(UI.I.Upload, { size: 14 }), "Nạp lên hệ thống"),
            h("button", { type: "button", disabled: busy, onClick: () => setParsed(null), className: btn.secondary }, "Huỷ")))));
  }

  // ── 2. Kỳ báo cáo: hạn giải trình, khoá ───────────────────────────
  function KyBaoCao({ nonce }) {
    const list = D.useKyList();
    const [msg, setMsg] = useState(null);
    const upd = async (ky, patch) => {
      setMsg(null);
      try { await api("set_ky", { ky, ...patch }); D.invalidate(); setMsg({ ok: true, text: "Đã lưu " + fmtKyLabel(ky) }); }
      catch (e) { setMsg({ ok: false, text: errorText(e.message) }); }
    };
    const rows = list.rows || [];
    return h(UI.Panel, { title: "2. Kỳ báo cáo", subtitle: "Đặt hạn giải trình cho sale. Khoá kỳ khi đã chốt — không ai sửa/duyệt được nữa." },
      msg && h("div", { className: "px-4 pt-3" }, msg.ok ? h("span", { className: "text-[13px] text-green-700" }, msg.text) : h(UI.ErrorBox, null, msg.text)),
      rows.length === 0 ? h("div", { className: "p-4 text-[13px] text-slate-400" }, "Chưa có kỳ nào.")
      : h("table", { className: T.table },
          h("thead", null, h("tr", { className: T.headRow }, ["Kỳ", "Ngày BC", "Nạp lúc", "Người nạp", "Hạn giải trình", "Khoá"].map((x) => h("th", { key: x, className: T.th() }, x)))),
          h("tbody", null, rows.map((k, i) => h("tr", { key: k.ky, className: T.row(i) },
            h("td", { className: T.td + " font-semibold" }, fmtKyLabel(k.ky)),
            h("td", { className: T.td }, fmtDate(k.ngay_bao_cao)),
            h("td", { className: T.td }, k.imported_at ? new Date(k.imported_at).toLocaleString("vi-VN") : "—"),
            h("td", { className: T.td }, k.imported_by || "—"),
            h("td", { className: T.td }, h("input", { type: "date", defaultValue: k.han_giai_trinh || "", className: UI.input + " w-40",
              onBlur: (e) => { if ((e.target.value || null) !== (k.han_giai_trinh || null)) upd(k.ky, { han_giai_trinh: e.target.value || null }); } })),
            h("td", { className: T.td }, h("label", { className: "flex items-center gap-2 text-[13px]" },
              h("input", { type: "checkbox", defaultChecked: !!k.khoa, onChange: (e) => upd(k.ky, { khoa: e.target.checked }) }), k.khoa ? "Đã khoá" : "Mở")))))));
  }

  // ── 3. Gắn tên sale ↔ tài khoản ───────────────────────────────────
  function SaleMap({ nonce }) {
    const [st, setSt] = useState({ loading: true });
    const [edits, setEdits] = useState({});
    const [msg, setMsg] = useState(null);
    const load = () => api("list_sale_map").then((r) => setSt({ ...r, loading: false })).catch((e) => setSt({ loading: false, error: errorText(e.message) }));
    useEffect(() => { load(); }, [nonce]);
    if (st.loading) return h(UI.Panel, { title: "3. Gắn sale ↔ tài khoản" }, h(UI.LoadingBlock, null));
    if (st.error) return h(UI.Panel, { title: "3. Gắn sale ↔ tài khoản" }, h("div", { className: "p-4" }, h(UI.ErrorBox, null, st.error)));

    const byNv = new Map(st.rows.map((r) => [r.ten_nv, r]));
    const names = [...new Set([...st.ten_nv, ...st.rows.map((r) => r.ten_nv)])].sort((a, b) => a.localeCompare(b, "vi"));
    const val = (nv, k) => (edits[nv] && k in edits[nv] ? edits[nv][k] : (byNv.get(nv) || {})[k] || "");
    const setVal = (nv, k, v) => setEdits((e) => ({ ...e, [nv]: { ...(e[nv] || {}), [k]: v } }));
    const users = st.users.slice().sort((a, b) => (a.ho_va_ten || a.username).localeCompare(b.ho_va_ten || b.username, "vi"));
    const approvers = users.filter((u) => ["admin", "manager", "product_manager", "area_manager"].includes(String(u.role).toLowerCase()));
    const opt = (u) => h("option", { key: u.username, value: u.username }, (u.ho_va_ten || u.username) + " (" + u.username + " · " + u.role + ")");
    const dirty = Object.keys(edits).length;
    const unmapped = names.filter((n) => !val(n, "username")).length;

    // Gợi ý: khớp tên sale với họ tên tài khoản (bỏ dấu, không phân biệt hoa thường);
    // không được thì qua danh mục PS (dm_ps: ten_ps = tên trong file, ps = họ tên/tài khoản).
    const autoMatch = () => {
      const key = (s) => UI.deaccent(s || "").replace(/\s+/g, " ").trim();
      const next = { ...edits };
      for (const n of names) {
        if (val(n, "username")) continue;
        const ps = (st.ps_dir || []).find((p) => key(p.ten_ps) === key(n));
        const u = users.find((x) => key(x.ho_va_ten) === key(n))
          || (ps && users.find((x) => key(x.ho_va_ten) === key(ps.ps) || key(x.username) === key(ps.ps)));
        if (u) next[n] = { ...(next[n] || {}), username: u.username };
      }
      setEdits(next);
    };
    const save = async () => {
      setMsg(null);
      const rows = Object.keys(edits).map((nv) => ({ ten_nv: nv, username: val(nv, "username") || null, nguoi_duyet: val(nv, "nguoi_duyet") || null, ghi_chu: val(nv, "ghi_chu") || null }));
      try { await api("save_sale_map", { rows }); setEdits({}); D.invalidate(); await load(); setMsg({ ok: true, text: "Đã lưu " + rows.length + " dòng" }); }
      catch (e) { setMsg({ ok: false, text: errorText(e.message) }); }
    };

    return h(UI.Panel, {
      title: "3. Gắn sale ↔ tài khoản & người duyệt",
      subtitle: names.length + " tên NV trong file kế toán · " + unmapped + " chưa gắn tài khoản (sale chưa gắn sẽ không thấy dữ liệu của mình)",
      right: h("div", { className: "flex gap-2" },
        h("button", { type: "button", onClick: autoMatch, className: btn.secondary }, "Tự khớp theo họ tên"),
        h("button", { type: "button", disabled: !dirty, onClick: save, className: btn.primary }, "Lưu" + (dirty ? " (" + dirty + ")" : ""))),
    },
      msg && h("div", { className: "px-4 pt-3" }, msg.ok ? h("span", { className: "text-[13px] text-green-700" }, msg.text) : h(UI.ErrorBox, null, msg.text)),
      h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow }, ["Tên NV (file kế toán)", "Tài khoản của sale", "Người duyệt", "Ghi chú"].map((x) => h("th", { key: x, className: T.th() }, x)))),
        h("tbody", null, names.map((n, i) => h("tr", { key: n, className: T.row(i) + (edits[n] ? " !bg-amber-50" : "") },
          h("td", { className: T.td + " whitespace-nowrap font-medium" }, n, !st.ten_nv.includes(n) && h("span", { className: "ml-1 text-[11px] text-slate-400" }, "(không có trong kỳ mới nhất)")),
          h("td", { className: T.td }, h("select", { value: val(n, "username"), onChange: (e) => setVal(n, "username", e.target.value), className: UI.input + " min-w-[260px]" },
            h("option", { value: "" }, "— chưa gắn —"), users.map(opt))),
          h("td", { className: T.td }, h("select", { value: val(n, "nguoi_duyet"), onChange: (e) => setVal(n, "nguoi_duyet", e.target.value), className: UI.input + " min-w-[260px]" },
            h("option", { value: "" }, "— theo phân quyền —"), approvers.map(opt))),
          h("td", { className: T.td }, h("input", { value: val(n, "ghi_chu"), onChange: (e) => setVal(n, "ghi_chu", e.target.value), className: UI.input + " min-w-[160px]" }))))))));
  }

  function QuanTri({ user }) {
    const [nonce, setNonce] = useState(0);
    if (user.role !== "admin") return h(UI.Empty, null, "Chỉ admin được vào màn này.");
    return h("div", { className: "flex flex-col gap-4" },
      window.DEBT_CONFIG.DEMO && h("div", { className: "flex items-center gap-2 text-[12px] text-slate-500" },
        "Chế độ demo: dữ liệu nằm trong trình duyệt này.",
        h("button", { type: "button", className: btn.link, onClick: async () => { await window.DEBT_MOCK.reset(); D.invalidate(); setNonce((n) => n + 1); } }, "Xoá dữ liệu demo")),
      h(NapFile, { onDone: () => setNonce((n) => n + 1) }),
      h(KyBaoCao, { key: "ky" + nonce, nonce }),
      h(SaleMap, { nonce }));
  }

  R.register("/quan-tri", QuanTri);
})();
