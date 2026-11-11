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
    const [check, setCheck] = useState(null);     // kết quả import_check của kỳ trong file
    const [confirmed, setConfirmed] = useState(false);

    const onFile = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      setParsed(null); setCheck(null); setConfirmed(false); setError(null); setDone(null); setFileName(file.name); setBusy(true); setProgress("Đang đọc file…");
      await new Promise((r) => setTimeout(r, 30)); // cho UI vẽ trạng thái trước khi đọc (đồng bộ, ~1–3 giây)
      try {
        const wb = XLSX.read(await file.arrayBuffer(), IMP.READ_OPTS);
        const parsedNow = IMP.parseWorkbook(wb);
        setProgress("Kiểm tra dữ liệu đang có của kỳ " + fmtKyLabel(parsedNow.ky) + "…");
        setCheck(await api("import_check", { ky: parsedNow.ky }));
        setParsed(parsedNow);
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
        setParsed(null); setCheck(null); setConfirmed(false);
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
          check && check.exists && h(ThayThe, { parsed, check, confirmed, setConfirmed }),
          h("div", { className: "flex gap-2" },
            h("button", { type: "button", disabled: busy || (check && check.exists && (check.khoa || !confirmed)), onClick: upload, className: btn.primary },
              h(UI.I.Upload, { size: 14 }), check && check.exists ? "Thay thế dữ liệu " + fmtKyLabel(parsed.ky) : "Nạp lên hệ thống"),
            h("button", { type: "button", disabled: busy, onClick: () => { setParsed(null); setCheck(null); setConfirmed(false); }, className: btn.secondary }, "Huỷ")))));
  }

  // Cảnh báo khi kỳ đã có dữ liệu: so số cũ/mới, giải trình sẽ bị ẩn hoặc cần cập nhật.
  function ThayThe({ parsed, check, confirmed, setConfirmed }) {
    const NHOM_GT = D.NHOM_GT;
    const SEP = "\u0001";
    const cur = parsed.cong_no.filter((r) => r.ky === parsed.ky && !r.loai_tru);
    // Nhóm giải trình của sale theo phân quyền hiện tại (giống debt-api)
    const normName = (v) => String(v == null ? "" : v).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
    const nhomOf = (nv) => (check.nhom_by_nv || {})[normName(nv)] || "nv:" + normName(nv);
    const newPair = new Map(), newKhQh = new Set(), newKh = new Set(), newKhNganh = new Set();
    for (const r of cur) {
      newKh.add(r.ma_kh);
      if (!NHOM_GT.includes(r.nhom_no)) continue;
      newKhQh.add(r.ma_kh);
      newKhNganh.add(r.ma_kh + SEP + r.nganh_hang);
      const k = r.ma_kh + SEP + r.nganh_hang + SEP + nhomOf(r.ten_nv);
      newPair.set(k, (newPair.get(k) || 0) + r.con_no);
    }
    const saved = (check.giai_trinh || []).filter((g) => D.stOf(g) !== "chua");
    const an = [], capNhat = [];
    for (const g of saved) {
      const k = g.ma_kh + SEP + g.nganh_hang + SEP + (g.nhom_gt || "");
      if (!newPair.has(k)) {
        an.push({ ...g, ly_do: newKhNganh.has(g.ma_kh + SEP + g.nganh_hang) ? "BU này còn nợ A2–A4 nhưng không còn sale của nhóm giải trình này"
          : newKhQh.has(g.ma_kh) ? "KH còn nợ A2–A4 nhưng không còn ở BU này" : newKh.has(g.ma_kh) ? "KH không còn nợ A2–A4" : "Mã KH không còn trong file" });
      } else if (D.canCapNhat(g.du_no_qua_han, newPair.get(k))) {
        capNhat.push({ ...g, moi: newPair.get(k) });
      }
    }
    const o = (check.doi_chieu && check.doi_chieu.tinh_lai) || {};
    const n = parsed.doi_chieu.tinh_lai;
    const rows = [["Nhóm A0", "A0"], ["Nhóm A1", "A1"], ["Nhóm A2", "A2"], ["Nhóm A3", "A3"], ["Nhóm A4", "A4"], ["Tổng dư nợ", "tong"], ["Chưa có BBBG/ĐCCN (chưa gồm CTTM)", "chua_bbbg"]]
      .map(([label, key]) => ({ label, old: o[key], neu: n[key] }));
    rows.push({ label: "Hàng vay chưa xuất HĐ", old: check.doi_chieu && check.doi_chieu.hang_vay_tinh_lai, neu: parsed.doi_chieu.hang_vay_tinh_lai });
    const f0 = (v) => (v == null ? "—" : Math.round(v).toLocaleString("vi-VN"));

    if (check.khoa) {
      return h("div", { className: "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800" },
        h("b", null, "Kỳ " + fmtKyLabel(parsed.ky) + " đã khoá. "), "Muốn nạp lại: bỏ tick \"Khoá\" của kỳ này ở mục 2 bên dưới, rồi chọn lại file.");
    }
    return h("div", { className: "flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900" },
      h("div", null, h("b", null, "Kỳ " + fmtKyLabel(parsed.ky) + " đã có dữ liệu"),
        " (nạp " + (check.imported_at ? new Date(check.imported_at).toLocaleString("vi-VN") : "?") + " bởi " + (check.imported_by || "?") + (check.file_name ? ", file \"" + check.file_name + "\"" : "") + "). ",
        "Nạp tiếp sẽ thay toàn bộ số liệu kỳ này (gồm số kỳ trước dùng để so sánh). Số cũ bị xoá, không khôi phục được trừ khi nạp lại file cũ. Giải trình đã nhập được giữ."),
      h("table", { className: T.table + " max-w-2xl bg-white" },
        h("thead", null, h("tr", { className: T.headRow }, ["Chỉ tiêu (triệu đồng)", "Đang có", "File mới", "Chênh lệch"].map((x, i) => h("th", { key: x, className: T.th(i > 0) }, x)))),
        h("tbody", null, rows.map((r) => {
          const d = r.old == null || r.neu == null ? null : r.neu - r.old;
          return h("tr", { key: r.label, className: d && Math.abs(d) >= 0.5 ? "bg-amber-50" : "" },
            h("td", { className: T.td }, r.label), h("td", { className: T.num }, f0(r.old)), h("td", { className: T.num }, f0(r.neu)),
            h("td", { className: T.num + (d && Math.abs(d) >= 0.5 ? " font-semibold" : " text-slate-400") }, d == null ? "—" : (d > 0 ? "+" : "") + f0(d)));
        }))),
      h("div", null, h("b", null, saved.length + " giải trình đã lưu"), " · ",
        an.length ? h("b", { className: "text-red-700" }, an.length + " sẽ bị ẩn") : "không giải trình nào bị ẩn", " · ",
        capNhat.length ? h("b", null, capNhat.length + " sẽ được đánh dấu \"Cần cập nhật\"") : "không giải trình nào lệch số đáng kể"),
      an.length > 0 && h("div", { className: "max-h-48 overflow-y-auto rounded border border-red-200 bg-white" },
        h("table", { className: T.table },
          h("thead", null, h("tr", { className: T.headRow }, ["Khách hàng", "BU", "A2–A4 lúc lưu (tr)", "Lý do bị ẩn"].map((x, i) => h("th", { key: x, className: T.th(i === 2) }, x)))),
          h("tbody", null, an.map((g, i) => h("tr", { key: g.ma_kh + g.nganh_hang + (g.nhom_gt || ""), className: T.row(i) },
            h("td", { className: T.td }, g.ten_kh || g.ma_kh), h("td", { className: T.td }, UI.buName(g.nganh_hang)),
            h("td", { className: T.num }, fmtTr(g.du_no_qua_han, 1)), h("td", { className: T.td + " text-red-700" }, g.ly_do)))))),
      capNhat.length > 0 && h("details", { className: "rounded border border-amber-200 bg-white px-3 py-2" },
        h("summary", { className: "cursor-pointer font-medium" }, "Xem " + capNhat.length + " giải trình sẽ cần cập nhật"),
        h("table", { className: T.table + " mt-2" },
          h("thead", null, h("tr", { className: T.headRow }, ["Khách hàng", "BU", "A2–A4 lúc lưu (tr)", "A2–A4 file mới (tr)"].map((x, i) => h("th", { key: x, className: T.th(i >= 2) }, x)))),
          h("tbody", null, capNhat.map((g, i) => h("tr", { key: g.ma_kh + g.nganh_hang + (g.nhom_gt || ""), className: T.row(i) },
            h("td", { className: T.td }, g.ten_kh || g.ma_kh), h("td", { className: T.td }, UI.buName(g.nganh_hang)),
            h("td", { className: T.num }, fmtTr(g.du_no_qua_han, 1)), h("td", { className: T.num }, fmtTr(g.moi, 1))))))),
      h("label", { className: "flex items-center gap-2 font-medium" },
        h("input", { type: "checkbox", checked: confirmed, onChange: (e) => setConfirmed(e.target.checked) }),
        "Tôi đã kiểm tra, thay thế dữ liệu kỳ " + fmtKyLabel(parsed.ky) + " bằng file mới"));
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
    if (st.loading) return h(UI.Panel, { title: "3. Phân quyền theo danh mục PS" }, h(UI.LoadingBlock, null));
    if (st.error) return h(UI.Panel, { title: "3. Phân quyền theo danh mục PS" }, h("div", { className: "p-4" }, h(UI.ErrorBox, null, st.error)));

    const byNv = new Map(st.rows.map((r) => [r.ten_nv, r]));
    const names = [...new Set([...st.ten_nv, ...st.rows.map((r) => r.ten_nv)])].sort((a, b) => a.localeCompare(b, "vi"));
    const val = (nv, k) => (edits[nv] && k in edits[nv] ? edits[nv][k] : (byNv.get(nv) || {})[k] || "");
    const setVal = (nv, k, v) => setEdits((e) => ({ ...e, [nv]: { ...(e[nv] || {}), [k]: v } }));
    const users = st.users.slice().sort((a, b) => (a.ho_va_ten || a.username).localeCompare(b.ho_va_ten || b.username, "vi"));
    const approvers = users.filter((u) => ["admin", "manager"].includes(String(u.role).toLowerCase()));
    const opt = (u) => h("option", { key: u.username, value: u.username }, (u.ho_va_ten || u.username) + " (" + u.username + " · " + u.role + ")");
    const nameOf = (un) => { const u = users.find((x) => x.username === un); return u ? (u.ho_va_ten || un) : un; };
    const auto = st.auto || {};
    const dirty = Object.keys(edits).length;
    const noPs = names.filter((n) => !auto[n]).length;
    const noAm = names.filter((n) => auto[n] && !auto[n].am.length && !auto[n].tu_gt).length;

    // Nhóm theo người giải trình: BU → Miền → Team (CH&CS · Miền Bắc · CHCS MB → CHCS 1 MN → CHCS 2 MN → CTTM & CTUT … → THNS & CSVT …).
    const BU_ORDER = { chcs: 1, cttm: 2, thnk: 3 };
    const MIEN_ORDER = { "Miền Bắc": 1, "Miền Trung": 2, "Miền Nam": 3 };
    const rank = (n) => {
      const a = auto[n];
      if (!a) return [9, 9, "", n];
      return [BU_ORDER[a.bu] || 8, MIEN_ORDER[a.area] || 8, a.team || "", n];
    };
    const cmp = (x, y) => { const a = rank(x), b = rank(y); for (let i = 0; i < 4; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
    const sorted = names.slice().sort((x, y) => cmp(x, y) || x.localeCompare(y, "vi"));
    const groupKey = (n) => { const a = auto[n]; return a ? (a.bu_name || a.bu) + "|" + a.area + "|" + a.team : "~"; };
    const groupLabel = (n) => {
      const a = auto[n];
      if (!a) return { title: "Không có trong dm_ps", who: "Admin / manager giải trình" };
      const who = a.am.length ? "Area manager: " + a.am.map(nameOf).join(", ") : a.tu_gt ? "Sale tự giải trình" : "Chưa có người giải trình — admin / manager giải trình";
      return { title: [a.bu_name || a.bu, a.area, a.team].filter(Boolean).join(" · "), who };
    };
    const showDuyet = !!window.DEBT_CONFIG.PHE_DUYET;
    const save = async () => {
      setMsg(null);
      const rows = Object.keys(edits).map((nv) => ({ ten_nv: nv, username: val(nv, "username") || null, nguoi_duyet: val(nv, "nguoi_duyet") || null, ghi_chu: val(nv, "ghi_chu") || null }));
      try { await api("save_sale_map", { rows }); setEdits({}); D.invalidate(); await load(); setMsg({ ok: true, text: "Đã lưu " + rows.length + " dòng" }); }
      catch (e) { setMsg({ ok: false, text: errorText(e.message) }); }
    };
    const list = (arr, empty, tone) => arr && arr.length
      ? h("div", { className: "flex flex-wrap gap-1" }, arr.map((un) => h(UI.Badge, { key: un, tone: tone, title: un }, nameOf(un))))
      : h("span", { className: "text-[12px] " + (empty.warn ? "text-red-600" : "text-slate-400") }, empty.text);

    return h(UI.Panel, {
      title: "3. Phân quyền theo danh mục PS (shared.dm_ps)",
      subtitle: names.length + " tên NV trong file kế toán · tự gắn theo dm_ps.ten_ps · " + noPs + " tên không có trong dm_ps · " + noAm + " tên chưa có người giải trình (admin/manager làm thay)",
      right: h("button", { type: "button", disabled: !dirty, onClick: save, className: btn.primary }, "Lưu" + (dirty ? " (" + dirty + ")" : "")),
    },
      msg && h("div", { className: "px-4 pt-3" }, msg.ok ? h("span", { className: "text-[13px] text-green-700" }, msg.text) : h(UI.ErrorBox, null, msg.text)),
      h("div", { className: "px-4 pt-3 text-[12px] text-slate-500" },
        "Sale xem KH của mình qua tài khoản có users.scope (hoặc username) = dm_ps.ps. Người giải trình: area manager cùng BU + miền (miền có nhiều team thì theo team); PS không có area manager thì sale tự giải trình; admin và manager giải trình được tất cả. ",
        "Muốn đổi: sửa dm_ps / shared.users. Cột \"Gắn tay\" chỉ dùng cho tên không có trong dm_ps (admin vẫn giải trình thay được)."),
      h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow },
          ["Tên NV (file kế toán)", "Tài khoản sale", "Người giải trình", "Gắn tay tài khoản xem", ...(showDuyet ? ["Người duyệt riêng"] : []), "Ghi chú"].map((x) => h("th", { key: x, className: T.th() }, x)))),
        h("tbody", null, sorted.flatMap((n, i) => {
          const a = auto[n];
          const out = [];
          if (i === 0 || groupKey(sorted[i - 1]) !== groupKey(n)) {
            const g = groupLabel(n);
            out.push(h("tr", { key: "g" + groupKey(n), className: "border-t border-slate-200 bg-blue-50" },
              h("td", { colSpan: showDuyet ? 6 : 5, className: "px-3 py-1.5 text-[12px]" },
                h("b", { className: "text-slate-800" }, g.title), h("span", { className: "ml-2 text-slate-500" }, "— " + g.who))));
          }
          const who = a && a.am.length ? list(a.am, { text: "" }, "blue")
            : a && a.tu_gt ? h(UI.Badge, { tone: "green" }, "Tự giải trình")
            : h("span", { className: "text-[12px] text-red-600" }, "Admin / manager");
          out.push(h("tr", { key: n, className: T.row(i) + (edits[n] ? " !bg-amber-50" : "") },
            h("td", { className: T.td + " whitespace-nowrap pl-6 font-medium" }, n,
              a && !a.sale.length && h("span", { className: "ml-1 text-[11px] text-slate-400" }, "(chưa có tài khoản)"),
              !st.ten_nv.includes(n) && h("span", { className: "ml-1 text-[11px] text-slate-400" }, "(không có trong kỳ mới nhất)")),
            h("td", { className: T.td }, list(a && a.sale, { text: "—" }, "grey")),
            h("td", { className: T.td }, who),
            h("td", { className: T.td }, h("select", { value: val(n, "username"), onChange: (e) => setVal(n, "username", e.target.value), className: UI.input + " min-w-[200px]" },
              h("option", { value: "" }, "—"), users.map(opt))),
            showDuyet && h("td", { className: T.td }, h("select", { value: val(n, "nguoi_duyet"), onChange: (e) => setVal(n, "nguoi_duyet", e.target.value), className: UI.input + " min-w-[200px]" },
              h("option", { value: "" }, "— admin / manager —"), [...approvers, ...users.filter((u) => !approvers.includes(u) && String(u.role).toLowerCase() !== "ps")].map(opt))),
            h("td", { className: T.td }, h("input", { value: val(n, "ghi_chu"), onChange: (e) => setVal(n, "ghi_chu", e.target.value), className: UI.input + " min-w-[140px]" }))));
          return out;
        })))));
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
